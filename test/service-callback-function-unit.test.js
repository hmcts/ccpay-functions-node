'use strict';

const proxyquire = require('proxyquire');
let serviceCallbackFunction;

let axiosRequest = require('axios');

const sandbox = require('sinon').createSandbox();
let chai = require('chai');
let expect = chai.expect;
let sinonChai = require('sinon-chai');
const validServiceCallbackUrl = 'https://payments-aat.service.core-compute-aat.internal/callback';
const invalidServiceCallbackUrl = 'https://www.example.com/callback';

chai.use(sinonChai);

let messages, loggerStub, response;
beforeEach(function () {
    console = {
        log: sandbox.stub()
    };

    const sbClientStub = {
        createSubscriptionClient: sandbox.stub().returnsThis(),
        createReceiver: sandbox.stub().returnsThis(),
        receiveMessages: sandbox.stub().callsFake(() => Promise.resolve(messages)),
        createTopicClient: sandbox.stub().returnsThis(),
        scheduleMessage: sandbox.stub().resolves(),
        createSender: sandbox.stub().returnsThis(),
        close: sandbox.stub().returnsThis()
    };

    serviceCallbackFunction = proxyquire('../serviceCallbackFunction/serviceCallbackFunction', {
        '@azure/service-bus': {
            ServiceBusClient: {
                createFromConnectionString: sandbox.stub().returns(sbClientStub)
            },
            ReceiveMode: {
                peekLock: 'peekLock'
            }
        }
    });
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
                serviceCallbackUrl: validServiceCallbackUrl
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
        expect(console.log).to.have.been.callCount(6);
        expect(console.log).to.have.been.calledWith('1234: Processing message from service Example');
        expect(console.log).to.have.been.calledWithMatch('1234: Received callback message:');
        expect(console.log).to.have.been.calledWith('1234: Received Callback Message is Valid!!!');
        expect(console.log).to.have.been.calledWithMatch('1234: About to post callback URL');
        expect(console.log).to.have.been.calledWith('1234: Response: {"amount":3000000}');
        expect(console.log).to.have.been.calledWith(`1234: Message Sent Successfully to ${validServiceCallbackUrl}`);
    });
});

describe("When callback url does not match allowed pattern", function () {
    before(function () {
        messages = [{
            correlationId: 1234,
            body: JSON.stringify({
                "amount": 3000000,
            }),
            userProperties: {
                retries: 0,
                serviceName: 'Example',
                serviceCallbackUrl: invalidServiceCallbackUrl
            },
            complete: sandbox.stub(),
            clone: sandbox.stub(),
            deadLetter: sandbox.stub().resolves()
        }];
    });

    it('dead letters message and skips downstream calls', async function () {
        await serviceCallbackFunction();
        expect(messages[0].deadLetter).to.have.been.calledOnce;
        expect(console.log).to.have.been.calledWith(`1234: Invalid service callback url pattern, sending to dead letter: ${invalidServiceCallbackUrl}`);
    });
});

describe("When validating callback url allowlist matching", function () {
    const validUrls = [
        'https://payments-aat.service.core-compute-aat.internal/callback',
        'https://payments-prod.service.core-compute-prod.internal/callback',
        'https://payments-demo.service.core-compute-demo.internal/callback',
        'https://payments-ithc.service.core-compute-ithc.internal/callback',
        'https://payments-perftest.service.core-compute-perftest.internal/callback',
        'https://payments-aat.service.core-compute-aat.internal/callback?foo=bar',
        'https://apply-divorce.service.gov.uk/callback',
        'https://www.apply-divorce.service.gov.uk/callback',
        'https://end-civil-partnership.service.gov.uk/callback'
    ];
    const invalidUrls = [
        'https://payments-aat.service.core-compute-prod.internal/callback',
        'http://127.0.0.1/callback',
        'https://localhost/callback',
        'ftp://payments-aat.service.core-compute-aat.internal/callback',
        'https://www.example.com/callback',
        'https://probate.service.gov.uk/callback'
    ];

    const runWithUrl = async (url) => {
        messages = [{
            correlationId: 1234,
            body: JSON.stringify({
                "amount": 3000000,
            }),
            userProperties: {
                retries: 0,
                serviceName: 'Example',
                serviceCallbackUrl: url
            },
            complete: sandbox.stub(),
            clone: sandbox.stub(),
            deadLetter: sandbox.stub().resolves()
        }];
        sandbox.stub(axiosRequest, 'put').resolves({"data":{"amount":3000000},status:200});
        sandbox.stub(axiosRequest, 'post').resolves({"data":"12345",status:200});
        await serviceCallbackFunction();
        return messages[0];
    };

    validUrls.forEach((url) => {
        it(`accepts and processes valid callback url: ${url}`, async function () {
            const message = await runWithUrl(url);
            expect(axiosRequest.post).to.have.been.calledOnce;
            expect(axiosRequest.put).to.have.been.calledOnce;
            expect(message.deadLetter).to.not.have.been.called;
        });
    });

    invalidUrls.forEach((url) => {
        it(`rejects and dead-letters invalid callback url: ${url}`, async function () {
            const message = await runWithUrl(url);
            expect(message.deadLetter).to.have.been.calledOnce;
            expect(axiosRequest.post).to.not.have.been.called;
            expect(axiosRequest.put).to.not.have.been.called;
        });
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
                serviceCallbackUrl: validServiceCallbackUrl
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
                serviceCallbackUrl: validServiceCallbackUrl
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
                serviceCallbackUrl: validServiceCallbackUrl
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
                serviceCallbackUrl: validServiceCallbackUrl
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
                serviceCallbackUrl: validServiceCallbackUrl
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
                serviceCallbackUrl: validServiceCallbackUrl
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


afterEach(function () {
    sandbox.restore();
});
