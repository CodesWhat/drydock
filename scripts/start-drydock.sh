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
if [ -n "${GITHUB_ENV:-}" ]; then
	echo "DD_PORT=$DD_E2E_PORT" >>"$GITHUB_ENV"
fi

build_drydock_image() {
	local attempt max_attempts
	max_attempts=2

	for attempt in $(seq 1 "$max_attempts"); do
		if docker build -t drydock --build-arg DD_VERSION=local "$SCRIPT_DIR/.."; then
			return 0
		fi

		if [ "$attempt" -lt "$max_attempts" ]; then
			echo "⚠️ Docker build failed, pruning builder cache and retrying once..."
			docker builder prune -af >/dev/null 2>&1 || true
			sleep 1
		fi
	done

	return 1
}

# Build drydock docker image
build_drydock_image

# Build docker run args. Registries without real credentials are registered
# with an empty-string config (anonymous mode) to avoid failed-auth-then-retry
# delays that make the E2E startup time unpredictable.
DOCKER_ARGS=(
	run -d
	--name drydock
	--publish "${DD_E2E_PORT}:3000"
	--volume /var/run/docker.sock:/var/run/docker.sock
	--env DD_TRIGGER_MOCK_EXAMPLE_MOCK=mock
	--env DD_WATCHER_LOCAL_WATCHBYDEFAULT=false
)

# ECR — dummy credentials are fine (no retry logic, fast 401)
DOCKER_ARGS+=(--env DD_REGISTRY_ECR_PRIVATE_ACCESSKEYID="${AWS_ACCESSKEY_ID:-dummy}")
DOCKER_ARGS+=(--env DD_REGISTRY_ECR_PRIVATE_SECRETACCESSKEY="${AWS_SECRET_ACCESSKEY:-dummy}")
DOCKER_ARGS+=(--env DD_REGISTRY_ECR_PRIVATE_REGION=eu-west-1)

# GHCR — use real credentials or register anonymously
if [ -n "${GITHUB_USERNAME:-}" ]; then
	DOCKER_ARGS+=(--env DD_REGISTRY_GHCR_PRIVATE_USERNAME="$GITHUB_USERNAME")
	DOCKER_ARGS+=(--env DD_REGISTRY_GHCR_PRIVATE_TOKEN="$GITHUB_TOKEN")
else
	DOCKER_ARGS+=(--env "DD_REGISTRY_GHCR_PRIVATE=")
fi

# GitLab — token always required by schema; dummy token causes one fast 401
DOCKER_ARGS+=(--env DD_REGISTRY_GITLAB_PRIVATE_TOKEN="${GITLAB_TOKEN:-dummy}")

# LSCR — use real credentials or register anonymously
if [ -n "${GITHUB_USERNAME:-}" ]; then
	DOCKER_ARGS+=(--env DD_REGISTRY_LSCR_PRIVATE_USERNAME="$GITHUB_USERNAME")
	DOCKER_ARGS+=(--env DD_REGISTRY_LSCR_PRIVATE_TOKEN="$GITHUB_TOKEN")
else
	DOCKER_ARGS+=(--env "DD_REGISTRY_LSCR_PRIVATE=")
fi

# ACR — dummy credentials are fine (no matching test container)
DOCKER_ARGS+=(--env DD_REGISTRY_ACR_PRIVATE_CLIENTID="${ACR_CLIENT_ID:-89dcf54b-ef99-4dc1-bebb-8e0eacafdac8}")
DOCKER_ARGS+=(--env DD_REGISTRY_ACR_PRIVATE_CLIENTSECRET="${ACR_CLIENT_SECRET:-dummy}")

# TrueForge — use real credentials or register anonymously
if [ -n "${TRUEFORGE_USERNAME:-}" ]; then
	DOCKER_ARGS+=(--env DD_REGISTRY_TRUEFORGE_PRIVATE_USERNAME="$TRUEFORGE_USERNAME")
	DOCKER_ARGS+=(--env DD_REGISTRY_TRUEFORGE_PRIVATE_TOKEN="$TRUEFORGE_TOKEN")
else
	DOCKER_ARGS+=(--env "DD_REGISTRY_TRUEFORGE_PRIVATE=")
fi

# GCR — dummy credentials are fine (no matching test container)
DOCKER_ARGS+=(--env DD_REGISTRY_GCR_PRIVATE_CLIENTEMAIL="${GCR_CLIENT_EMAIL:-gcr@drydock-test.iam.gserviceaccount.com}")
DOCKER_ARGS+=(--env "DD_REGISTRY_GCR_PRIVATE_PRIVATEKEY=${GCR_PRIVATE_KEY:------BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDZ\n-----END PRIVATE KEY-----}")

# shellcheck disable=SC2016,SC2054
DOCKER_ARGS+=(
	--env DD_AUTH_BASIC_JOHN_USER="john"
	--env DD_AUTH_BASIC_JOHN_HASH='argon2id$65536$3$4$ZHJ5ZG9jay1iYXNpYy1hdXRoLXNhbHQ=$GumQTfvOsp+hTyVxLIQvvP2izj/+lCCVYTPnwm9+ZC0+x0OQomJgNgIYFI7e5iUZtblM2rlIIYIwxaAeegWMKQ=='
	drydock
)

docker "${DOCKER_ARGS[@]}"

# Query the randomly assigned host port
E2E_PORT=$(docker port drydock 3000/tcp | head -1 | cut -d: -f2)
if [ -z "${E2E_PORT:-}" ]; then
	E2E_PORT="$DD_E2E_PORT"
fi

# Expose port for GitHub Actions (persists to subsequent steps)
if [ -n "$GITHUB_OUTPUT" ]; then
	echo "dd_port=$E2E_PORT" >>"$GITHUB_OUTPUT"
fi

echo "drydock started on http://localhost:${E2E_PORT}"

# Wait for health endpoint to be reachable (max 60s)
echo "Waiting for drydock to be ready..."
for i in $(seq 1 30); do
	if curl -s --connect-timeout 2 "http://localhost:${E2E_PORT}/health" >/dev/null 2>&1; then
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

# Wait until drydock has discovered enough containers with fully resolved
# image data (max 90s).  Container count alone is not sufficient — image
# name, registry URL, and tag fields are populated asynchronously after
# discovery and the E2E assertions depend on them.
AUTH_HEADER="Basic $(echo -n 'john:doe' | base64)"
EXPECTED_CONTAINERS=${DD_EXPECTED_CONTAINERS:-10}
echo "Waiting for drydock to discover ${EXPECTED_CONTAINERS}+ containers with image data (max 90s)..."
for i in $(seq 1 45); do
	# Count containers that have a populated image.name (not just discovered)
	CONTAINERS_JSON=""
	if CONTAINERS_JSON=$(curl -sf -H "Authorization: ${AUTH_HEADER}" "http://localhost:${E2E_PORT}/api/containers" 2>/dev/null); then
		:
	fi
	READY=0
	if [ -n "${CONTAINERS_JSON}" ]; then
		READY=$(jq '[.data[] | select((.image.name // "" | length > 0) and (.image.registry.name // "" | length > 0) and (.image.tag.value // "" | length > 0))] | length' <<<"${CONTAINERS_JSON}" 2>/dev/null || echo 0)
	fi
	READY=${READY:-0}
	if [ "$READY" -ge "$EXPECTED_CONTAINERS" ]; then
		echo "✅ drydock has ${READY} containers with resolved image data"
		break
	fi
	if [ "$i" -eq 45 ]; then
		echo "❌ drydock only has ${READY}/${EXPECTED_CONTAINERS} ready containers after 90s"
		docker logs drydock --tail 50
		exit 1
	fi
	sleep 2
done
echo "Ready for e2e tests!"
