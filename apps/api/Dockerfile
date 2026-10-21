# syntax=docker/dockerfile:1.28@sha256:bb22d9815c728170f72750f4e5b0d672e06176142e1d602c7e66c050100b7e5b
# API image. Build from the repository root (BuildKit):
#   docker build -f apps/api/Dockerfile -t effinance-api .
# Runs the server by default; migrations are a one-off task with the migrator credentials:
#   docker run --rm --read-only --cap-drop ALL -e DATABASE_URL=... effinance-api node dist/migrate.js
#
# Hardening (CIS Docker 4.x / OWASP Docker cheat sheet):
# - base image pinned by tag + digest (multi-arch index: amd64 and arm64). Bump both together.
# - dependencies only from pnpm-lock.yaml (--frozen-lockfile; `pnpm deploy` derives a dedicated
#   lockfile from it, never re-resolving from the registry); runtime gets production deps only.
# - no secrets in ARG/ENV/layers: all configuration comes from the environment at run time
#   (ECS task definition `secrets` / Secrets Manager). Never pass secrets as --build-arg.
# - non-root numeric user, application files owned by root (read-only for the process), works
#   with a read-only root filesystem, tini as PID 1 (signal forwarding, zombie reaping).

FROM node:26.12.0-alpine3.24@sha256:6f08a523443ddedf52941874c203475b0ad503e859ad70cb26ab8be9a517dbd5 AS node

FROM node AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# pnpm comes from Corepack with the version + sha512 pinned in package.json#packageManager.
RUN corepack enable
WORKDIR /repo
# Manifests first (cached install layer); every workspace package.json keeps the lockfile valid.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @effinance/api...
COPY packages/shared packages/shared
COPY apps/api apps/api
# The demo seed (known password) never ships in the production image.
RUN pnpm --filter @effinance/api build \
 && rm -f apps/api/dist/seed.js apps/api/dist/seed.js.map
# Production dependencies only. Non-legacy deploy = versions taken from the shared lockfile
# (`--legacy` would resolve the ranges again against the registry at build time).
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @effinance/api deploy --prod --prefer-offline \
      --config.inject-workspace-packages=true /out

FROM node AS runtime
ENV NODE_ENV=production PORT=3333 HOST=0.0.0.0
# tini as init; drop the package managers (npm, npx, corepack, yarn) the app never uses at run
# time; fixed non-root UID/GID so orchestrators can enforce runAsNonRoot.
RUN apk add --no-cache tini \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
      /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-* \
 && addgroup -S -g 10001 effinance \
 && adduser -S -D -H -u 10001 -G effinance -s /sbin/nologin effinance
# Amazon RDS CA bundle for DATABASE_SSL=verify-full (DATABASE_CA_FILE=/etc/ssl/certs/rds-ca-sa-east-1.pem).
# Regional bundle = only the CAs of sa-east-1. Checksum-pinned: if AWS updates the bundle the build
# fails until the new file is reviewed (curl -s <url> | sha256sum).
ADD --checksum=sha256:c2f9255eadfa939dd6f965ede75d8e0d4168c9cbb7ca1e7baa9bff6d5e2c96e1 --chmod=0644 \
    https://truststore.pki.rds.amazonaws.com/sa-east-1/sa-east-1-bundle.pem /etc/ssl/certs/rds-ca-sa-east-1.pem
WORKDIR /app
# Code stays owned by root (read-only for the process user).
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/drizzle ./drizzle
USER 10001:10001
EXPOSE 3333
# Docker/Compose only: ECS and App Runner ignore it (configure their own health checks, see
# docs/deploy-aws.md).
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD wget -q -T 2 -O /dev/null "http://127.0.0.1:${PORT}/api/health" || exit 1
STOPSIGNAL SIGTERM
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
