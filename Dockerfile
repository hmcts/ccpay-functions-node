FROM hmctspublic.azurecr.io/base/node:14-alpine as base

USER root
RUN corepack enable
USER hmcts

COPY --chown=hmcts:hmcts package.json yarn.lock ./

RUN yarn install --immutable \
  && yarn cache clean

# ---- Runtime imge ----
FROM base as runtime
COPY . .