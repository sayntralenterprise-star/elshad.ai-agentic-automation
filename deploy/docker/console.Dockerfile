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
COPY packages/platform-kit/package.json packages/platform-kit/
COPY packages/sdk-ts/package.json packages/sdk-ts/
COPY packages/telemetry/package.json packages/telemetry/
COPY packages/ui-kit/package.json packages/ui-kit/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY packages /tmp/src/packages
COPY apps/console /tmp/src/apps/console
RUN find /tmp/src \( -name node_modules -o -name dist -o -name .turbo -o -name coverage \) -prune -exec rm -rf {} + \
  && cp -R /tmp/src/packages/. ./packages/ \
  && cp -R /tmp/src/apps/console/. ./apps/console/ \
  && rm -rf /tmp/src \
  && pnpm --filter @elshad/console... build

FROM nginx:1.27-alpine AS runner
COPY deploy/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/console/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
