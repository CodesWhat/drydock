#!/bin/bash

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
LOCK_DIR="${TMPDIR:-/tmp}/drydock-e2e.lock"
LOCK_TIMEOUT_SECONDS="${LOCK_TIMEOUT_SECONDS:-300}"
# Only restart Colima if docker is actually broken. Forcing a restart on every
# run makes the pre-push hook scale with the number of containers on the VM
# and blows past the lefthook timeout once the host accumulates QA fixtures.
RESTART_COLIMA="${DD_E2E_RESTART_COLIMA:-auto}"

restart_colima() {
	if [[ $RESTART_COLIMA == "false" ]]; then
		return
	fi

	if ! command -v colima >/dev/null 2>&1; then
		return
	fi

	if [[ $RESTART_COLIMA == "auto" ]] && docker info >/dev/null 2>&1; then
		return
	fi

	echo "🔄 Restarting Colima..."
	colima stop >/dev/null 2>&1 || true
	colima start >/dev/null
}

wait_for_docker_engine() {
	if docker info >/dev/null 2>&1; then
		return
	fi

	echo "⏳ Waiting for Docker engine..."
	for _ in $(seq 1 60); do
		if docker info >/dev/null 2>&1; then
			return
		fi
		sleep 1
	done

	echo "❌ Docker engine did not become ready."
	exit 1
}

acquire_lock() {
	local started_at current_time lock_pid
	started_at=$(date +%s)

	while ! mkdir "$LOCK_DIR" 2>/dev/null; do
		# Recover stale locks from dead processes.
		if [ -f "$LOCK_DIR/pid" ]; then
			lock_pid=$(cat "$LOCK_DIR/pid" 2>/dev/null || true)
			if [ -n "${lock_pid:-}" ] && [[ $lock_pid =~ ^[0-9]+$ ]] && ! ps -p "$lock_pid" >/dev/null 2>&1; then
				rm -rf "$LOCK_DIR"
				continue
			fi
		fi

		current_time=$(date +%s)
		if [ $((current_time - started_at)) -ge "$LOCK_TIMEOUT_SECONDS" ]; then
			echo "❌ Timed out waiting for e2e lock after ${LOCK_TIMEOUT_SECONDS}s"
			exit 1
		fi

		echo "⏳ Waiting for active e2e run to finish..."
		sleep 1
	done

	echo "$$" >"$LOCK_DIR/pid"
	echo "🔒 Acquired e2e lock"
}

release_lock() {
	rm -rf "$LOCK_DIR" 2>/dev/null || true
}

# Always clean up on exit (success or failure)
cleanup() {
	echo "🧹 Cleaning up e2e environment..."
	"$SCRIPT_DIR/cleanup-test-containers.sh"
}
trap 'cleanup; release_lock' EXIT

echo "🧪 Running complete e2e test suite..."

restart_colima
wait_for_docker_engine

acquire_lock

# Cleanup any existing containers
"$SCRIPT_DIR/cleanup-test-containers.sh"

# Setup test containers
"$SCRIPT_DIR/setup-test-containers.sh"

# Start drydock (uses random port to avoid conflicts)
"$SCRIPT_DIR/start-drydock.sh"

# Query the assigned port from the running container (works for IPv4 and IPv6 outputs)
E2E_PORT=$(docker port drydock 3000/tcp | head -n1 | awk -F: '{print $NF}')
echo "🔌 Drydock available on port $E2E_PORT"

# Run e2e tests with the dynamically assigned port
echo "🏃 Running cucumber tests..."
(cd "$SCRIPT_DIR/../e2e" && DD_PORT="$E2E_PORT" npm run cucumber)

echo "✅ E2E tests completed!"
