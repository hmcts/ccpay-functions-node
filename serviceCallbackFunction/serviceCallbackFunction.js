const request = require('superagent');
const s2sRequest = require('request-promise-native');
const { ServiceBusClient, ReceiveMode } = require("@azure/service-bus");
const config = require('@hmcts/properties-volume').addTo(require('config'));
const otp = require('otp');

const connectionString = config.get('servicecallbackBusConnection');
const topicName = config.get('servicecallbackTopicName');
const subscriptionName = config.get('servicecallbackSubscriptionName');
const processMessagesCount = config.get('processMessagesCount');
const delayTime = config.get('delayMessageMinutes');

const s2sUrl = config.get('s2sUrl');
const s2sSecret = config.get('secrets.ccpay.payment-s2s-secret');
const microService = config.get('microservicePaymentApp');

const MAX_RETRIES = 3;

module.exports = async function serviceCallbackFunction() {
    const sbClient = ServiceBusClient.createFromConnectionString(connectionString);
    const subscriptionClient = sbClient.createSubscriptionClient(topicName, subscriptionName);
    const receiver = subscriptionClient.createReceiver(ReceiveMode.peekLock);
    const messages = await receiver.receiveMessages(processMessagesCount);
    if (messages.length == 0) {
        console.log('no messages received from ServiceBusTopic!!!');
    }
    for (let i = 0; i < messages.length; i++) {
        let msg = messages[i];
        let serviceCallbackUrl;
        let serviceName;
        try {
            if (this.validateMessage(msg)) {
                serviceCallbackUrl = msg.userProperties.serviceCallbackUrl;
                serviceName = msg.userProperties.serviceName;

                const otpPassword = otp({ secret: s2sSecret }).totp();
                const serviceAuthRequest = {
                    microservice: microService,
                    oneTimePassword: otpPassword
                };

                s2sRequest.post({
                    uri: s2sUrl + '/lease',
                    body: serviceAuthRequest,
                    json: true
                }).then(token => {
                    console.log('S2S Token Retrieved.......');
                    const serviceResponse  = s2sRequest.put({
                        uri: serviceCallbackUrl,
                        headers: {
                            ServiceAuthorization: token,
                            'Content-Type': 'application/json'
                        },
                        json: true,
                        body: msg.body
                    }, function(error, response, body) {
                    console.log('Response : ' + JSON.stringify(response));
                    if(response && response.statusCode >= 200 && response.statusCode < 300) {
                        console.log('Message Sent Successfully to ' + serviceCallbackUrl);
                    } else {
                        console.log('Error in Calling Service ' + JSON.stringify(response));
                        if (!msg.userProperties.retries) {
                            msg.userProperties.retries = 0;
                        }
                        if (msg.userProperties.retries === MAX_RETRIES) {
                            console.log("Max number of retries reached for ", JSON.stringify(msg.body));
                            msg.deadLetter()
                                .then(() => {
                                    console.log("Dead lettered a message ", JSON.stringify(msg.body));
                                })
                                .catch(err => {
                                    console.log("Error while dead letter message ", err)
                                });
                        } else {
                            msg.userProperties.retries++;
                            sendMessage(msg.clone());
                        }
                    }
                    });
                }).catch(error => {
                    console.log('Error in fetching S2S token message ' + error.message + ' response ' + error.response);
                });
            } else {
                console.log('Skipping processing invalid message and sending to dead letter' + JSON.stringify(msg.body));
                await msg.deadLetter()
            }
        } catch (err) {
            console.log('Error response received from ', serviceCallbackUrl, err);
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
    if (!message.body) {
        console.log('No body received');
        return false;
    } else {
        console.log('Received callback message: ', message.body);
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
    console.log('Received Callback Message is Valid!!!');
    return true;
}


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
