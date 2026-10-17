#!/usr/bin/env bash
# Exercise the Drydock sender against a locally built Portwing receiver.
set -euo pipefail
if [ "$#" -ne 1 ]; then
	echo "Usage: bash scripts/edge-body-interop.sh /path/to/portwing" >&2
	exit 2
fi
portwing_repo=$(cd "$1" && pwd)
drydock_repo=$(cd "$(dirname "$0")/.." && pwd)
interop_dir=$(mktemp -d "${TMPDIR:-/tmp}/pw-interop.XXXXXX")
trap 'rm -f "$interop_dir/portwing"; rmdir "$interop_dir"' EXIT
(cd "$portwing_repo" && go build -o "$interop_dir/portwing" ./cmd/portwing)
cd "$drydock_repo/app"
PORTWING_BINARY="$interop_dir/portwing" ./node_modules/.bin/vitest run agent/EdgeAgentAdapter.test.ts -t 'real Go Portwing'
