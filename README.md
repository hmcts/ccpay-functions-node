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

Start

`yarn start` 

Run tests

`yarn test`
