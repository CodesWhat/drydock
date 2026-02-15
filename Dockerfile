# checkov:skip=CKV_DOCKER_3: entrypoint uses su-exec for runtime privilege drop
# Common Stage
FROM node:24-alpine@sha256:cd6fb7efa6490f039f3471a189214d5f548c11df1ff9e5b181aa49e22c14383e AS base
WORKDIR /home/node/app

LABEL maintainer="CodesWhat"
EXPOSE 3000

ARG DD_VERSION=unknown

ENV WORKDIR=/home/node/app
ENV DD_LOG_FORMAT=text
ENV DD_VERSION=$DD_VERSION

HEALTHCHECK --interval=30s --timeout=5s CMD ["sh", "-c", "if [ -z \"$DD_SERVER_ENABLED\" ] || [ \"$DD_SERVER_ENABLED\" = 'true' ]; then curl --fail http://localhost:${DD_SERVER_PORT:-3000}/health || exit 1; else exit 0; fi"]

# Install system packages, trivy, and cosign
# hadolint ignore=DL3018,DL3028,DL4006
RUN apk add --no-cache \
    bash \
    curl \
    git \
    jq \
    openssl \
    su-exec \
    tini \
    tzdata \
    && apk add --no-cache --repository=https://dl-cdn.alpinelinux.org/alpine/edge/testing cosign \
    && curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sh -s -- -b /usr/local/bin \
    && mkdir /store && chown node:node /store

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