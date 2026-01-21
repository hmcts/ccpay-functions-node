const serviceCallbackFunction = require('./serviceCallbackFunction');
const appInsights = require("applicationinsights");
const config = require('config');

function fineGrainedSampling(envelope) {
  if (
    ['RequestData', 'RemoteDependencyData'].includes(envelope.data.baseType) &&
    envelope.data.baseData.name.includes('/health')
  ) {
    envelope.sampleRate = 1;
  }

  return true;
}

appInsights.setup(config.get('appInsightsInstumentationKey'))
    .setAutoDependencyCorrelation(true)
    .setAutoCollectConsole(true, true)
    .setDistributedTracingMode(appInsights.DistributedTracingModes.AI_AND_W3C)
    .setSendLiveMetrics(true);
appInsights.defaultClient.context.tags[appInsights.defaultClient.context.keys.cloudRole] = 'ccpay-callback-function';
appInsights.defaultClient.config.maxBatchSize = 0;
appInsights.defaultClient.addTelemetryProcessor(fineGrainedSampling);
appInsights.start();
serviceCallbackFunction().catch((err) => {
  console.log("Error occurred: ", err);
});