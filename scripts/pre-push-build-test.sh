#!/usr/bin/env bash
# Parallel build + test for pre-push hook.
# Runs app/ui builds and tests concurrently (~45s vs ~65s sequential).
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
run "test-app" bash -c 'cd app && npm test'
run "test-ui" bash -c 'cd ui  && npm run test:unit'

fail=0
for i in "${!pids[@]}"; do
	if ! wait "${pids[$i]}"; then
		echo "FAILED: ${labels[$i]}" >&2
		fail=1
	fi
done

exit $fail
