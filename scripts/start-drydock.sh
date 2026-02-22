#!/bin/bash

set -e

export DOCKER_BUILDKIT=1

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

echo "Starting drydock container for local e2e tests..."

# Ensure no stale drydock container exists (cleanup may have missed it)
docker rm -f drydock 2>/dev/null || true

# Pick a random available port (avoids conflicts with QA or other services)
DD_E2E_PORT=${DD_PORT:-0}
if [ "$DD_E2E_PORT" -eq 0 ]; then
	DD_E2E_PORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("",0)); print(s.getsockname()[1]); s.close()')
fi
export DD_PORT="$DD_E2E_PORT"

# Persist port for GitHub Actions (each step runs in a new shell)
if [ -n "$GITHUB_ENV" ]; then
	echo "DD_PORT=$DD_E2E_PORT" >>"$GITHUB_ENV"
fi

# Build drydock docker image
docker build -t drydock --build-arg DD_VERSION=local "$SCRIPT_DIR/.."

# Run drydock docker image
docker run -d \
	--name drydock \
	--publish "${DD_E2E_PORT}:3000" \
	--volume /var/run/docker.sock:/var/run/docker.sock \
	--env DD_TRIGGER_MOCK_EXAMPLE_MOCK=mock \
	--env DD_WATCHER_LOCAL_WATCHBYDEFAULT=false \
	--env DD_REGISTRY_ECR_PRIVATE_ACCESSKEYID="${AWS_ACCESSKEY_ID:-dummy}" \
	--env DD_REGISTRY_ECR_PRIVATE_SECRETACCESSKEY="${AWS_SECRET_ACCESSKEY:-dummy}" \
	--env DD_REGISTRY_ECR_PRIVATE_REGION=eu-west-1 \
	--env DD_REGISTRY_GHCR_PRIVATE_USERNAME="${GITHUB_USERNAME:-dummy}" \
	--env DD_REGISTRY_GHCR_PRIVATE_TOKEN="${GITHUB_TOKEN:-dummy}" \
	--env DD_REGISTRY_GITLAB_PRIVATE_TOKEN="${GITLAB_TOKEN:-dummy}" \
	--env DD_REGISTRY_LSCR_PRIVATE_USERNAME="${GITHUB_USERNAME:-dummy}" \
	--env DD_REGISTRY_LSCR_PRIVATE_TOKEN="${GITHUB_TOKEN:-dummy}" \
	--env DD_REGISTRY_ACR_PRIVATE_CLIENTID="${ACR_CLIENT_ID:-89dcf54b-ef99-4dc1-bebb-8e0eacafdac8}" \
	--env DD_REGISTRY_ACR_PRIVATE_CLIENTSECRET="${ACR_CLIENT_SECRET:-dummy}" \
	--env DD_REGISTRY_TRUEFORGE_PRIVATE_USERNAME="${TRUEFORGE_USERNAME:-dummy}" \
	--env DD_REGISTRY_TRUEFORGE_PRIVATE_TOKEN="${TRUEFORGE_TOKEN:-dummy}" \
	--env DD_REGISTRY_GCR_PRIVATE_CLIENTEMAIL="${GCR_CLIENT_EMAIL:-gcr@drydock-test.iam.gserviceaccount.com}" \
	--env DD_REGISTRY_GCR_PRIVATE_PRIVATEKEY="${GCR_PRIVATE_KEY:------BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDZ\n-----END PRIVATE KEY-----}" \
	--env DD_AUTH_BASIC_JOHN_USER="john" \
	--env DD_AUTH_BASIC_JOHN_HASH='{SHA}1rToTufzHYhhemtgQhRRJy6/Gjo=' \
	drydock

echo "drydock started on http://localhost:${DD_E2E_PORT}"

# Wait for health endpoint to be reachable (max 60s)
echo "Waiting for drydock to be ready..."
for i in $(seq 1 30); do
	if curl -s --connect-timeout 2 "http://localhost:${DD_E2E_PORT}/health" >/dev/null 2>&1; then
		echo "✅ drydock is healthy"
		break
	fi
	if [ "$i" -eq 30 ]; then
		echo "❌ drydock failed to become healthy after 60s"
		docker logs drydock --tail 30
		exit 1
	fi
	sleep 2
done

echo "Waiting 15 seconds for drydock to fetch updates..."
sleep 15
echo "Ready for e2e tests!"
