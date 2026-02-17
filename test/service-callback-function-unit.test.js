'use strict';

const { ServiceBusClient } = require("@azure/service-bus");
let serviceCallbackFunction = require('../serviceCallbackFunction/serviceCallbackFunction');
const smtpClient = require('../serviceCallbackFunction/smtpClient');

let axiosRequest = require('axios');

const sandbox = require('sinon').createSandbox();
let chai = require('chai');
let expect = chai.expect;
let sinonChai = require('sinon-chai');

chai.use(sinonChai);

let messages, loggerStub, response;
beforeEach(function () {
    console = {
        log: sandbox.stub()
    }

    const sbClientStub = {
        createSubscriptionClient: sandbox.stub().returnsThis(),
        createReceiver: sandbox.stub().returnsThis(),
        receiveMessages: sandbox.stub().resolves(messages),
        createTopicClient: sandbox.stub().returnsThis(),
        scheduleMessage: sandbox.stub().resolves(),
        createSender: sandbox.stub().returnsThis(),
        close: sandbox.stub().returnsThis()
    };

    sandbox.stub(ServiceBusClient, 'createFromConnectionString').callsFake(() => sbClientStub);
});

describe("When messages are received", function () {
    before(function () {
        messages = [{
            correlationId: 1234,
            body: JSON.stringify({
                "amount": 3000000,
            }),
            userProperties: {
                retries: 0,
                serviceName: 'Example',
                serviceCallbackUrl: 'www.example.com'
            },
            complete: sandbox.stub(),
            clone: sandbox.stub()
        }];
        sandbox.stub(axiosRequest, 'put').resolves({"data":{"amount":3000000},status:200});
        sandbox.stub(axiosRequest, 'post').resolves({"data":"12345",status:200});
    });

    it('the desired url is called back', async function () {
        await serviceCallbackFunction();
        expect(axiosRequest.post).to.have.been.calledOnce;
        expect(axiosRequest.put).to.have.been.calledOnce;
        expect(messages[0].complete).to.have.been.called;
        expect(console.log).to.have.been.callCount(7);
        expect(console.log).to.have.been.calledWith('1234: Processing message from service Example');
        expect(console.log).to.have.been.calledWithMatch('1234: Received callback message:');
        expect(console.log).to.have.been.calledWith('1234: Received Callback Message is Valid!!!');
        expect(console.log).to.have.been.calledWith('1234: S2S Token Retrieved.......');
        expect(console.log).to.have.been.calledWithMatch('1234: About to post callback URL');
        expect(console.log).to.have.been.calledWith('1234: Response: {"amount":3000000}');
        expect(console.log).to.have.been.calledWith('1234: Message Sent Successfully to www.example.com');
    });
});

describe("When received message has no callback url", function () {
    before(function () {
        messages = [{
            correlationId: 1234,
            body: JSON.stringify({
                "amount": 3000000,
            }),
            userProperties: {
                retries: 0
            },
            complete: sandbox.stub(),
            clone: sandbox.stub(),
            deadLetter: sandbox.stub().rejects()
        }];
    });

    it('if there is no callback url and error is logged and no url is called back', async function () {
        await serviceCallbackFunction();
        expect(console.log).to.have.been.calledWithMatch('1234: No service callback url...');
        expect(messages[0].deadLetter).to.have.been.called
    });
});

describe("When no message recieved", function () {
    before(function () {
        messages = [];
    });

    it('if there is no message, an info is logged', async function () {
        await serviceCallbackFunction();
        expect(console.log).to.have.been.calledWith('No messages received from ServiceBusTopic!!!');
    });

});

describe("When no body recieved", function () {
    before(function () {
        messages = [{
            correlationId: 1234,
            complete: sandbox.stub(),
            deadLetter: sandbox.stub(),
        }
        ];
    });

    it('if there is no body, an error is logged', async function () {
        await serviceCallbackFunction();
        expect(console.log).to.have.been.calledWith('1234: No body received');
        expect(messages[0].deadLetter).to.have.been.called
    });
});

describe("When no userproperties recieved", function () {
    before(function () {
        messages = [{
            correlationId: 1234,
            body: JSON.stringify({
                "amount": 3000000,
            }),
            complete: sandbox.stub(),
            deadLetter: sandbox.stub()
        }];
    });

    it('if there is no body, an error is logged', async function () {
        await serviceCallbackFunction();
        expect(console.log).to.have.been.calledWith('1234: No userProperties data');
        expect(messages[0].deadLetter).to.have.been.called
    });
});

describe("When serviceCallbackUrl returns success, s2sToken not received. 5 retries expected so 6 attempts in total.", function () {
    let error = new Error("S2SToken Failed");
    before(function () {
        sandbox.stub(axiosRequest, 'post').throws(error);
        messages = [{
            correlationId: 1234,
            body: JSON.stringify({
                "amount": 3000000,
            }),
            userProperties: {
                serviceCallbackUrl: 'www.example.com'
            },
            complete: sandbox.stub().resolves(),
            clone: sandbox.stub(),
            deadLetter: sandbox.stub().resolves()
        }];
    });

    it('if there is an error from S2S Service Token, an error is logged', async function () {
        await serviceCallbackFunction();
        await serviceCallbackFunction();
        await serviceCallbackFunction();
        await serviceCallbackFunction();
        await serviceCallbackFunction();
        expect(axiosRequest.post).to.throw(error)
        expect(axiosRequest.post).callCount(6);
        expect(messages[0].userProperties.retries).to.equals(5);
        expect(console.log).to.have.been.calledWithMatch('1234: Will retry message at a later time');
        expect(console.log).to.have.been.calledWithMatch('1234: Message is scheduled to retry at UTC:');
        expect(messages[0].clone).to.have.been.called
    });
});

describe("When serviceCallbackUrl returns success, but sending callback request fails. 5 retries expected so 6 attempts in total.", function () {
    let error = new Error("Callback Failed");
    before(function () {
        messages = [{
            correlationId: 1234,
            body: JSON.stringify({
                "amount": 3000000,
            }),
            userProperties: {
                serviceCallbackUrl: 'www.example.com'
            },
            complete: sandbox.stub(),
            clone: sandbox.stub()
        }];
        sandbox.stub(axiosRequest, 'put').throws(error);
        sandbox.stub(axiosRequest, 'post').resolves({"data":"12345",status:200});
    });

    it('if there is an error from Callback, an error is logged', async function () {
        await serviceCallbackFunction();
        await serviceCallbackFunction();
        await serviceCallbackFunction();
        await serviceCallbackFunction();
        await serviceCallbackFunction();
        expect(axiosRequest.put).to.throw(error);
        expect(axiosRequest.put).callCount(6);
        expect(messages[0].clone).to.have.been.called
        expect(messages[0].userProperties.retries).to.equals(5); 
    });
});

describe("When serviceCallbackUrl generates unrecoverable error", function () {
    let err = new Error("S2SToken Failed");
    before(function () {
        messages = [{
            correlationId: 1234,
            body: sandbox.stub().throws(err),
            complete: sandbox.stub().resolves(),
            clone: sandbox.stub(),
            deadLetter: sandbox.stub().resolves()
        }];
    });

    it('if there is an error from validating message, an error is logged', async function () {
        await serviceCallbackFunction();
        expect(console.log).to.have.been.calledWith('1234: Skipping processing invalid message and sending to dead letterundefined');
    });
});

describe("When serviceCallbackUrl returns error, deadletter success", function () {
    before(function () {
        sandbox.stub(axiosRequest, 'put').resolves({"data":{},status:500});
        sandbox.stub(axiosRequest, 'post').resolves({"data":"12345",status:200});
        messages = [{
            body: JSON.stringify({
                "amount": 3000000,
            }),
            userProperties: {
                serviceCallbackUrl: 'www.example.com'
            },
            complete: sandbox.stub().resolves(),
            clone: sandbox.stub(),
            deadLetter: sandbox.stub().rejects()
        }];
    });

    it('if there is an error from serviceCallbackUrl, an error is logged', async function () {
        await serviceCallbackFunction();
        expect(axiosRequest.put).to.have.been.calledOnce;
        expect(messages[0].clone).to.have.been.called
        expect(messages[0].userProperties.retries).to.equals(1);
    });

});

describe("When serviceCallbackUrl returns error, deadletter success", function () {
    before(function () {
        sandbox.stub(axiosRequest, 'put').resolves({"data":{},status:500});
        sandbox.stub(axiosRequest, 'post').resolves({"data":"12345",status:200});
        messages = [{
            correlationId: 1234,
            body: JSON.stringify({
                "amount": 3000000,
            }),
            userProperties: {
                serviceCallbackUrl: 'www.example.com'
            },
            complete: sandbox.stub().resolves(),
            clone: sandbox.stub(),
            deadLetter: sandbox.stub().rejects()
        }];
    });

    it('if there is an error from serviceCallbackUrl for 5 times', async function () {
         await serviceCallbackFunction();
         await serviceCallbackFunction();
         await serviceCallbackFunction();
         await serviceCallbackFunction();
         await serviceCallbackFunction();
         expect(axiosRequest.put).to.have.been.callCount(5);
         expect(messages[0].clone).to.have.been.called
         expect(messages[0].userProperties.retries).to.equals(5);
     });
});

describe("When serviceCallbackUrl returns error, deadletter fails", function () {
    before(function () {
        sandbox.stub(axiosRequest, 'put').resolves({"data":{},status:500});
        sandbox.stub(axiosRequest, 'post').resolves({"data":"12345",status:200});
        messages = [{
            correlationId: 1234,
            body: JSON.stringify({
                "amount": 3000000,
            }),
            userProperties: {
                serviceCallbackUrl: 'www.example.com'
            },
            complete: sandbox.stub().resolves(),
            clone: sandbox.stub(),
            deadLetter: sandbox.stub().resolves()
        }];
    });

    it('if there is an error from serviceCallbackUrl, an error is logged', async function () {
        await serviceCallbackFunction();
        expect(axiosRequest.put).to.have.been.calledOnce;
    });

});

describe("When serviceCallbackUrl returns error, deadletter fails", function () {
    before(function () {
        sandbox.stub(axiosRequest, 'put').resolves({"data":{},status:500});
        sandbox.stub(axiosRequest, 'post').resolves({"data":"12345",status:200});
        messages = [{
            correlationId: 1234,
            body: JSON.stringify({
                "amount": 3000000,
            }),
            userProperties: {
                serviceCallbackUrl: 'www.example.com'
            },
            complete: sandbox.stub().resolves(),
            clone: sandbox.stub(),
            deadLetter: sandbox.stub().resolves()
        }];
    });


     it('if there is an error from serviceCallbackUrl for 5 times', async function () {
         await serviceCallbackFunction();
         await serviceCallbackFunction();
         await serviceCallbackFunction();
         expect(axiosRequest.put).to.have.been.calledThrice;
     });
});

describe("When max retries reached and deadletter succeeds with email notification enabled", function () {
    let serviceCallbackFunctionWithDeadLetterEmail;

    before(function () {
        process.env.DEAD_LETTER_EMAIL_ENABLED = 'true';
        process.env.DEAD_LETTER_SMTP_HOST = 'smtp.example.test';
        process.env.DEAD_LETTER_SMTP_PORT = '587';
        process.env.DEAD_LETTER_SMTP_SECURE = 'false';
        process.env.DEAD_LETTER_SMTP_USER = 'smtp-user';
        process.env.DEAD_LETTER_SMTP_PASSWORD = 'smtp-password';
        process.env.DEAD_LETTER_EMAIL_FROM = 'from@example.com';
        process.env.DEAD_LETTER_EMAIL_TO = 'ops@example.com';
        process.env.DEAD_LETTER_EMAIL_SUBJECT = 'Dead letter alert';

        delete require.cache[require.resolve('config')];
        delete require.cache[require.resolve('../serviceCallbackFunction/serviceCallbackFunction')];
        serviceCallbackFunctionWithDeadLetterEmail = require('../serviceCallbackFunction/serviceCallbackFunction');

        messages = [{
            correlationId: 1234,
            body: JSON.stringify({
                "amount": 3000000,
            }),
            userProperties: {
                retries: 5,
                serviceName: 'Example',
                serviceCallbackUrl: 'www.example.com'
            },
            complete: sandbox.stub().resolves(),
            clone: sandbox.stub(),
            deadLetter: sandbox.stub().resolves()
        }];

        const error = new Error("S2SToken Failed");
        sandbox.stub(axiosRequest, 'post').throws(error);
        sandbox.stub(smtpClient, 'sendMail').resolves({ accepted: ['ops@example.com'] });
    });

    after(function () {
        delete process.env.DEAD_LETTER_EMAIL_ENABLED;
        delete process.env.DEAD_LETTER_SMTP_HOST;
        delete process.env.DEAD_LETTER_SMTP_PORT;
        delete process.env.DEAD_LETTER_SMTP_SECURE;
        delete process.env.DEAD_LETTER_SMTP_USER;
        delete process.env.DEAD_LETTER_SMTP_PASSWORD;
        delete process.env.DEAD_LETTER_EMAIL_FROM;
        delete process.env.DEAD_LETTER_EMAIL_TO;
        delete process.env.DEAD_LETTER_EMAIL_SUBJECT;

        delete require.cache[require.resolve('config')];
        delete require.cache[require.resolve('../serviceCallbackFunction/serviceCallbackFunction')];
        serviceCallbackFunction = require('../serviceCallbackFunction/serviceCallbackFunction');
    });

    it('sends an email notification once the message is deadlettered', async function () {
        await serviceCallbackFunctionWithDeadLetterEmail();
        await new Promise((resolve) => setImmediate(resolve));

        expect(axiosRequest.post).to.have.been.calledOnce;
        expect(smtpClient.sendMail).to.have.been.calledWith(
            {
                host: 'smtp.example.test',
                port: 587,
                secure: false,
                tls: {
                    secureProtocol: 'TLSv1.2'
                },
                auth: {
                    user: 'smtp-user',
                    pass: 'smtp-password'
                }
            },
            {
                from: 'from@example.com',
                to: 'ops@example.com',
                subject: 'Dead letter alert',
                text: 'A service callback message has been dead-lettered.\n'
                    + 'correlationId: 1234\n'
                    + 'retries: 5\n'
                    + 'serviceName: Example\n'
                    + 'serviceCallbackUrl: www.example.com\n'
                    + 'messageBody: {"amount":3000000}'
            }
        );
    });
});


afterEach(function () {
    sandbox.restore();
});
