#!/bin/bash

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT="${SCRIPT_DIR}/.."
COMPOSE_FILE="${REPO_ROOT}/test/ci-compose.yml"
ARTILLERY_FILE="${ARTILLERY_FILE:-${REPO_ROOT}/test.yml}"
ARTILLERY_ENV="${ARTILLERY_ENV:-ci}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-drydock-loadtest}"
DD_LOAD_TEST_PORT="${DD_LOAD_TEST_PORT:-}"
DD_LOAD_TEST_TARGET="${DD_LOAD_TEST_TARGET:-}"
DD_LOAD_TEST_RANDOM_PORT_MIN="${DD_LOAD_TEST_RANDOM_PORT_MIN:-20000}"
DD_LOAD_TEST_RANDOM_PORT_MAX="${DD_LOAD_TEST_RANDOM_PORT_MAX:-60999}"
ARTILLERY_VERSION="${ARTILLERY_VERSION:-2.0.30}"
DD_LOAD_TEST_BUILD_CACHE="${DD_LOAD_TEST_BUILD_CACHE:-none}"
DD_LOAD_TEST_ARTIFACT_DIR="${DD_LOAD_TEST_ARTIFACT_DIR:-}"
ARTILLERY_OUTPUT_FILE="${ARTILLERY_OUTPUT_FILE:-}"

cleanup() {
	local exit_code=$?

	if [ "${exit_code}" -ne 0 ]; then
		echo "Load test failed; showing service logs before cleanup..."
		docker compose -p "${COMPOSE_PROJECT}" -f "${COMPOSE_FILE}" logs --no-color || true
	fi

	echo "Stopping load test services..."
	docker compose -p "${COMPOSE_PROJECT}" -f "${COMPOSE_FILE}" down -v || true

	trap - EXIT
	exit "${exit_code}"
}

trap cleanup EXIT

cd "${REPO_ROOT}"

is_port_in_use() {
	local port="$1"

	if command -v lsof >/dev/null 2>&1; then
		lsof -nP -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1
		return $?
	fi

	if command -v nc >/dev/null 2>&1; then
		nc -z 127.0.0.1 "${port}" >/dev/null 2>&1
		return $?
	fi

	return 1
}

pick_random_port() {
	local min="$1"
	local max="$2"
	local candidate

	for _ in $(seq 1 100); do
		candidate=$((min + RANDOM % (max - min + 1)))
		if ! is_port_in_use "${candidate}"; then
			echo "${candidate}"
			return 0
		fi
	done

	return 1
}

if [ -z "${DD_LOAD_TEST_PORT}" ]; then
	if ! [[ ${DD_LOAD_TEST_RANDOM_PORT_MIN} =~ ^[0-9]+$ ]] || ! [[ ${DD_LOAD_TEST_RANDOM_PORT_MAX} =~ ^[0-9]+$ ]]; then
		echo "DD_LOAD_TEST_RANDOM_PORT_MIN/MAX must be numeric"
		exit 1
	fi
	if [ "${DD_LOAD_TEST_RANDOM_PORT_MIN}" -ge "${DD_LOAD_TEST_RANDOM_PORT_MAX}" ]; then
		echo "DD_LOAD_TEST_RANDOM_PORT_MIN must be lower than DD_LOAD_TEST_RANDOM_PORT_MAX"
		exit 1
	fi

	DD_LOAD_TEST_PORT="$(pick_random_port "${DD_LOAD_TEST_RANDOM_PORT_MIN}" "${DD_LOAD_TEST_RANDOM_PORT_MAX}" || true)"
	if [ -z "${DD_LOAD_TEST_PORT}" ]; then
		echo "Unable to find a free random load test port."
		exit 1
	fi
	echo "Selected random load test port: ${DD_LOAD_TEST_PORT}"
elif ! [[ ${DD_LOAD_TEST_PORT} =~ ^[0-9]+$ ]]; then
	echo "DD_LOAD_TEST_PORT must be numeric"
	exit 1
fi

if is_port_in_use "${DD_LOAD_TEST_PORT}"; then
	echo "Port ${DD_LOAD_TEST_PORT} is already in use; choose a free port."
	echo "Example: DD_LOAD_TEST_PORT=3800 DD_LOAD_TEST_TARGET=http://127.0.0.1:3800 npm run load:smoke"
	exit 1
fi

if [ -z "${DD_LOAD_TEST_TARGET}" ]; then
	DD_LOAD_TEST_TARGET="http://127.0.0.1:${DD_LOAD_TEST_PORT}"
fi

export DD_LOAD_TEST_PORT
export DD_LOAD_TEST_TARGET

echo "Using load test target: ${DD_LOAD_TEST_TARGET}"

echo "Building drydock test image..."
if [ "${DD_LOAD_TEST_BUILD_CACHE}" = "gha" ]; then
	echo "Using buildx with GHA cache..."
	docker buildx build \
		--load \
		-t drydock:ci \
		--build-arg DD_VERSION=ci \
		--cache-from type=gha \
		--cache-to type=gha,mode=max \
		.
else
	docker build -t drydock:ci --build-arg DD_VERSION=ci .
fi

echo "Starting load test services..."
docker compose -p "${COMPOSE_PROJECT}" -f "${COMPOSE_FILE}" up -d

echo "Waiting for drydock health endpoint..."
for _ in $(seq 1 30); do
	if curl -sf "${DD_LOAD_TEST_TARGET}/health" >/dev/null 2>&1; then
		echo "Drydock is healthy"
		break
	fi
	sleep 2
done

if ! curl -sf "${DD_LOAD_TEST_TARGET}/health" >/dev/null 2>&1; then
	echo "Drydock failed to become healthy in time"
	exit 1
fi

ARTILLERY_ARGS=(run "${ARTILLERY_FILE}" -e "${ARTILLERY_ENV}" --target "${DD_LOAD_TEST_TARGET}")

if [ -n "${ARTILLERY_CLOUD_API_KEY:-}" ]; then
	ARTILLERY_ARGS+=(--record --key "${ARTILLERY_CLOUD_API_KEY}")
fi

if [ -z "${ARTILLERY_OUTPUT_FILE}" ] && [ -n "${DD_LOAD_TEST_ARTIFACT_DIR}" ]; then
	mkdir -p "${DD_LOAD_TEST_ARTIFACT_DIR}"
	ARTILLERY_OUTPUT_FILE="${DD_LOAD_TEST_ARTIFACT_DIR}/artillery-${ARTILLERY_ENV}-$(date -u +%Y%m%dT%H%M%SZ).json"
fi

if [ -n "${ARTILLERY_OUTPUT_FILE}" ]; then
	ARTILLERY_ARGS+=(--output "${ARTILLERY_OUTPUT_FILE}")
fi

if [ -x "${REPO_ROOT}/e2e/node_modules/.bin/artillery" ]; then
	echo "Running Artillery with e2e pinned install..."
	"${REPO_ROOT}/e2e/node_modules/.bin/artillery" "${ARTILLERY_ARGS[@]}"
elif command -v artillery >/dev/null 2>&1; then
	echo "Running Artillery with local install..."
	artillery "${ARTILLERY_ARGS[@]}"
else
	echo "Running Artillery via npx (pinned ${ARTILLERY_VERSION})..."
	npx --yes "artillery@${ARTILLERY_VERSION}" "${ARTILLERY_ARGS[@]}"
fi

if [ -n "${ARTILLERY_OUTPUT_FILE}" ]; then
	if [ -f "${ARTILLERY_OUTPUT_FILE}" ]; then
		echo "Artillery JSON report written to ${ARTILLERY_OUTPUT_FILE}"
	else
		echo "Artillery JSON report file was expected but not found: ${ARTILLERY_OUTPUT_FILE}"
	fi
fi
