'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { ServiceBusClient } = require('@azure/service-bus');

const connectionString = process.env.SERVICE_CALLBACK_BUS_CONNECTION;
const topicName = process.env.SERVICE_CALLBACK_TOPIC_NAME || 'ccpay-service-callback-ft-topic';
const rigCallbackUrl = process.env.RIG_CALLBACK_URL;
const rigResultsUrl = process.env.RIG_RESULTS_URL;
const timeoutMs = Number(process.env.FUNCTIONAL_TEST_TIMEOUT_MS || 60000);
const pollIntervalMs = 2000;
const reportDir = process.env.REPORT_DIR || '/tmp/report';

const scenarioName = 'ccpay-callback-function end-to-end against the real Service Bus';

const expectedBody = {
    service_request_reference: 'functional-test-reference',
    ccd_case_number: '1234567890123456',
    service_request_amount: 300,
    service_request_status: 'Paid',
    payment: {
        payment_amount: 300,
        payment_reference: 'RC-FUNCTIONAL-TEST',
        payment_method: 'payment by account',
        case_reference: '123245677',
        account_number: 'PBA0082126'
    }
};

const steps = [];
let startedAt = Date.now();

function record(name, detail, ok) {
    steps.push({
        name,
        detail: detail || '',
        ok: !!ok,
        durationMs: Date.now() - startedAt
    });
    console.log(`${ok ? '[PASS]' : '[FAIL]'} ${name}${detail ? ' - ' + detail : ''}`);
}

function failAndThrow(name, detail) {
    record(name, detail, false);
    throw new Error(detail);
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function request(hostname, port, reqPath) {
    return new Promise((resolve, reject) => {
        const req = http.get({ hostname, port, path: reqPath, timeout: 5000 }, (res) => {
            let body = '';
            res.on('data', (chunk) => {
                body += chunk;
            });
            res.on('end', () => resolve({ status: res.statusCode, body }));
        });
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy(new Error(`timeout calling ${hostname}:${port}${reqPath}`));
        });
    });
}

function parseResults(body) {
    try {
        return JSON.parse(body);
    } catch (err) {
        return {};
    }
}

function htmlEscape(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function renderHtml(passed, failureMessage) {
    const rows = steps.map((s) => {
        const cls = s.ok ? 'pass' : 'fail';
        const icon = s.ok ? '\u2713' : '\u2717';
        return `<tr class="${cls}"><td class="icon">${icon}</td><td>${htmlEscape(s.name)}</td>` +
            `<td>${htmlEscape(s.detail)}</td><td>${s.durationMs}ms</td></tr>`;
    }).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${htmlEscape(scenarioName)}</title>
<style>
  body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; margin: 24px; color: #212529; }
  h1 { font-size: 20px; }
  .summary { font-size: 14px; margin-bottom: 16px; }
  .badge { display:inline-block; padding: 4px 10px; border-radius: 12px; color: #fff; font-weight: 600; }
  .badge.pass { background:#2e7d32; }
  .badge.fail { background:#c62828; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #dee2e6; }
  th { background:#f1f3f5; }
  tr.pass td.icon { color:#2e7d32; }
  tr.fail td.icon { color:#c62828; }
  .fail { color:#c62828; }
  pre { background:#f6f8fa; padding: 12px; border-radius: 6px; overflow:auto; }
</style>
</head>
<body>
  <h1>${htmlEscape(scenarioName)}</h1>
  <div class="summary">
    Result: <span class="badge ${passed ? 'pass' : 'fail'}">${passed ? 'PASSED' : 'FAILED'}</span>
    &nbsp;|&nbsp; Steps: ${steps.length}
    &nbsp;|&nbsp; Total duration: ${Date.now() - startedAt}ms
  </div>
  <table>
    <thead><tr><th></th><th>Step</th><th>Detail</th><th>Duration</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  ${failureMessage ? `<h2>Failure</h2><pre>${htmlEscape(failureMessage)}</pre>` : ''}
</body>
</html>
`;
}

function renderJunitXml(passed, failureMessage) {
    const failure = passed
        ? ''
        : `<failure message="${htmlEscape(failureMessage || 'functional test failed')}"/>`;
    return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites tests="1" failures="${passed ? 0 : 1}" time="${(Date.now() - startedAt) / 1000}">
  <testsuite name="functional-test" tests="1" failures="${passed ? 0 : 1}" time="${(Date.now() - startedAt) / 1000}">
    <testcase name="${htmlEscape(scenarioName)}" classname="ccpay-callback-function">${failure}</testcase>
  </testsuite>
</testsuites>
`;
}

function writeReport(passed, failureMessage) {
    try {
        fs.mkdirSync(reportDir, { recursive: true });
        fs.writeFileSync(path.join(reportDir, 'index.html'), renderHtml(passed, failureMessage));
        fs.writeFileSync(path.join(reportDir, 'junit.xml'), renderJunitXml(passed, failureMessage));
        record(`Write report to ${reportDir}`, 'index.html + junit.xml', true);
    } catch (err) {
        record(`Write report to ${reportDir}`, err.message, false);
    }
}

// Emit both report files base64-encoded to stdout so Jenkins can retrieve them via kubectl logs
// even after the pod has terminated (kubectl cp cannot exec into a completed pod). Each file uses
// its own start/end markers so the Jenkinsfile can extract and decode them with sed + base64 -d
// (avoiding Groovy decodeBase64, which the Jenkins sandbox forbids).
function emitReportToStdout(passed, failureMessage) {
    try {
        fs.mkdirSync(reportDir, { recursive: true });
        const html = renderHtml(passed, failureMessage);
        const junit = renderJunitXml(passed, failureMessage);
        process.stdout.write('FUNCTIONAL_REPORT_HTML_B64_START\n' + Buffer.from(html).toString('base64') + '\nFUNCTIONAL_REPORT_HTML_B64_END\n');
        process.stdout.write('FUNCTIONAL_REPORT_JUNIT_B64_START\n' + Buffer.from(junit).toString('base64') + '\nFUNCTIONAL_REPORT_JUNIT_B64_END\n');
    } catch (err) {
        process.stdout.write('FUNCTIONAL_REPORT_HTML_B64_START\nFUNCTIONAL_REPORT_HTML_B64_END\nFUNCTIONAL_REPORT_JUNIT_B64_START\nFUNCTIONAL_REPORT_JUNIT_B64_END\n');
    }
}

async function main() {
    startedAt = Date.now();

    if (!connectionString) {
        failAndThrow('Preconditions', 'SERVICE_CALLBACK_BUS_CONNECTION is not set');
    }
    if (!rigCallbackUrl || !rigResultsUrl) {
        failAndThrow('Preconditions', 'RIG_CALLBACK_URL and RIG_RESULTS_URL must be set');
    }

    const rigUrl = new URL(rigResultsUrl);

    let ready = false;
    const readyDeadline = Date.now() + timeoutMs;
    while (!ready && Date.now() < readyDeadline) {
        try {
            const res = await request(rigUrl.hostname, rigUrl.port || 80, rigUrl.pathname);
            if (res.status === 200) {
                ready = true;
            }
        } catch (err) {
            // rig not up yet
        }
        if (!ready) {
            await wait(pollIntervalMs);
        }
    }
    if (!ready) {
        failAndThrow('Wait for rig to be ready', `No response from ${rigResultsUrl} within ${timeoutMs}ms`);
    }
    record('Wait for rig to be ready', rigResultsUrl, true);

    const sbClient = ServiceBusClient.createFromConnectionString(connectionString);
    const sender = sbClient.createTopicClient(topicName).createSender();
    const message = {
        body: expectedBody,
        correlationId: `functional-test-${Date.now()}`,
        applicationProperties: {
            serviceName: 'FunctionalTest',
            serviceCallbackUrl: rigCallbackUrl,
            retries: 0
        }
    };

    try {
        await sender.send(message);
    } finally {
        await sender.close();
        await sbClient.close();
    }
    record('Publish test message to functional-test topic', `${topicName} (${message.correlationId})`, true);

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const res = await request(rigUrl.hostname, rigUrl.port || 80, rigUrl.pathname);
        const results = parseResults(res.body);
        if (results.received) {
            const bodyMatches = JSON.stringify(results.body) === JSON.stringify(expectedBody);
            const authz = results.headers && (
                results.headers.ServiceAuthorization ||
                results.headers.serviceauthorization
            );
            record('Callback received by rig', `bodyMatches=${bodyMatches}, authorizationHeader=${Boolean(authz)}`, bodyMatches && !!authz);
            if (bodyMatches && authz) {
                record('Callback content + ServiceAuthorization verified', 'body and header match expected', true);
                return;
            }
            throw new Error(`Callback content mismatch: ${res.body}`);
        }
        await wait(pollIntervalMs);
    }

    throw new Error(`Callback was not received by the rig within ${timeoutMs}ms`);
}

main().then(() => {
    writeReport(true);
    emitReportToStdout(true);
    process.stdout.write('[functional] Functional test passed\n');
}).catch((err) => {
    const failureMessage = `${err.stack || err.message}`;
    process.stderr.write(`[functional] ${failureMessage}\n`);
    writeReport(false, failureMessage);
    emitReportToStdout(false, failureMessage);
    process.exitCode = 1;
});