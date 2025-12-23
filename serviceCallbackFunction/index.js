const serviceCallbackFunction = require('./serviceCallbackFunction');
const appInsights = require("applicationinsights");
const config = require('config');

appInsights.setup(config.get('appInsightsInstumentationKey'))
    .setAutoDependencyCorrelation(true)
    .setAutoCollectConsole(true, true)
    .setDistributedTracingMode(appInsights.DistributedTracingModes.AI_AND_W3C)
    .setSendLiveMetrics(true);
appInsights.defaultClient.context.tags[appInsights.defaultClient.context.keys.cloudRole] = 'ccpay-callback-function';
appInsights.defaultClient.config.maxBatchSize = 0;
appInsights.defaultClient.config.samplingPercentage = 1;
appInsights.start();
serviceCallbackFunction().catch((err) => {
  console.log("Error occurred: ", err);
});