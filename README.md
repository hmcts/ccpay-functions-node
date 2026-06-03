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
