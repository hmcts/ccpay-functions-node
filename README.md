**Payments Functions for Azure**

**Service Callback**

Receives a message from the service bus which is then sent to a callback endpoint by HTTP PATCH

**How to test and develop locally**

Go to functions directory `$ cd functions`

Installation


`yarn install`

Configuration

Set below environment variables with corresponding servicebus you want to connect to.

- SERVICE_CALLBACK_BUS_CONNECTION
- SERVICE_CALLBACK_SUBSCRIPTION
- SERVICE_CALLBACK_URL_PATTERN

`SERVICE_CALLBACK_URL_PATTERN` can be overridden externally when additional callback URLs need to be allowed. The pattern below supports:

- internal callback URLs such as `http://prl-cos-demo.service.core-compute-demo.internal/service-request-update`
- preview callback URLs such as `https://probate-back-office-pr-3744.preview.platform.hmcts.net/payment/gor-payment-request-update`, where the numeric `pr-####` segment can be any number

```bash
SERVICE_CALLBACK_URL_PATTERN='^(?:https?:\/\/(?:[a-z0-9-]+-(aat|prod|demo|ithc|perftest)\.service\.core-compute-\1\.internal|(www\.)?(apply-divorce|end-civil-partnership)\.service\.gov\.uk)(?:\/.*)?|http:\/\/pr-\d+\.preview\.platform\.hmcts\.net(?:\/.*)?)$'
```

Start

`yarn start`

Run tests

`yarn test`

Smoke test

`yarn test:smoke`

The smoke test is intended for CI/Jenkins and runs a lightweight end-to-end check of the function without requiring a persistent application instance. It starts a temporary local callback endpoint, runs the function with mocked Azure dependencies, verifies that a callback is sent successfully, and then shuts everything down cleanly.

Functional test (real Service Bus)

`yarn test:functional`

The functional test validates the deployed callback function end-to-end against the **real** Azure Service Bus and a temporary in-cluster callback "rig", so it is only exercised in CI (master pipeline) and the nightly pipeline - it should not be run locally against production infrastructure unless you know what you are doing.

Overview:

- A dedicated functional-test topic `ccpay-service-callback-ft-topic` and subscription `serviceCallbackFunctionalTestSubscription` are provisioned (see `ccpayfr-shared-infrastructure`). Because it is a separate topic, test messages can only ever be consumed by the ephemeral functional-test function deployment, so the code-under-test is always the new image - there is no race with the older production function.
- The pipeline temporarily deploys an ephemeral Helm release (`ccpay-callback-function-ft`) into AKS that runs:
  - the just-built callback function against the functional-test topic,
  - an in-cluster Java REST `rig` (sub-chart `rig`, `Deployment` + `Service`) that records incoming callbacks, and
  - a one-shot `functional-test` Job (sub-chart `functional-test`) that publishes a real message to the functional-test topic and then asserts that the `rig` received the callback with the expected body and a `ServiceAuthorization` header.
- The functional-test Job runs inside the cluster so it can reach the `rig` at `http://<release>-rig:8080` (the Jenkins agent cannot resolve cluster-local DNS). The whole release is torn down after the test regardless of outcome.
- The `rig` and functional-test images are built and pushed to ACR as part of the build (`callback-function-rig`, `callback-function-functional-test`).

The functional-test harness writes a self-contained HTML report (`functional-test/report/index.html`) plus a JUnit XML (`junit.xml`). After the Job completes, the pipeline copies these back from the Job pod (`kubectl cp`) and publishes them in Jenkins:
- an HTML report at `Callback function functional tests result` (via `publishHTML`, same pattern as other ccpay pipelines), and
- a JUnit test result so failures show on the build's test trend.

So you do not need to grep the logs for `[functional] Functional test passed` - the build result and the published HTML report reflect it, and a failure marks the stage/build red.

Required runtime configuration for the functional test (provided by the ephemeral release):

- `SERVICE_CALLBACK_BUS_CONNECTION` - the Service Bus connection string (reuses the existing `ccpay-callback-function-premium-sb` secret)
- `SERVICE_CALLBACK_TOPIC_NAME=ccpay-service-callback-ft-topic`
- `SERVICE_CALLBACK_SUBSCRIPTION=serviceCallbackFunctionalTestSubscription`
- The function's `SERVICE_CALLBACK_URL_PATTERN` is overridden in the ephemeral release to allow the `rig`'s in-cluster URL.

To build/run the functional test pieces locally:

```bash
docker build -t ccpay/callback-function-rig rig
docker build -t ccpay/callback-function-functional-test functional-test
```

.

Debugging tests

Create a new run configuration, choosing `Node.js Mocha` from the drop down. The arguements may need changing. See below example

```
         "args": [
                "--timeout",
                "999999",
                "--colors",
                "${workspaceFolder}/test"
            ],
```