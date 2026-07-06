# checkov:skip=CKV_DOCKER_3: entrypoint uses su-exec for runtime privilege drop
# Common Stage
FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS base
WORKDIR /home/node/app

LABEL maintainer="CodesWhat"
EXPOSE 3000

ENV WORKDIR=/home/node/app
ENV DD_LOG_FORMAT=text
# DD_VERSION intentionally omitted from base stage so the heavy install/
# build layers stay cacheable across release tags. The release stage at
# the bottom of this file reintroduces ARG/ENV DD_VERSION as the final
# layer, where only the metadata changes per build.

HEALTHCHECK --interval=30s --timeout=5s CMD ["sh", "-c", "if [ -n \"$DD_SERVER_ENABLED\" ] && [ \"$DD_SERVER_ENABLED\" != 'true' ]; then exit 0; fi; /bin/healthcheck ${DD_SERVER_PORT:-3000}"]

# Install system packages, trivy, and cosign.
# hadolint ignore=DL3018: curl and trivy are intentionally unpinned. Alpine's
# per-arch mirrors rotate -rN releases at different times; pinning to one
# version breaks multi-arch builds during the sync window (see rc.21). trivy
# additionally ships only from the fast-moving edge/testing repo, which drops
# old -rN builds outright (trivy=0.70.0-r1 vanished and broke rc.30), so it is
# pinned to the package name only.
# hadolint ignore=DL3018
RUN apk add --no-cache \
    bash=5.3.9-r1 \
    curl \
    git=2.54.0-r0 \
    jq=1.8.1-r0 \
    openssl=3.5.7-r0 \
    su-exec=0.3-r0 \
    tini=0.19.0-r3 \
    tzdata=2026b-r0 \
    && apk add --no-cache cosign=3.0.6-r1 \
    && apk add --no-cache --repository=https://dl-cdn.alpinelinux.org/alpine/edge/testing trivy \
    && apk upgrade --no-cache zlib libcrypto3 libssl3 libexpat \
    && mkdir /store && chown node:node /store

# Build stage for healthcheck binary (~65KB static binary)
FROM alpine:3.24@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b AS healthcheck-build
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

# DD_VERSION is the only per-build-tag layer — keep it last so every
# layer above remains cache-hittable across rc.N → rc.N+1 builds.
ARG DD_VERSION=unknown
ENV DD_VERSION=$DD_VERSION