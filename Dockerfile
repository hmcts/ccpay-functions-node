FROM hmctspublic.azurecr.io/base/node:14-alpine as base

USER root
RUN corepack enable
USER hmcts

COPY --chown=hmcts:hmcts . .
RUN yarn workspaces focus --all --production \
  && yarn cache clean

# ---- Build image ----
FROM base as build
RUN yarn install --immutable

# ---- Runtime imge ----
FROM base as runtime
COPY . .