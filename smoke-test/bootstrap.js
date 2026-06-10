'use strict';

const Module = require('module');
const http = require('http');

const originalLoad = Module._load;
const expectedBody = JSON.parse(process.env.SMOKE_EXPECTED_BODY || '{}');
const callbackUrl = process.env.SMOKE_CALLBACK_URL;

const createMessage = () => ({
    correlationId: 'smoke-test-correlation-id',
    body: expectedBody,
    userProperties: {
        retries: 0,
        serviceName: 'SmokeTest',
        serviceCallbackUrl: callbackUrl
    },
    complete: async () => {
        console.log('[smoke] message complete called');
    },
    deadLetter: async () => {
        throw new Error('Smoke message was dead-lettered unexpectedly');
    },
    clone: () => createMessage()
});

const message = createMessage();

const sbClientStub = {
    createSubscriptionClient: () => ({
        createReceiver: () => ({
            receiveMessages: async () => [message]
        }),
        close: async () => {}
    }),
    createTopicClient: () => ({
        createSender: () => ({
            scheduleMessage: async () => {
                throw new Error('scheduleMessage should not be called during smoke test');
            }
        }),
        close: async () => {}
    }),
    close: async () => {}
};

const axiosStub = {
    post: async (url, payload) => {
        if (!url.endsWith('/lease')) {
            throw new Error('Unexpected S2S URL: ' + url);
        }
        if (!payload || payload.microservice !== 'payment_app') {
            throw new Error('Unexpected S2S payload');
        }
        return { data: 'smoke-service-token', status: 200 };
    },
    put: async (url, payload, options) => {
        const body = JSON.stringify(payload);
        return await new Promise((resolve, reject) => {
            const req = http.request(url, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body),
                    'ServiceAuthorization': options && options.headers && options.headers.ServiceAuthorization
                }
            }, (res) => {
                let responseBody = '';
                res.on('data', (chunk) => {
                    responseBody += chunk;
                });
                res.on('end', () => {
                    resolve({
                        status: res.statusCode,
                        data: responseBody ? JSON.parse(responseBody) : {}
                    });
                });
            });
            req.on('error', reject);
            req.write(body);
            req.end();
        });
    }
};

const configStub = {
    get: (key) => {
        const values = {
            servicecallbackBusConnection: 'Endpoint=sb://smoke-test/',
            servicecallbackTopicName: 'ccpay-service-callback-topic',
            servicecallbackSubscriptionName: 'serviceCallbackPremiumSubscription',
            processMessagesCount: 1,
            delayMessageMinutes: 30,
            s2sUrl: 'http://smoke-s2s.local',
            'secrets.ccpay.payment-s2s-secret': 'Dummy',
            microservicePaymentApp: 'payment_app',
            extraServiceLogging: false,
            appInsightsInstumentationKey: '00000000-0000-0000-0000-000000000000',
            serviceCallbackUrlPattern: '^https?://(?:[a-z0-9-]+-(aat|prod|demo|ithc|perftest)\\.service\\.core-compute-\\1\\.internal|(?:www\\.)?(?:apply-divorce|end-civil-partnership)\\.service\\.gov\\.uk|(?:[a-z0-9-]+-)?pr-\\d+\\.preview\\.platform\\.hmcts\\.net|127\\.0\\.0\\.1(?::\\d+)?)(?:/.*)?$'
        };
        return values[key];
    }
};

const applicationInsightsStub = {
    DistributedTracingModes: {
        AI_AND_W3C: 'AI_AND_W3C'
    },
    defaultClient: {
        context: {
            keys: {
                cloudRole: 'cloudRole'
            },
            tags: {}
        },
        config: {
            maxBatchSize: 0
        },
        addTelemetryProcessor: () => {}
    },
    setup: () => ({
        setAutoDependencyCorrelation: () => ({
            setAutoCollectConsole: () => ({
                setDistributedTracingMode: () => ({
                    setSendLiveMetrics: () => applicationInsightsStub
                })
            })
        })
    }),
    start: () => {}
};

Module._load = function patchedLoad(request, parent, isMain) {
    if (request === '@azure/service-bus') {
        return {
            ServiceBusClient: {
                createFromConnectionString: () => sbClientStub
            },
            ReceiveMode: {
                peekLock: 'peekLock'
            }
        };
    }

    if (request === 'axios') {
        return axiosStub;
    }

    if (request === 'config') {
        return configStub;
    }

    if (request === '@hmcts/properties-volume') {
        return {
            addTo: (loadedConfig) => loadedConfig
        };
    }

    if (request === 'applicationinsights') {
        return applicationInsightsStub;
    }

    return originalLoad(request, parent, isMain);
};
