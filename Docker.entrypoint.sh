#!/usr/bin/env bash
set -e

# if the first argument starts with `-`, prepend `node dist/index`
if [ "${1#-}" != "$1" ]; then
  set -- node dist/index "$@"
fi

if [ "$1" = "node" ] && [ "$2" = "dist/index" ] && [ "${WUD_LOG_FORMAT}" != "json" ]; then
  exec "$@" | ./node_modules/.bin/bunyan -L -o short
else
  exec "$@"
fi
