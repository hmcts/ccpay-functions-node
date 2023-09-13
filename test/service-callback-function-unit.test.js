'use strict';

const { ServiceBusClient } = require("@azure/service-bus");
let serviceCallbackFunction = require('../serviceCallbackFunction/serviceCallbackFunction');

let axiosRequest = require('axios');

const sandbox = require('sinon').createSandbox();
let chai = require('chai');
let expect = chai.expect;
let sinonChai = require('sinon-chai');

chai.use(sinonChai);

let messages, loggerStub;
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
                serviceCallbackUrl: 'www.example.com'
            },
            complete: sandbox.stub(),
            clone: sandbox.stub()
        }];
        sandbox.stub(axiosRequest, 'put').yields(null, {"statusCode":200}, null);
        sandbox.stub(axiosRequest, 'post').resolves({"status" : 200, "token":"12345"});
    });

    it('the desired url is called back', async function () {

        await serviceCallbackFunction();
        expect(axiosRequest.post).to.have.been.calledOnce;
        expect(axiosRequest.put).to.have.been.calledOnce;
        expect(messages[0].complete).to.have.been.called;
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

describe("When serviceCallbackUrl returns success, s2sToken not received", function () {
    before(function () {
        sandbox.stub(axiosRequest, 'put').resolves({"token":{status:200}});
        sandbox.stub(axiosRequest, 'post').resolves({"error":{"message":"S2SToken Failed",status:500}});
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
        expect(axiosRequest.post).to.have.been.calledOnce;
    });
});


describe("When serviceCallbackUrl returns error, deadletter success", function () {
    before(function () {
        sandbox.stub(axiosRequest, 'put').resolves({"token":{status:500}});
        sandbox.stub(axiosRequest, 'post').resolves({"token":{"data":"12345",status:200}});
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
        sandbox.stub(axiosRequest, 'put').resolves({"token":{"data":"",status:500}});
        sandbox.stub(axiosRequest, 'post').resolves({"token":{"data":"12345",status:200}});
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

    it('if there is an error from serviceCallbackUrl for 3 times', async function () {
         await serviceCallbackFunction();
         await serviceCallbackFunction();
         await serviceCallbackFunction();
         expect(axiosRequest.put).to.have.been.calledThrice;
         expect(messages[0].clone).to.have.been.called
         expect(messages[0].userProperties.retries).to.equals(3);
     });
});

describe("When serviceCallbackUrl returns error, deadletter fails", function () {
    before(function () {
        sandbox.stub(axiosRequest, 'put').resolves({"token":{"data":"",status:500}});
        sandbox.stub(axiosRequest, 'post').resolves({"token":{"data":"12345",status:200}});
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
        sandbox.stub(axiosRequest, 'put').yields(null, {"statusCode" : 500}, null);
        sandbox.stub(axiosRequest, 'post').resolves({"status" : 200, "token":"12345"});
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


     it('if there is an error from serviceCallbackUrl for 3 times', async function () {
         await serviceCallbackFunction();
         await serviceCallbackFunction();
         await serviceCallbackFunction();
         expect(axiosRequest.put).to.have.been.calledThrice;
     });
});


afterEach(function () {
    sandbox.restore();
});
