FROM mcr.microsoft.com/azure-functions/node:3.0-node12-slim

ENV AzureWebJobsScriptRoot=/home/site/wwwroot \
    AzureFunctionsJobHost__Logging__Console__IsEnabled=true


COPY . /home/site/wwwroot

RUN cd /home/site/wwwroot && \
    npm install --production