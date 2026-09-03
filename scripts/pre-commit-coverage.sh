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

# Hub modules fan out the same way a merge does. `app/util/backup.ts` or
# `app/triggers/providers/docker/Docker.ts` is imported by every Docker-family
# trigger, so `vitest --changed` resolves 20+ suites for a one-file edit and
# Docker.test.ts alone takes over a minute. Past this cap the related run can't
# finish inside the hook timeout, so skip it and let pre-push coverage own it.
# Override per commit with PRE_COMMIT_MAX_RELATED_TESTS=<n>.
max_related="${PRE_COMMIT_MAX_RELATED_TESTS:-10}"

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

run_related_tests() {
	local workspace="$1"
	local related_files
	local list_exit=0
	related_files=$(cd "${workspace}" && npx vitest list --changed HEAD --filesOnly) || list_exit=$?

	if [ "${list_exit}" -ne 0 ]; then
		echo "${workspace}: failed to discover related test files." >&2
		return 1
	fi

	local related
	related=$(printf '%s\n' "${related_files}" | { grep -c . || true; })

	if [ "${related}" -eq 0 ]; then
		echo "${workspace}: no test files relate to the staged changes; skipping."
		return 0
	fi

	if [ "${related}" -gt "${max_related}" ]; then
		echo "${workspace}: ${related} related test files exceed the pre-commit cap of ${max_related}; skipping (pre-push coverage runs the full suite)."
		return 0
	fi

	echo "${workspace}: running ${related} related test file(s)..."
	(cd "${workspace}" && npx vitest run --changed HEAD --reporter=dot)
}

if "${has_app}"; then
	run_related_tests app
fi

if "${has_ui}"; then
	run_related_tests ui
fi
