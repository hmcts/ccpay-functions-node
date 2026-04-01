const axiosRequest = require('axios');
const { ServiceBusClient, ReceiveMode } = require("@azure/service-bus");
const config = require('@hmcts/properties-volume').addTo(require('config'));
const otp = require('otp');
const { createHmac, randomInt, timingSafeEqual } = require('crypto');

const connectionString = config.get('servicecallbackBusConnection');
const topicName = config.get('servicecallbackTopicName');
const subscriptionName = config.get('servicecallbackSubscriptionName');
const processMessagesCount = config.get('processMessagesCount');
const delayTime = config.get('delayMessageMinutes');

const s2sUrl = config.get('s2sUrl');
const s2sSecret = config.get('secrets.ccpay.payment-s2s-secret');
const ccpayMessageSigningKey = config.get('hmac.secrets.ccpay-message-signing-key');
const microService = config.get('microservicePaymentApp');
const extraServiceLogging = config.get('extraServiceLogging');
const MAX_RETRIES = 5;
const HEADER_SIGNATURE = 'X-Message-Signature';
const HEADER_SENDER = 'X-Sender-Service';
const HEADER_TIMESTAMP = 'X-Timestamp';
const EXPECTED_INBOUND_SENDER = 'ccpay-payment';
const SERVICE_CALLBACK_URL_PATTERN = /^https?:\/\/([a-z0-9-]+-(aat|prod|demo|ithc|perftest)\.service\.core-compute-\2\.internal|(www\.)?(apply-divorce|end-civil-partnership)\.service\.gov\.uk)(?:\/.*)?$/;

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
        try {
            if (this.validateMessage(msg)) {
                serviceCallbackUrl = msg.userProperties.serviceCallbackUrl;
                if (!serviceCallbackUrl) {
                    serviceCallbackUrl = msg.userProperties.servicecallbackurl;
                }
                if (!SERVICE_CALLBACK_URL_PATTERN.test(serviceCallbackUrl)) {
                    console.log(correlationId + ': Invalid service callback url pattern, sending to dead letter: ' + serviceCallbackUrl);
                    await msg.deadLetter();
                    continue;
                }
                serviceName = msg.userProperties.serviceName === undefined ? '' : msg.userProperties.serviceName;
                console.log(correlationId + ': Processing message from service ' + serviceName);
                const otpPassword = otp({ secret: s2sSecret }).totp();
                const serviceAuthRequest = {
                    microservice: microService,
                    oneTimePassword: otpPassword
                };

                axiosRequest.post(
                    s2sUrl + '/lease',
                    serviceAuthRequest
                ).then(token => {
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
                    axiosRequest.put(
                        serviceCallbackUrl,
                        msg.body,
                        options
                    ).then(response => {
                        console.log(correlationId + ': Response: ' + JSON.stringify(response.data));
                        if(response && response.status >= 200 && response.status < 300) {
                            console.log(correlationId + ': Message Sent Successfully to ' + serviceCallbackUrl);
                        } else {
                            console.log(correlationId + ': Error in Calling Service ' + JSON.stringify(response));
                            retryOrDeadLetter(msg);
                        }
                    }).catch((callbackError) => {
                        console.log(correlationId + ': Error in fetching callback request ' + callbackError);
                        retryOrDeadLetter(msg);
                    });
                }).catch((s2sError) => {
                    console.log(correlationId + ': Error in fetching S2S token message ' + s2sError);
                    retryOrDeadLetter(msg);
                });
            } else {
                console.log(correlationId + ': Skipping processing invalid message and sending to dead letter' + JSON.stringify(msg.body));
                await msg.deadLetter();
            }
        } catch (err) {
            console.log(correlationId + ': Error response received from ', serviceCallbackUrl, err);
          retryOrDeadLetter(msg);
        } finally {
            if (!msg.isSettled) {
                await msg.complete();
            }
        }

    }
    await subscriptionClient.close();
    await sbClient.close();
}

retryOrDeadLetter = msg => {
    let correlationId = msg.correlationId;
    if (!msg.userProperties.retries) {
        msg.userProperties.retries = 0;
    }
    if (msg.userProperties.retries === MAX_RETRIES) {
        console.log(correlationId + ": Max number of retries reached for ", JSON.stringify(msg.body));
        msg.deadLetter()
            .then(() => {
                console.log(correlationId + ": Dead lettered a message ", JSON.stringify(msg.body));
            })
            .catch(err => {
                console.log(correlationId + ": Error while dead letter messages ", err)
            });
    } else {
        console.log(correlationId + ": Will retry message at a later time ", JSON.stringify(msg.body));
        msg.userProperties.retries++;
        sendMessage(msg.clone(), correlationId);
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
    try {
        validateMessageSecurity(message);
    } catch (err) {
        console.log(correlationId + ': Security validation failed: ' + err.message);
        return false;
    }
    console.log(correlationId + ': Received Callback Message is Valid!!!');
    return true;
}

function validateMessageSecurity(message) {
    const userProperties = message.userProperties || {};
    const signature = asString(userProperties[HEADER_SIGNATURE]);
    const sender = asString(userProperties[HEADER_SENDER]);
    const timestamp = asString(userProperties[HEADER_TIMESTAMP]);

    if (!signature || !sender || !timestamp) {
        throw new Error('Missing required security headers');
    }

    if (sender !== EXPECTED_INBOUND_SENDER) {
        throw new Error('Unexpected sender: ' + sender);
    }

    if (isExpired(timestamp)) {
        throw new Error('Message expired');
    }

    const payloadToSign = buildPayloadToSign(message, timestamp, sender);
    const expectedSignature = hmacSha256Base64(payloadToSign, ccpayMessageSigningKey);
    const signatureBuffer = decodeBase64(signature, 'signature');
    const expectedBuffer = decodeBase64(expectedSignature, 'expected signature');

    if (signatureBuffer.length !== expectedBuffer.length
        || !timingSafeEqual(signatureBuffer, expectedBuffer)) {
        throw new Error('Invalid message signature');
    }
}

function buildPayloadToSign(message, timestamp, sender) {
    return [
        'v1',
        sender,
        timestamp,
        asString(message.label),
        asString(message.contentType),
        Buffer.from(getBodyAsString(message.body), 'utf8').toString('base64')
    ].join('|');
}

function getBodyAsString(body) {
    if (body == null) {
        return '';
    }

    if (typeof body === 'string') {
        return body;
    }

    return JSON.stringify(body);
}

function isExpired(timestamp) {
    const messageTime = Date.parse(timestamp);
    if (Number.isNaN(messageTime)) {
        throw new Error('Invalid timestamp');
    }

    const now = Date.now();
    return messageTime < now - (30 * 60 * 1000) || messageTime > now + (30 * 1000);
}

function asString(value) {
    return value == null ? null : value.toString();
}

function hmacSha256Base64(payload, base64Secret) {
    try {
        if (typeof base64Secret !== 'string' || base64Secret.trim().length === 0) {
            throw new Error('Missing secret');
        }
        const secretBytes = decodeBase64(base64Secret, 'secret');
        return createHmac('sha256', secretBytes)
            .update(payload, 'utf8')
            .digest('base64');
    } catch (err) {
        throw new Error('Unable to calculate HMAC-SHA256');
    }
}

function decodeBase64(value, description) {
    if (typeof value !== 'string' || value.length === 0 || !isValidBase64(value)) {
        throw new Error('Invalid Base64 ' + description);
    }

    return Buffer.from(value, 'base64');
}

function isValidBase64(value) {
    return /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value);
}


async function sendMessage(msg, correlationId) {
    const sBusClient = ServiceBusClient.createFromConnectionString(connectionString);
    const topicClient = sBusClient.createTopicClient(topicName);
    const topicSender = topicClient.createSender();
    const msgFailedTime = new Date();
    const retryLaterTime = new Date(msgFailedTime.setMinutes(msgFailedTime.getMinutes() + parseInt(delayTime)));
    topicSender.scheduleMessage(retryLaterTime, msg)
        .then(() => {
            console.log(correlationId + ": Message is scheduled to retry at UTC: ", retryLaterTime);
        })
        .catch(err => {
            console.log(correlationId + ": Error while scheduling message ", err)
        }).finally(() => {
            (async () => {
                await topicClient.close();
                await sBusClient.close();
            })();
        })
}
