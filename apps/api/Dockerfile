# syntax=docker/dockerfile:1.7
# API image. Build from the repository root:
#   docker build -f apps/api/Dockerfile -t effinance-api .
# Runs the server by default; migrations are a one-off task with the migrator credentials:
#   docker run --rm -e DATABASE_URL=... effinance-api node dist/migrate.js

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS build
# Manifests first (cached install layer); every workspace package.json keeps the lockfile valid.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter @effinance/api...
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @effinance/api build \
 && pnpm --filter @effinance/api deploy --prod --legacy /out

FROM node:22-alpine AS runtime
ENV NODE_ENV=production PORT=3333 HOST=0.0.0.0
RUN apk add --no-cache tini \
 && addgroup -S effinance && adduser -S -G effinance -H -s /sbin/nologin effinance
WORKDIR /app
# Code stays owned by root (read-only for the process user).
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/drizzle ./drizzle
USER effinance
EXPOSE 3333
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD wget -qO- http://127.0.0.1:3333/api/health || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
