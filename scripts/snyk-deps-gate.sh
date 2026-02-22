#!/usr/bin/env bash
set -euo pipefail

export CI=1
export TERM=dumb
export NO_COLOR=1

snyk test --severity-threshold=high "$@" 2>&1 |
	perl -pe 's/\e\[[0-9;?]*[ -\/]*[@-~]//g'
