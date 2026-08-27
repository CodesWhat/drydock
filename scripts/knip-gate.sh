#!/usr/bin/env bash
# Knip gate for pre-push hook.
# Runs knip (dead-code / unused dependency detection) across app + ui.
# Fast (~1-2s each), so this runs sequentially right after biome rather
# than sharded in parallel like coverage/build.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

fail=0

echo "→ knip (app)"
if ! (cd app && npm run knip); then
	echo "knip (app) failed"
	fail=1
fi

echo "→ knip (ui)"
if ! (cd ui && npm run knip); then
	echo "knip (ui) failed"
	fail=1
fi

if [ $fail -ne 0 ]; then
	echo ""
	echo "Knip found unused files/exports/dependencies — fix or extend knip.json's ignore lists."
	exit 1
fi

exit 0
