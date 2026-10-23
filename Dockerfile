# checkov:skip=CKV_DOCKER_3: entrypoint uses su-exec for runtime privilege drop
# Common Stage
# Pin the image index digest, never a per-platform manifest digest: buildx
# resolves a digest the same for every --platform, so arm64 built amd64 (#1021).
FROM node:24-alpine@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf AS base
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

# Install system packages. Scanner and signature tooling (Trivy, Grype, Syft, cosign) is not
# baked into the image; Drydock runs them from pinned worker images (app/configuration/index.ts).
RUN apk add --no-cache \
    bash=5.3.9-r1 \
    git=2.54.0-r0 \
    jq=1.8.2-r0 \
    libexpat=2.9.0-r0 \
    openssl=3.5.9-r0 \
    su-exec=0.3-r0 \
    tini=0.19.0-r3 \
    tzdata=2026e-r0 \
    zlib=1.3.2-r1 \
    && apk upgrade --no-cache libcrypto3 libssl3 \
    && mkdir -m 0700 /store && chown node:node /store

# Build stage for healthcheck binary (~65KB static binary)
# Also an image index digest, never a per-platform manifest digest: a manifest
# pin would compile this C stage for the wrong architecture (#1021).
FROM alpine:3.24@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b AS healthcheck-build
RUN apk add --no-cache gcc=15.2.0-r5 musl-dev=1.2.6-r3
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
# curl was removed from the apk install list above in v1.7.0 (deprecated since
# v1.5.x, warned about through v1.6.0); the image healthcheck has used the
# compiled /bin/healthcheck binary since v1.5.0, so nothing in the image
# depends on curl anymore. User-defined HEALTHCHECK overrides that still shell
# out to curl will break — see DEPRECATIONS.md.
# Also strip root from every /etc/group member list (groups and GIDs stay).
# Docker's supplementary list for a root process is root's /etc/group memberships
# plus group_add; without this, group_add GIDs are indistinguishable from
# wheel/disk/adm, and the entrypoint can't safely carry them across the
# privilege drop.
RUN rm -f /usr/bin/wget /usr/bin/nc \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
    && awk -F: 'BEGIN { OFS = ":" } \
        { n = split($4, m, ","); o = ""; \
          for (i = 1; i <= n; i++) if (m[i] != "" && m[i] != "root") o = o (o == "" ? "" : ",") m[i]; \
          $4 = o; print }' /etc/group > /tmp/group.new \
    && cat /tmp/group.new > /etc/group \
    && rm /tmp/group.new

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