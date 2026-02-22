#!/usr/bin/env bash
# Run snyk code test as informational scan.
# Prints findings for developer awareness but does not block push.
# Rationale: Snyk SAST cannot distinguish HIGH from CRITICAL in SARIF,
# and current HIGH findings are false positives (Docker API data flow
# misclassified as user-supplied regex input). Snyk Code still runs
# in CI for proper gating.
set -uo pipefail

export CI=1
export TERM=dumb
export NO_COLOR=1

echo "Running Snyk Code SAST scan (informational)..."
snyk code test --severity-threshold=high "$@" 2>&1 |
	perl -pe 's/\e\[[0-9;?]*[ -\/]*[@-~]//g' ||
	true
echo "Snyk Code: scan complete (informational — see CI for gate)"
