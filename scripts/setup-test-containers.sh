#!/bin/bash

set -e

echo "🐳 Setting up test containers for local e2e tests..."

# Login to private registries (if credentials available)
if [ ! -z "$GITLAB_TOKEN" ]; then
	docker login registry.gitlab.com -u "$GITLAB_USERNAME" -p "$GITLAB_TOKEN"
fi

# Pull nginx as a test image
docker pull nginx:1.10-alpine
docker pull nginx:1.20-alpine

# Tag nginx 1.10 as latest to simulate an update_available
docker tag nginx:1.10-alpine nginx:latest

# Tag nginx as if it was coming from private registries
docker tag nginx:1.10-alpine codeswhat/test:1.0.0
docker tag nginx:1.10-alpine 229211676173.dkr.ecr.eu-west-1.amazonaws.com/test:1.0.0
docker tag nginx:1.10-alpine 229211676173.dkr.ecr.eu-west-1.amazonaws.com/sub/test:1.0.0
docker tag nginx:1.10-alpine 229211676173.dkr.ecr.eu-west-1.amazonaws.com/sub/sub/test:1.0.0

# Pull homeassistant
docker pull homeassistant/home-assistant
docker pull homeassistant/home-assistant:2021.6.1

# Pull traefik
docker pull traefik:2.4.5

echo "✅ Docker images pulled and tagged"

# Run containers for tests
echo "🚀 Starting test containers..."

readonly LABEL_WATCH='dd.watch=true'

run_test_container() {
	local name="$1"
	shift
	docker rm -f "$name" 2>/dev/null || true
	docker run -d --name "$name" "$@"
}

# ECR
run_test_container ecr_sub_sub_test --label "$LABEL_WATCH" 229211676173.dkr.ecr.eu-west-1.amazonaws.com/sub/sub/test:1.0.0

# GHCR
run_test_container ghcr_radarr --label "$LABEL_WATCH" --label 'dd.tag.include=^\d+\.\d+\.\d+\.\d+-ls\d+$' ghcr.io/linuxserver/radarr:5.14.0.9383-ls245

# GITLAB
run_test_container gitlab_test --label "$LABEL_WATCH" --label 'dd.tag.include=^v16\.[01]\.0$' registry.gitlab.com/gitlab-org/gitlab-runner:v16.0.0

# HUB
# shellcheck disable=SC2016 # drydock resolves ${major}/${minor}/${patch} placeholders at runtime.
run_test_container hub_homeassistant_202161 --label "$LABEL_WATCH" --label 'dd.tag.include=^\d+\.\d+.\d+$' --label 'dd.link.template=https://github.com/home-assistant/core/releases/tag/${major}.${minor}.${patch}' homeassistant/home-assistant:2021.6.1
run_test_container hub_homeassistant_latest --label "$LABEL_WATCH" --label 'dd.watch.digest=true' --label 'dd.tag.include=^latest$' homeassistant/home-assistant
run_test_container hub_nginx_120 --label "$LABEL_WATCH" --label 'dd.tag.include=^\d+\.\d+-alpine$' nginx:1.20-alpine
run_test_container hub_nginx_latest --label "$LABEL_WATCH" --label 'dd.watch.digest=true' --label 'dd.tag.include=^latest$' nginx
run_test_container hub_traefik_245 --label "$LABEL_WATCH" --label 'dd.tag.include=^\d+\.\d+.\d+$' traefik:2.4.5

# LSCR
run_test_container lscr_radarr --label "$LABEL_WATCH" --label 'dd.tag.include=^\d+\.\d+\.\d+\.\d+-ls\d+$' lscr.io/linuxserver/radarr:5.14.0.9383-ls245

# TrueForge
run_test_container trueforge_radarr --label "$LABEL_WATCH" --label 'dd.tag.include=^v\d+\.\d+\.\d+$' --memory 512m --tmpfs /config oci.trueforge.org/containerforge/radarr:6.0.4

# QUAY
run_test_container quay_prometheus --label "$LABEL_WATCH" --label 'dd.tag.include=^v\d+\.\d+\.\d+$' --user root --tmpfs /prometheus:rw,mode=777 quay.io/prometheus/prometheus:v2.52.0

echo "✅ Test containers started (10 containers)"
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}" | grep -E "(ecr_|ghcr_|gitlab_|hub_|lscr_|quay_|trueforge_)"
