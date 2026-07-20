#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
gitleaks_config="${repo_root}/.gitleaks.toml"
gitleaks_ignore="${repo_root}/.gitleaksignore"

if ! command -v gitleaks >/dev/null 2>&1; then
	echo "gitleaks is required; install the version pinned in .github/workflows/ci-verify.yml" >&2
	exit 1
fi

scan_args=(
	--config="${gitleaks_config}"
	--gitleaks-ignore-path="${gitleaks_ignore}"
	--redact
	--no-banner
)

echo "Scanning complete Git history for secrets"
gitleaks git "${scan_args[@]}" --log-opts="--all" "${repo_root}"

tracked_tree="$(mktemp -d)"
trap 'rm -rf "${tracked_tree}"' EXIT

# Scan only first-party tracked content. This includes staged/working-tree edits
# while excluding generated builds, dependencies, and unrelated local worktrees.
git -C "${repo_root}" ls-files -z |
	tar -C "${repo_root}" --null -T - -cf - |
	tar -xf - -C "${tracked_tree}"

echo "Scanning tracked working tree for secrets"
(
	cd "${tracked_tree}"
	gitleaks dir "${scan_args[@]}" .
)
