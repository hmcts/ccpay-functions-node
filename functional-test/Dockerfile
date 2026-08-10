FROM hmctsprod.azurecr.io/base/node:20-alpine
USER root
WORKDIR /app
COPY package.json functional-test.js ./
RUN npm install --omit=dev
USER hmcts
ENTRYPOINT ["node", "functional-test.js"]