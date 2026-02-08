# Common Stage
FROM node:24-alpine AS base
WORKDIR /home/node/app

# Dependencies stage for backend app
FROM base AS app-dependencies

# Copy app package.json
COPY app/package* ./

# Install app dependencies
RUN npm ci --omit=dev --omit=optional --no-audit --no-fund --no-update-notifier

# Build stage for frontend UI
FROM base AS ui-build

# Copy ui package.json
COPY ui/package* ./

# Install ui dependencies
RUN npm ci --no-audit --no-fund --no-update-notifier

# Copy ui sources and build static assets
COPY ui/ ./
RUN npm run build

# Release stage
FROM base AS release

LABEL maintainer="fmartinou"
EXPOSE 3000

ARG WUD_VERSION=unknown

ENV WORKDIR=/home/node/app
ENV WUD_LOG_FORMAT=text
ENV WUD_VERSION=$WUD_VERSION

HEALTHCHECK --interval=30s --timeout=5s CMD if [[ -z ${WUD_SERVER_ENABLED} || ${WUD_SERVER_ENABLED} == 'true' ]]; then curl --fail http://localhost:${WUD_SERVER_PORT:-3000}/health || exit 1; else exit 0; fi;

RUN mkdir /store

# Add useful stuff
RUN apk add --no-cache tzdata openssl curl git jq bash

# Default entrypoint
COPY Docker.entrypoint.sh /usr/bin/entrypoint.sh
RUN chmod +x /usr/bin/entrypoint.sh
ENTRYPOINT ["/usr/bin/entrypoint.sh"]
CMD ["node", "index"]

## Copy node_modules
COPY --from=app-dependencies /home/node/app/node_modules ./node_modules

# Copy app
COPY app/ ./

# Copy ui
COPY --from=ui-build /home/node/app/dist/ ./ui
