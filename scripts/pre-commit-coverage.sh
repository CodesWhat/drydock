#!/usr/bin/env bash
# Pre-commit coverage gate: runs tests related to staged files and checks
# that each staged source file maintains coverage thresholds.
#
# Only activates when instrumented source files are staged:
# - app/*.ts
# - ui/src/*.ts
# Uses vitest --changed first and scopes coverage to staged files.
# If dependency-based selection misses relevant tests, it retries with a
# full vitest run to avoid false negatives on per-file thresholds.
#
# Thresholds: 100% lines/functions/statements, 95% branches.
# Branch threshold is slightly relaxed because v8 coverage reports
# phantom uncovered branches on ternaries and exhaustive if-chains.
# The pre-push hook enforces full 100% globally via `npm test`.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

# Collect staged source files (excludes deletions and test files)
staged_app=()
staged_ui=()

while IFS= read -r file; do
	case "$file" in
	app/*.test.ts) ;; # skip test files — we measure source coverage
	app/*.ts) staged_app+=("$file") ;;
	ui/src/*.spec.ts) ;; # skip test files
	ui/src/*.ts) staged_ui+=("$file") ;;
	esac
done < <(git diff --cached --name-only --diff-filter=d)

# Skip if no relevant source files staged
if [[ ${#staged_app[@]} -eq 0 && ${#staged_ui[@]} -eq 0 ]]; then
	echo "⏭  No app/ui source files staged — skipping coverage check"
	exit 0
fi

pids=()
labels=()
fail=0

run() {
	local label=$1
	shift
	"$@" &
	pids+=($!)
	labels+=("$label")
}

# Common coverage flags: scope to staged files, per-file thresholds
COVERAGE_FLAGS="--coverage --coverage.thresholds.perFile --coverage.thresholds.branches=95"

if [[ ${#staged_app[@]} -gt 0 ]]; then
	# Build --coverage.include patterns for each staged file (paths relative to app/)
	include_args=()
	for f in "${staged_app[@]}"; do
		include_args+=(--coverage.include "${f#app/}")
	done
	echo "🧪 Running coverage for ${#staged_app[@]} staged app file(s)..."
	# shellcheck disable=SC2086
	run "app-coverage" bash -c "cd app && npx vitest run --changed $COVERAGE_FLAGS ${include_args[*]} || { echo '↩️  app --changed coverage failed; retrying full run'; npx vitest run $COVERAGE_FLAGS ${include_args[*]}; }"
fi

if [[ ${#staged_ui[@]} -gt 0 ]]; then
	# Build --coverage.include patterns for each staged file (paths relative to ui/)
	include_args=()
	for f in "${staged_ui[@]}"; do
		include_args+=(--coverage.include "${f#ui/}")
	done
	echo "🧪 Running coverage for ${#staged_ui[@]} staged ui file(s)..."
	# shellcheck disable=SC2086
	run "ui-coverage" bash -c "cd ui && npx vitest run --changed $COVERAGE_FLAGS ${include_args[*]} || { echo '↩️  ui --changed coverage failed; retrying full run'; npx vitest run $COVERAGE_FLAGS ${include_args[*]}; }"
fi

for i in "${!pids[@]}"; do
	if ! wait "${pids[$i]}"; then
		echo "❌ FAILED: ${labels[$i]} — coverage threshold not met" >&2
		fail=1
	fi
done

if [[ $fail -eq 0 ]]; then
	echo "✅ Coverage check passed"
fi

exit $fail
