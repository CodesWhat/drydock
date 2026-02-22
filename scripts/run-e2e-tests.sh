#!/bin/bash

set -e

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

# Always clean up on exit (success or failure)
cleanup() {
  echo "🧹 Cleaning up e2e environment..."
  "$SCRIPT_DIR/cleanup-test-containers.sh"
}
trap cleanup EXIT

echo "🧪 Running complete e2e test suite..."

# Cleanup any existing containers
"$SCRIPT_DIR/cleanup-test-containers.sh"

# Setup test containers
"$SCRIPT_DIR/setup-test-containers.sh"

# Start drydock (sourced so DD_PORT export propagates to cucumber)
# shellcheck disable=SC1091
source "$SCRIPT_DIR/start-drydock.sh"

# Run e2e tests
echo "🏃 Running cucumber tests..."
(cd "$SCRIPT_DIR/../e2e" && npm run cucumber)

echo "✅ E2E tests completed!"
