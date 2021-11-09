const request = require('superagent');
const { ServiceBusClient, ReceiveMode } = require("@azure/service-bus");
const config = require('config');

const connectionString = config.get('servicecallbackBusConnection');
const topicName = config.get('servicecallbackTopicName');
const subscriptionName = config.get('servicecallbackSubscriptionName');
const processMessagesCount = config.get('processMessagesCount');
const delayTime = config.get('delayMessageMinutes');

const MAX_RETRIES = 3;

module.exports = async function serviceCallbackFunction() {
    const sbClient = ServiceBusClient.createFromConnectionString(connectionString);
    const subscriptionClient = sbClient.createSubscriptionClient(topicName, subscriptionName);
    const receiver = subscriptionClient.createReceiver(ReceiveMode.peekLock);
    const messages = await receiver.receiveMessages(processMessagesCount);
    if (messages.length == 0) {
        console.log('no messages received in this run');
    }
    for (let i = 0; i < messages.length; i++) {
        let msg = messages[i];
        let serviceCallbackUrl;
        try {
            if (this.validateMessage(msg)) {
                serviceCallbackUrl = msg.userProperties.serviceCallbackUrl;
                const res = await request.put(serviceCallbackUrl).send(msg.body);
                console.log("Attempting to invoke callback" + serviceCallbackUrl);
                if (res && res.status >= 200 && res.status < 300) {
                    console.log('Message Sent Successfully to ' + serviceCallbackUrl);
                } else {
                    console.log('Received response status  ', res.status);
                    throw res.status;
                }
            } else {
                console.log('Skipping processing invalid message and sending to dead letter' + JSON.stringify(msg.body));
                await msg.deadLetter()
            }
        } catch (err) {
            console.log('Error response received from ', serviceCallbackUrl, err);
            if (!msg.userProperties.retries) {
                msg.userProperties.retries = 0;
            }
            if (msg.userProperties.retries === MAX_RETRIES) {
                console.log("Max number of retries reached for ", JSON.stringify(msg.body));
                await msg.deadLetter()
                    .then(() => {
                        console.log("Dead lettered a message ", JSON.stringify(msg.body));
                    })
                    .catch(err => {
                        console.log("Error while dead letter message ", err)
                    });
            } else {
                msg.userProperties.retries++;
                await sendMessage(msg.clone());
            }

        } finally {
            if (!msg.isSettled) {
                await msg.complete();
            }
        }

    }
    await subscriptionClient.close();
    await sbClient.close();
}

validateMessage = message => {
    console.log('Received callback messages: ', JSON.stringify(message.body));
    if (!message.body) {
        console.log('No body received');
        return false;
    }
    if (!message.userProperties) {
        console.log('No userProperties data');
        return false;
    }
    let serviceCallbackUrl = message.userProperties.serviceCallbackUrl;
    if (!serviceCallbackUrl) {
        serviceCallbackUrl = message.userProperties.servicecallbackurl;
        if (!serviceCallbackUrl) {
            console.log('No service callback url...');
            return false;
        }
    }
    return true;
}

//send message

async function sendMessage(msg) {
    const sBusClient = ServiceBusClient.createFromConnectionString(connectionString);
    const topicClient = sBusClient.createTopicClient(topicName);
    const topicSender = topicClient.createSender();
    const msgFailedTime = new Date();
    const retryLaterTime = new Date(msgFailedTime.setMinutes(msgFailedTime.getMinutes() + parseInt(delayTime)));
    topicSender.scheduleMessage(retryLaterTime, msg)
        .then(() => {
            console.log("Message is scheduled to retry at UTC: ", retryLaterTime);
        })
        .catch(err => {
            console.log("Error while scheduling message ", err)
        }).finally(async () => {
            await topicClient.close();
            await sBusClient.close();
        })
}