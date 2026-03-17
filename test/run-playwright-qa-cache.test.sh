#!/usr/bin/env bash
# shellcheck disable=SC2016
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
TARGET_SCRIPT="$REPO_ROOT/scripts/run-playwright-qa.sh"

make_mock_binary() {
	local path="$1"
	local name="$2"
	local body="$3"
	cat >"$path/$name" <<SCRIPT
#!/usr/bin/env bash
set -euo pipefail
$body
SCRIPT
	chmod +x "$path/$name"
}

run_case() {
	local case_name="$1"
	local image_exists="$2"
	local image_created="$3"
	local commit_epoch="$4"
	local expect_build="$5"

	local tmp_dir
	tmp_dir=$(mktemp -d)
	trap 'rm -rf "$tmp_dir"' RETURN

	local mock_bin="$tmp_dir/bin"
	mkdir -p "$mock_bin"

	export MOCK_LOG="$tmp_dir/mock.log"
	export MOCK_IMAGE_EXISTS="$image_exists"
	export MOCK_IMAGE_CREATED="$image_created"
	export MOCK_COMMIT_EPOCH="$commit_epoch"

	make_mock_binary "$mock_bin" docker '
	echo "docker $*" >> "$MOCK_LOG"
	if [[ "${1:-}" == "image" && "${2:-}" == "inspect" ]]; then
		if [[ "$MOCK_IMAGE_EXISTS" != "1" ]]; then
			exit 1
		fi
		if [[ "$*" == *"--format"* ]]; then
			printf "%s\n" "$MOCK_IMAGE_CREATED"
		fi
		exit 0
	fi
	exit 0
	'

	make_mock_binary "$mock_bin" git '
	if [[ "${1:-}" == "-C" && "${3:-}" == "log" && "${4:-}" == "-1" && "${5:-}" == "--format=%ct" ]]; then
		printf "%s\n" "$MOCK_COMMIT_EPOCH"
		exit 0
	fi
	echo "unexpected git args: $*" >&2
	exit 1
	'

	make_mock_binary "$mock_bin" curl 'exit 0'
	make_mock_binary "$mock_bin" npm 'exit 0'
	make_mock_binary "$mock_bin" sleep 'exit 0'

	if ! PATH="$mock_bin:$PATH" DD_PLAYWRIGHT_PORT=0 DD_PLAYWRIGHT_RESTART_COLIMA=false bash "$TARGET_SCRIPT" >/dev/null 2>&1; then
		echo "case '$case_name' failed to execute test target" >&2
		exit 1
	fi

	local did_build=0
	if grep -q '^docker build ' "$MOCK_LOG"; then
		did_build=1
	fi

	if [[ $did_build != "$expect_build" ]]; then
		echo "FAIL: $case_name (expected build=$expect_build, got build=$did_build)" >&2
		echo "mock log:" >&2
		sed 's/^/  /' "$MOCK_LOG" >&2
		exit 1
	fi

	echo "PASS: $case_name"
}

run_case "skip build when image exists and is newer than latest commit" 1 "2026-03-16T12:00:00Z" 1773600000 0
run_case "build when image is missing" 0 "" 1773600000 1
run_case "build when latest commit is newer than image" 1 "2026-03-15T12:00:00Z" 1773700000 1
