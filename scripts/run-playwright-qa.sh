#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
COMPOSE_FILE="$REPO_ROOT/test/qa-compose.yml"
PROJECT_NAME="${DD_PLAYWRIGHT_PROJECT:-drydock-playwright-local}"
HEALTH_URL="${DD_PLAYWRIGHT_HEALTH_URL:-http://localhost:3333/api/health}"
QA_IMAGE="drydock:dev"

cleanup() {
	docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

iso8601_to_epoch() {
	local timestamp="$1"
	python3 - "$timestamp" <<'PY'
import datetime
import sys

ts = sys.argv[1].strip()
if not ts:
    raise SystemExit(1)

if ts.endswith("Z"):
    ts = f"{ts[:-1]}+00:00"

try:
    dt = datetime.datetime.fromisoformat(ts)
except ValueError:
    raise SystemExit(1)

if dt.tzinfo is None:
    dt = dt.replace(tzinfo=datetime.timezone.utc)

print(int(dt.timestamp()))
PY
}

should_build_qa_image() {
	if ! docker image inspect "$QA_IMAGE" >/dev/null 2>&1; then
		echo "ℹ️  QA image '$QA_IMAGE' not found; building..."
		return 0
	fi

	local image_created
	image_created=$(docker image inspect --format='{{.Created}}' "$QA_IMAGE" 2>/dev/null | head -n 1 || true)
	if [[ -z "$image_created" ]]; then
		echo "ℹ️  Unable to read '$QA_IMAGE' creation timestamp; building..."
		return 0
	fi

	local last_commit_epoch
	last_commit_epoch=$(git -C "$REPO_ROOT" log -1 --format=%ct 2>/dev/null || true)
	if [[ ! "$last_commit_epoch" =~ ^[0-9]+$ ]]; then
		echo "ℹ️  Unable to read latest git commit timestamp; building..."
		return 0
	fi

	if ! command -v python3 >/dev/null 2>&1; then
		echo "ℹ️  python3 is unavailable for timestamp parsing; building..."
		return 0
	fi

	local image_created_epoch
	if ! image_created_epoch=$(iso8601_to_epoch "$image_created"); then
		echo "ℹ️  Unable to parse '$QA_IMAGE' creation timestamp; building..."
		return 0
	fi

	if (( image_created_epoch >= last_commit_epoch )); then
		echo "♻️  Reusing '$QA_IMAGE' (newer than latest commit)."
		return 1
	fi

	echo "ℹ️  Latest commit is newer than '$QA_IMAGE'; rebuilding..."
	return 0
}

echo "🧹 Ensuring no stale Playwright QA stack is running..."
docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" down -v --remove-orphans >/dev/null 2>&1 || true

if should_build_qa_image; then
	echo "🐳 Building drydock QA image ($QA_IMAGE)..."
	docker build --build-arg DD_VERSION=prepush --tag "$QA_IMAGE" "$REPO_ROOT"
fi

echo "🚀 Starting Playwright QA stack..."
docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" up -d

echo "⏳ Waiting for Playwright QA health: $HEALTH_URL"
for _ in $(seq 1 60); do
	if curl -sf "$HEALTH_URL" >/dev/null 2>&1; then
		echo "✅ Playwright QA is healthy"
		break
	fi
	sleep 2
done

if ! curl -sf "$HEALTH_URL" >/dev/null 2>&1; then
	echo "❌ Playwright QA failed to become healthy after 120 seconds."
	docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" ps || true
	docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" logs --no-color --tail 80 || true
	exit 1
fi

echo "🧪 Running Playwright E2E tests..."
(cd "$REPO_ROOT/e2e" && npm run test:playwright)

echo "✅ Playwright E2E tests completed"
