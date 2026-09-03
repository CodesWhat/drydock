#!/usr/bin/env bash
# Pre-commit test gate: runs vitest --changed on staged workspaces.
# Called by lefthook pre-commit (glob: *.{ts,vue}, priority: 3, timeout: 5m).
#
# Only runs tests related to changes (vitest --changed HEAD), not the full suite.
# No --coverage flag — global thresholds would fail on partial runs.
# Full coverage enforcement happens in the pre-push `coverage` step.
# Fails fast on first workspace failure.

set -euo pipefail

# Merge commits stage every file the merged branch changed, so the related-test
# set balloons to most of the trigger suites and blows the pre-commit timeout.
# Pre-push coverage and CI already run full coverage on merge commits, so skip.
if git rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1; then
	echo "Merge commit; skipping pre-commit tests (pre-push coverage and CI cover merged commits)."
	exit 0
fi

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
	echo "app: running tests on changed files..."
	(cd app && npx vitest run --changed HEAD --reporter=dot)
fi

if "${has_ui}"; then
	echo "ui: running tests on changed files..."
	(cd ui && npx vitest run --changed HEAD --reporter=dot)
fi
