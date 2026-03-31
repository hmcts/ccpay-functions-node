'use strict';

const chai = require('chai');
const sinon = require('sinon');
const sinonChai = require('sinon-chai');
const nodemailer = require('nodemailer');
const smtpClient = require('../serviceCallbackFunction/smtpClient');

chai.use(sinonChai);
const expect = chai.expect;

describe('smtpClient.sendMail', function () {
    const sandbox = sinon.createSandbox();

    afterEach(function () {
        sandbox.restore();
    });

    it('creates a transport with smtpConfig and sends mail with mailOptions', async function () {
        const smtpConfig = {
            host: 'smtp.example.test',
            port: 587,
            secure: false
        };
        const mailOptions = {
            from: 'from@example.com',
            to: 'to@example.com',
            subject: 'Subject',
            text: 'Body'
        };
        const sendMailResult = { accepted: ['to@example.com'] };
        const sendMailStub = sandbox.stub().resolves(sendMailResult);

        const createTransportStub = sandbox.stub(nodemailer, 'createTransport').returns({
            sendMail: sendMailStub
        });

        const result = await smtpClient.sendMail(smtpConfig, mailOptions);

        expect(createTransportStub).to.have.been.calledOnceWithExactly(smtpConfig);
        expect(sendMailStub).to.have.been.calledOnceWithExactly(mailOptions);
        expect(result).to.equal(sendMailResult);
    });
});
