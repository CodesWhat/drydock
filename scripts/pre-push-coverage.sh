#!/usr/bin/env bash
# Coverage gate for pre-push hook.
# Runs vitest --coverage with JSON reporter, then parses the output
# to produce a machine-readable gap report at .coverage-gaps.json.
#
# On failure: prints exact files + uncovered lines so an agent can fix them.
# The gap report is gitignored and read by agents to know what to test.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
ROOT_DIR=$PWD

export GAPS_FILE=".coverage-gaps.json"
fail=0
FAIL_FAST="${DD_COVERAGE_FAIL_FAST:-0}"
mkdir -p .coverage-logs

usage() {
	echo "Usage: $0 [app|ui|all] [--continue|--fail-fast]" >&2
}

determine_workspace_order() {
	local changed_paths
	changed_paths=$(
		{
			git diff --name-only -- app ui 2>/dev/null || true
			git diff --name-only --cached -- app ui 2>/dev/null || true
			git diff-tree --no-commit-id --name-only -r HEAD -- app ui 2>/dev/null || true
		} | awk 'NF && !seen[$0]++'
	)

	local app_count=0
	local ui_count=0

	if [ -n "${changed_paths}" ]; then
		app_count=$(printf '%s\n' "${changed_paths}" | grep -c '^app/' || true)
		ui_count=$(printf '%s\n' "${changed_paths}" | grep -c '^ui/' || true)
	fi

	if [ "${ui_count}" -gt "${app_count}" ]; then
		echo "ui app"
	elif [ "${app_count}" -gt "${ui_count}" ]; then
		echo "app ui"
	else
		echo "app ui"
	fi
}

combine_gap_reports() {
	node -e '
const fs = require("fs");
const files = process.argv.slice(1);
const merged = [];
for (const file of files) {
  if (!fs.existsSync(file)) continue;
  merged.push(...JSON.parse(fs.readFileSync(file, "utf8")));
}
fs.writeFileSync(process.env.GAPS_FILE, JSON.stringify(merged, null, 2) + "\n");
' "$@"
}

run_coverage() {
	local workspace=$1
	local log_file="${ROOT_DIR}/.coverage-logs/${workspace}.log"
	local gap_file="${ROOT_DIR}/.coverage-gaps.${workspace}.json"

	if (cd "${workspace}" && npx vitest run --coverage --reporter=dot >"${log_file}" 2>&1); then
		rm -f "${gap_file}"
		echo "✅ ${workspace}: coverage met"
		return 0
	fi

	echo "❌ ${workspace}: coverage below threshold"
	echo "   vitest log: ${log_file}"
	node scripts/coverage-gaps.mjs --workspace "${workspace}" --write "${gap_file}" --print
	fail=1
	return 1
}

run_coverage_async() {
	local workspace=$1

	(
		run_coverage "${workspace}"
	) &
	RUN_PID=$!
}

requested_workspaces=()
while [ $# -gt 0 ]; do
	case "$1" in
	app|ui)
		requested_workspaces+=("$1")
		;;
	all)
		requested_workspaces=("app" "ui")
		;;
	--continue)
		FAIL_FAST=0
		;;
	--fail-fast)
		FAIL_FAST=1
		;;
	-h|--help)
		usage
		exit 0
		;;
	*)
		usage
		exit 2
		;;
	esac
	shift
done

if [ ${#requested_workspaces[@]} -eq 0 ]; then
	read -r -a requested_workspaces <<<"$(determine_workspace_order)"
fi

gap_files=()
failed_workspaces=()
running_workspaces=()
pids=()

for workspace in "${requested_workspaces[@]}"; do
	gap_files+=(".coverage-gaps.${workspace}.json")
	echo "📊 ${workspace}: running coverage..."
done

if [ "${FAIL_FAST}" -eq 1 ] || [ ${#requested_workspaces[@]} -eq 1 ]; then
	for workspace in "${requested_workspaces[@]}"; do
		if ! run_coverage "${workspace}"; then
			failed_workspaces+=("${workspace}")
			break
		fi
	done
else
	for workspace in "${requested_workspaces[@]}"; do
		run_coverage_async "${workspace}"
		pids+=("${RUN_PID}")
		running_workspaces+=("${workspace}")
	done

	for index in "${!pids[@]}"; do
		if ! wait "${pids[$index]}"; then
			fail=1
			failed_workspaces+=("${running_workspaces[$index]}")
		fi
	done
fi

combine_gap_reports "${gap_files[@]}"

if [ $fail -ne 0 ]; then
	echo ""
	echo "Coverage thresholds not met. Fix gaps before pushing."
	echo "Combined gaps: cat .coverage-gaps.json"
	for workspace in "${failed_workspaces[@]}"; do
		echo "Shard gaps: cat .coverage-gaps.${workspace}.json"
		echo "Rerun shard: ./scripts/pre-push-coverage.sh ${workspace}"
	done
	exit 1
fi

# Clean state — remove gap files when everything passes
rm -f "${GAPS_FILE}" .coverage-gaps.app.json .coverage-gaps.ui.json
echo "✅ Coverage thresholds met (100%)."
