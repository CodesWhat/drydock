#!/usr/bin/env bash
# Pre-commit test gate: runs vitest --changed on staged workspaces.
# Called by lefthook pre-commit (glob: *.{ts,vue}, priority: 3, timeout: 5m).
#
# Only runs tests related to changes (vitest --changed HEAD), not the full suite.
# No --coverage flag — global thresholds would fail on partial runs.
# Full coverage enforcement happens in pre-push via build-and-test.
# Fails fast on first workspace failure.

set -euo pipefail

# Determine which workspace(s) have staged ts/vue files
has_app=false
has_ui=false

for f in "$@"; do
	case "${f}" in
	app/*) has_app=true ;;
	ui/*) has_ui=true ;;
	esac
done

if ! "${has_app}" && ! "${has_ui}"; then
	echo "No app/ or ui/ files staged; skipping tests."
	exit 0
fi

if "${has_app}"; then
	echo "⏳ app: running tests on changed files..."
	(cd app && npx vitest run --changed HEAD --reporter=dot)
fi

if "${has_ui}"; then
	echo "⏳ ui: running tests on changed files..."
	(cd ui && npx vitest run --changed HEAD --reporter=dot)
fi
