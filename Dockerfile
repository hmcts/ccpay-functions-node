FROM hmctspublic.azurecr.io/base/node:20-alpine as base

USER root
RUN corepack enable
USER hmcts

COPY --chown=hmcts:hmcts . .
RUN yarn workspaces focus --all --production \
  && yarn cache clean

# ---- Runtime imge ----
FROM base as runtime
COPY . .