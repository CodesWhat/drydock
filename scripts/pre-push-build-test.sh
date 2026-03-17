#!/usr/bin/env bash
# Parallel build + test for pre-push hook.
# Runs app/ui builds and tests concurrently (~45s vs ~65s sequential).
# Tests currently execute against source (Vitest), not compiled build output.
# If tests begin importing compiled artifacts (for example dist/build paths),
# revisit this script and run builds before tests to avoid race-based false negatives.
# Exits non-zero if any subprocess fails; dumps captured output for failures.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT

pids=()
labels=()

run() {
	local label=$1
	shift
	"$@" >"$tmpdir/$label.log" 2>&1 &
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
		echo "" >&2
		echo "──── FAILED: ${labels[$i]} ────" >&2
		tail -40 "$tmpdir/${labels[$i]}.log" >&2
		echo "──── END: ${labels[$i]} ────" >&2
		fail=1
	fi
done

exit $fail
