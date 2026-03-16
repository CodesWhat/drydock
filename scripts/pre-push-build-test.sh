#!/usr/bin/env bash
# Parallel build + test for pre-push hook.
# Runs app/ui builds and tests concurrently (~45s vs ~65s sequential).
# Tests run WITHOUT --coverage here; coverage is a separate gate.
# Exits non-zero if any subprocess fails.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

pids=()
labels=()

run() {
	local label=$1
	shift
	"$@" &
	pids+=($!)
	labels+=("$label")
}

run "build-app" bash -c 'cd app && npm run build'
run "build-ui" bash -c 'cd ui  && npm run build'
run "test-app" bash -c 'cd app && npx vitest run --reporter=dot'
run "test-ui" bash -c 'cd ui  && npx vitest run --reporter=dot'

fail=0
for i in "${!pids[@]}"; do
	if ! wait "${pids[$i]}"; then
		echo "FAILED: ${labels[$i]}" >&2
		fail=1
	fi
done

exit $fail
