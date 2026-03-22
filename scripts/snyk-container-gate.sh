#!/usr/bin/env bash
set -euo pipefail

if [ $# -lt 1 ]; then
	echo "Usage: $0 <image> [additional snyk args...]"
	exit 1
fi

export CI=1
export TERM=dumb
export NO_COLOR=1

image="$1"
shift

snyk container test "$image" --severity-threshold=high "$@" 2>&1 |
	perl -pe 's/\e\[[0-9;?]*[ -\/]*[@-~]//g'
