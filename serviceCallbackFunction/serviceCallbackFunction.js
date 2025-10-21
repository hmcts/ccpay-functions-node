const axiosRequest = require('axios');
const { ServiceBusClient, ReceiveMode } = require("@azure/service-bus");
const config = require('@hmcts/properties-volume').addTo(require('config'));
const otp = require('otp');
const { randomInt } = require('crypto');

const connectionString = config.get('servicecallbackBusConnection');
const topicName = config.get('servicecallbackTopicName');
const subscriptionName = config.get('servicecallbackSubscriptionName');
const processMessagesCount = config.get('processMessagesCount');
const delayTime = config.get('delayMessageMinutes');

const s2sUrl = config.get('s2sUrl');
const s2sSecret = config.get('secrets.ccpay.payment-s2s-secret');
const microService = config.get('microservicePaymentApp');
const extraServiceLogging = config.get('extraServiceLogging');
const MAX_RETRIES = 5;

module.exports = async function serviceCallbackFunction() {
    const sbClient = ServiceBusClient.createFromConnectionString(connectionString);
    const subscriptionClient = sbClient.createSubscriptionClient(topicName, subscriptionName);
    const receiver = subscriptionClient.createReceiver(ReceiveMode.peekLock);
    const messages = await receiver.receiveMessages(processMessagesCount);
    if (messages.length == 0) {
        console.log('No messages received from ServiceBusTopic!!!');
    }
    for (let i = 0; i < messages.length; i++) {
        let msg = messages[i];
        let serviceCallbackUrl;
        let serviceName;
        let correlationId = msg.correlationId === undefined ? randomInt(100000,999999) : msg.correlationId;
        msg.correlationId = correlationId;
        let messageSettled = false;
        try {
            if (this.validateMessage(msg)) {
                serviceCallbackUrl = msg.userProperties.serviceCallbackUrl;
                serviceName = msg.userProperties.serviceName === undefined ? '' : msg.userProperties.serviceName;
                console.log(correlationId + ': Processing message from service ' + serviceName);
                const otpPassword = otp({ secret: s2sSecret }).totp();
                const serviceAuthRequest = {
                    microservice: microService,
                    oneTimePassword: otpPassword
                };

                try {
                    const token = await axiosRequest.post(s2sUrl + '/lease', serviceAuthRequest);
                    console.log(correlationId + ': S2S Token Retrieved.......');
                    const options = {
                        headers: {
                            'ServiceAuthorization': token.data,
                            'Content-Type': 'application/json'
                        }
                    };
                    if (extraServiceLogging) {
                        console.log(correlationId + ': Headers: ', Buffer.from(JSON.stringify(options)).toString("base64"));
                    }
                    console.log(correlationId + ': About to post callback URL ', serviceCallbackUrl);
                    const response = await axiosRequest.put(serviceCallbackUrl, msg.body, options);
                    console.log(correlationId + ': Response: ' + JSON.stringify(response.data));
                    if(response && response.status >= 200 && response.status < 300) {
                        console.log(correlationId + ': Message Sent Successfully to ' + serviceCallbackUrl);
                    } else {
                        console.log(correlationId + ': Error in Calling Service ' + JSON.stringify(response));
                        messageSettled = await retryOrDeadLetter(msg);
                    }
                } catch (requestError) {
                    console.log(correlationId + ': Error in request: ' + requestError);
                    messageSettled = await retryOrDeadLetter(msg);
                }
            } else {
                console.log(correlationId + ': Skipping processing invalid message and sending to dead letter' + JSON.stringify(msg.body));
                await msg.deadLetter();
                messageSettled = true;
            }
        } catch (err) {
            console.log(correlationId + ': Error response received from ', serviceCallbackUrl, err);
            messageSettled = await retryOrDeadLetter(msg);
        } finally {
            if (!messageSettled && !msg.isSettled) {
                await msg.complete();
            }
        }

    }
    await subscriptionClient.close();
    await sbClient.close();
}

retryOrDeadLetter = async (msg) => {
    let correlationId = msg.correlationId;
    if (!msg.userProperties.retries) {
        msg.userProperties.retries = 0;
    }
    if (msg.userProperties.retries === MAX_RETRIES) {
        console.log(correlationId + ": Max number of retries reached for ", JSON.stringify(msg.body));
        try {
            await msg.deadLetter();
            console.log(correlationId + ": Dead lettered a message ", JSON.stringify(msg.body));
            return true;
        } catch (err) {
            console.log(correlationId + ": Error while dead letter messages ", err);
            return false;
        }
    } else {
        console.log(correlationId + ": Will retry message at a later time ", JSON.stringify(msg.body));
        msg.userProperties.retries++;
        await sendMessage(msg.clone(), correlationId);
        return false;
    }
}

validateMessage = message => {
    const correlationId = message.correlationId;
    if (!message.body) {
        console.log(correlationId + ': No body received');
        return false;
    } else {
        console.log(correlationId + ': Received callback message: ', message.body);
    }
    if (!message.userProperties) {
        console.log(correlationId + ': No userProperties data');
        return false;
    }
    let serviceCallbackUrl = message.userProperties.serviceCallbackUrl;
    if (!serviceCallbackUrl) {
        serviceCallbackUrl = message.userProperties.servicecallbackurl;
        if (!serviceCallbackUrl) {
            console.log(correlationId + ': No service callback url...');
            return false;
        }
    }
    console.log(correlationId + ': Received Callback Message is Valid!!!');
    return true;
}


async function sendMessage(msg, correlationId) {
    const sBusClient = ServiceBusClient.createFromConnectionString(connectionString);
    const topicClient = sBusClient.createTopicClient(topicName);
    const topicSender = topicClient.createSender();
    const msgFailedTime = new Date();
    const retryLaterTime = new Date(msgFailedTime.setMinutes(msgFailedTime.getMinutes() + parseInt(delayTime)));
    try {
        await topicSender.scheduleMessage(retryLaterTime, msg);
        console.log(correlationId + ": Message is scheduled to retry at UTC: ", retryLaterTime);
    } catch (err) {
        console.log(correlationId + ": Error while scheduling message ", err);
    } finally {
        await topicClient.close();
        await sBusClient.close();
    }
}
