#!/usr/bin/env bash
# Run snyk code test.
# Default mode is informational to avoid noisy false positives during local use.
# Set SNYK_CODE_ENFORCE=true to fail on findings in CI.
set -uo pipefail

export CI=1
export TERM=dumb
export NO_COLOR=1
SNYK_CODE_ENFORCE="${SNYK_CODE_ENFORCE:-false}"

echo "Running Snyk Code SAST scan..."
set +e
snyk code test --severity-threshold=high "$@" 2>&1 | perl -pe 's/\e\[[0-9;?]*[ -\/]*[@-~]//g'
status=$?
set -e

if [ "$status" -eq 0 ]; then
	echo "Snyk Code: no high-severity findings."
elif [ "$status" -eq 1 ]; then
	if [ "$SNYK_CODE_ENFORCE" = "true" ]; then
		echo "Snyk Code: enforcement enabled, failing on findings."
		exit 1
	fi
	echo "Snyk Code: informational mode, findings reported but not enforced."
else
	echo "Snyk Code: scan failed unexpectedly (exit code $status)."
	exit "$status"
fi

echo "Snyk Code: scan complete"
