'use strict';

const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const port = Number(process.env.SMOKE_TEST_PORT || 3055);
const host = '127.0.0.1';
const callbackPath = '/smoke-callback';
const callbackUrl = `http://${host}:${port}${callbackPath}`;
const expectedBody = {
    service_request_reference: 'smoke-test-reference',
    ccd_case_number: '1234567890123456',
    service_request_amount: 300,
    service_request_status: 'Paid',
    payment: {
        payment_amount: 300,
        payment_reference: 'RC-SMOKE-TEST',
        payment_method: 'payment by account',
        case_reference: '123245677',
        account_number: 'PBA0082126'
    }
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
    let callbackReceived = false;
    let callbackHeaders;
    let callbackBody;
    let callbackStatusCode;
    let observedSuccessLog = false;

    const server = http.createServer((req, res) => {
        if (req.method !== 'PUT' || req.url !== callbackPath) {
            res.statusCode = 404;
            res.end('not found');
            return;
        }

        let body = '';
        req.on('data', (chunk) => {
            body += chunk;
        });
        req.on('end', () => {
            callbackReceived = true;
            callbackHeaders = req.headers;
            callbackBody = JSON.parse(body);
            callbackStatusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true }));
        });
    });

    await new Promise((resolve, reject) => {
        server.listen(port, host, (err) => {
            if (err) {
                reject(err);
                return;
            }
            resolve();
        });
    });

    const child = spawn(process.execPath, ['-r', path.join(process.cwd(), 'smoke-test/bootstrap.js'), 'serviceCallbackFunction/index.js'], {
        cwd: process.cwd(),
        env: {
            ...process.env,
            NODE_ENV: 'test',
            APPINSIGHTS_INSTRUMENTATIONKEY: '00000000-0000-0000-0000-000000000000',
            SMOKE_CALLBACK_URL: callbackUrl,
            SMOKE_EXPECTED_BODY: JSON.stringify(expectedBody)
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let closed = false;

    const childDone = new Promise((resolve, reject) => {
        child.on('error', reject);
        child.on('close', (code, signal) => {
            closed = true;
            resolve({ code, signal });
        });
    });

    child.stdout.on('data', (chunk) => {
        const value = chunk.toString();
        stdout += value;
        if (value.includes('Message Sent Successfully')) {
            observedSuccessLog = true;
        }
        process.stdout.write(value);
    });

    child.stderr.on('data', (chunk) => {
        const value = chunk.toString();
        stderr += value;
        process.stderr.write(value);
    });

    const timeoutAt = Date.now() + 15000;
    while (!callbackReceived && Date.now() < timeoutAt) {
        await wait(100);
    }

    if (!callbackReceived) {
        if (!closed) {
            child.kill('SIGTERM');
        }
        await childDone.catch(() => undefined);
        await new Promise((resolve) => server.close(resolve));
        throw new Error(`Smoke callback was not received within timeout\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
    }

    await Promise.race([childDone, wait(1000)]);
    if (!closed) {
        child.kill('SIGTERM');
    }

    const { code, signal } = await childDone;
    await new Promise((resolve) => server.close(resolve));

    if (code !== 0 && signal !== 'SIGTERM') {
        throw new Error(`Smoke function exited unexpectedly with code ${code} signal ${signal}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
    }

    if (callbackStatusCode !== 200) {
        throw new Error(`Unexpected callback status: ${callbackStatusCode}`);
    }

    if (!callbackHeaders || callbackHeaders.serviceauthorization !== 'smoke-service-token') {
        throw new Error(`Missing or unexpected ServiceAuthorization header: ${callbackHeaders && callbackHeaders.serviceauthorization}`);
    }

    if (JSON.stringify(callbackBody) !== JSON.stringify(expectedBody)) {
        throw new Error(`Unexpected callback body: ${JSON.stringify(callbackBody)}`);
    }

    if (!observedSuccessLog) {
        throw new Error(`Smoke test did not observe success log output\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
    }

    process.stdout.write('[smoke] Smoke test passed\n');
}

main().catch((err) => {
    process.stderr.write(`[smoke] ${err.stack || err.message}\n`);
    process.exitCode = 1;
});
