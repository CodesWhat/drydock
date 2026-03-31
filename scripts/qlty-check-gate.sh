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

# Coverage output is ignored source, but some qlty plugins still walk it before
# exclude filters apply. Drop the transient directories to keep the gate stable.
rm -rf app/coverage ui/coverage

cmd=(qlty check --no-progress)

if [ "$mode" = "all" ]; then
	cmd+=(--all)
elif git rev-parse --verify --quiet refs/remotes/origin/main >/dev/null; then
	cmd+=(--upstream origin/main)
fi

echo "Running Qlty gate: ${cmd[*]}"
"${cmd[@]}" </dev/null
