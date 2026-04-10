#!/usr/bin/env bash
# Build gate for pre-push hook.
# Runs app + ui production builds in parallel (tsc / vite). No tests:
# the coverage step already exercised them. Failure output is the full
# log path so the user can read the real error instead of a tail -40 window.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
ROOT_DIR=$PWD

mkdir -p .build-logs

pids=()
labels=()
log_files=()

run() {
	local label=$1
	local log_file="${ROOT_DIR}/.build-logs/${label}.log"
	shift
	"$@" >"${log_file}" 2>&1 &
	pids+=($!)
	labels+=("${label}")
	log_files+=("${log_file}")
}

run "build-app" bash -c 'cd app && npm run build'
run "build-ui" bash -c 'cd ui  && npm run build'

fail=0
failed_labels=()
for i in "${!pids[@]}"; do
	if ! wait "${pids[$i]}"; then
		fail=1
		failed_labels+=("${labels[$i]}")
		echo "❌ ${labels[$i]}: build failed"
		echo "   full log: ${log_files[$i]}"
	else
		echo "✅ ${labels[$i]}: build succeeded"
	fi
done

if [ $fail -ne 0 ]; then
	echo ""
	echo "Build failures — inspect the full logs above before pushing."
	for label in "${failed_labels[@]}"; do
		echo "   cat .build-logs/${label}.log"
	done
	exit 1
fi

exit 0
