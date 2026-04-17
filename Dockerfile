# checkov:skip=CKV_DOCKER_3: entrypoint uses su-exec for runtime privilege drop
# Common Stage
FROM node:24-alpine@sha256:7fddd9ddeae8196abf4a3ef2de34e11f7b1a722119f91f28ddf1e99dcafdf114 AS base
WORKDIR /home/node/app

LABEL maintainer="CodesWhat"
EXPOSE 3000

ARG DD_VERSION=unknown

ENV WORKDIR=/home/node/app
ENV DD_LOG_FORMAT=text
ENV DD_VERSION=$DD_VERSION

HEALTHCHECK --interval=30s --timeout=5s CMD ["sh", "-c", "if [ -n \"$DD_SERVER_ENABLED\" ] && [ \"$DD_SERVER_ENABLED\" != 'true' ]; then exit 0; fi; /bin/healthcheck ${DD_SERVER_PORT:-3000}"]

# Install system packages, trivy, and cosign
RUN apk add --no-cache \
    bash=5.3.3-r1 \
    curl=8.17.0-r1 \
    git=2.52.0-r0 \
    jq=1.8.1-r0 \
    openssl=3.5.6-r0 \
    su-exec=0.3-r0 \
    tini=0.19.0-r3 \
    tzdata=2026a-r0 \
    && apk add --no-cache cosign=2.4.3-r12 \
    && apk add --no-cache --repository=https://dl-cdn.alpinelinux.org/alpine/edge/testing trivy=0.70.0-r0 \
    && apk upgrade --no-cache zlib \
    && mkdir /store && chown node:node /store

# Build stage for healthcheck binary (~65KB static binary)
FROM alpine:3.21@sha256:c3f8e73fdb79deaebaa2037150150191b9dcbfba68b4a46d70103204c53f4709 AS healthcheck-build
RUN apk add --no-cache gcc=14.2.0-r4 musl-dev=1.2.5-r11
COPY healthcheck.c /src/healthcheck.c
RUN gcc -Os -static -s -o /bin/healthcheck /src/healthcheck.c

# Build stage for backend app
FROM base AS app-build

# Copy app package.json
COPY app/package* ./

# Install dependencies (including dev)
RUN npm ci --include=dev --omit=optional --no-audit --no-fund --no-update-notifier

# Copy app source
COPY app/ ./

# Build and remove dev dependencies
RUN npm run build \
    && npm prune --omit=dev

# Build stage for frontend UI
FROM base AS ui-build
WORKDIR /home/node/ui

# Copy ui package.json
COPY ui/package* ./

# Install ui dependencies
RUN npm ci --no-audit --no-fund --no-update-notifier

# Copy ui sources and build static assets
COPY ui/ ./
RUN npm run build

# Release stage
FROM base AS release
ENV DD_LOG_FORMAT=text

# Remove unnecessary network utilities (busybox symlinks) and npm to reduce attack surface.
# curl is kept for backward compatibility with user-defined HEALTHCHECK overrides;
# v1.6.0 is the final warning release, and removal is scheduled for v1.7.0.
RUN rm -f /usr/bin/wget /usr/bin/nc \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

# Copy healthcheck binary (65KB static, default HEALTHCHECK probe)
COPY --from=healthcheck-build /bin/healthcheck /bin/healthcheck

# Default entrypoint
COPY --chmod=755 Docker.entrypoint.sh /usr/bin/entrypoint.sh
ENTRYPOINT ["tini", "-g", "--", "/usr/bin/entrypoint.sh"]
CMD ["node", "dist/index.js"]

## Copy node_modules
COPY --from=app-build /home/node/app/node_modules ./node_modules

# Copy app (dist)
COPY --from=app-build /home/node/app/dist ./dist
COPY --from=app-build /home/node/app/package.json ./package.json

# Copy ui
COPY --from=ui-build /home/node/ui/dist/ ./ui