#!/usr/bin/env bash
set -euo pipefail

mode="${1:-changed}"

case "$mode" in
changed | all) ;;
*)
	echo "Usage: $0 [changed|all]"
	exit 1
	;;
esac

cmd=(qlty check --no-progress --fail-level medium)

if [ "$mode" = "all" ]; then
	cmd+=(--all)
elif git rev-parse --verify --quiet refs/remotes/origin/main >/dev/null; then
	cmd+=(--upstream origin/main)
fi

echo "Running Qlty gate: ${cmd[*]}"
"${cmd[@]}"
