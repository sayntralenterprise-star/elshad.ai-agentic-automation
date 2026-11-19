# syntax=docker/dockerfile:1

FROM node:22-alpine AS base
WORKDIR /app
RUN npm install -g pnpm@12.14.0 && npm cache clean --force

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/console/package.json apps/console/
COPY apps/engine/package.json apps/engine/
COPY apps/worker/package.json apps/worker/
COPY packages/api-contract/package.json packages/api-contract/
COPY packages/authz/package.json packages/authz/
COPY packages/config/package.json packages/config/
COPY packages/db/package.json packages/db/
COPY packages/domain/package.json packages/domain/
COPY packages/execution/package.json packages/execution/
COPY packages/memory-kit/package.json packages/memory-kit/
COPY packages/model-kit/package.json packages/model-kit/
COPY packages/platform-kit/package.json packages/platform-kit/
COPY packages/policy-kit/package.json packages/policy-kit/
COPY packages/runtime-core/package.json packages/runtime-core/
COPY packages/sdk-ts/package.json packages/sdk-ts/
COPY packages/telemetry/package.json packages/telemetry/
COPY packages/tool-kit/package.json packages/tool-kit/
COPY packages/ui-kit/package.json packages/ui-kit/
COPY packages/workflow-core/package.json packages/workflow-core/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY packages /tmp/src/packages
COPY apps/api /tmp/src/apps/api
RUN find /tmp/src \( -name node_modules -o -name dist -o -name .turbo -o -name coverage \) -prune -exec rm -rf {} + \
  && cp -R /tmp/src/packages/. ./packages/ \
  && cp -R /tmp/src/apps/api/. ./apps/api/ \
  && rm -rf /tmp/src \
  && pnpm --filter @elshad/api... build \
  && CI=true pnpm prune --prod --yes

FROM base AS runtime-base
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/packages ./packages
COPY --from=build --chown=node:node /app/apps/api ./apps/api
USER node

FROM runtime-base AS migrate
CMD ["./packages/db/node_modules/.bin/node-pg-migrate", "up", "-m", "packages/db/migrations"]

FROM runtime-base AS runner
EXPOSE 8080
CMD ["node", "apps/api/dist/main.js"]
