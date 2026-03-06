#!/bin/bash

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
LOCK_DIR="${TMPDIR:-/tmp}/drydock-e2e.lock"
LOCK_TIMEOUT_SECONDS="${LOCK_TIMEOUT_SECONDS:-300}"

acquire_lock() {
	local started_at current_time lock_pid
	started_at=$(date +%s)

	while ! mkdir "$LOCK_DIR" 2>/dev/null; do
		# Recover stale locks from dead processes.
		if [ -f "$LOCK_DIR/pid" ]; then
			lock_pid=$(cat "$LOCK_DIR/pid" 2>/dev/null || true)
			if [ -n "${lock_pid:-}" ] && ! kill -0 "$lock_pid" 2>/dev/null; then
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

acquire_lock

# Cleanup any existing containers
"$SCRIPT_DIR/cleanup-test-containers.sh"

# Setup test containers
"$SCRIPT_DIR/setup-test-containers.sh"

# Start drydock (uses random port to avoid conflicts)
"$SCRIPT_DIR/start-drydock.sh"

# Query the assigned port from the running container
E2E_PORT=$(docker port drydock 3000/tcp | head -1 | cut -d: -f2)
echo "🔌 Drydock available on port $E2E_PORT"

# Run e2e tests with the dynamically assigned port
echo "🏃 Running cucumber tests..."
(cd "$SCRIPT_DIR/../e2e" && DD_PORT="$E2E_PORT" npm run cucumber)

echo "✅ E2E tests completed!"
