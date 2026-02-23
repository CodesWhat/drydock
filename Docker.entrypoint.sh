#!/usr/bin/env bash
set -eo pipefail

require_insecure_root_ack() {
	if [ "${DD_ALLOW_INSECURE_ROOT}" != "true" ]; then
		cat >&2 <<'EOF'
Refusing to run Drydock in root mode without explicit break-glass acknowledgment.

Recommended fix (secure): use a Docker socket proxy and run Drydock as non-root.
Break-glass override (less secure): set BOTH:
  - DD_RUN_AS_ROOT=true
  - DD_ALLOW_INSECURE_ROOT=true
EOF
		exit 1
	fi
}

# ── Privilege-drop logic (runs only on first invocation as root) ──
if [ "$(id -u)" = "0" ]; then
	# Allow opting out of privilege drop for :ro socket compatibility
	if [ "${DD_RUN_AS_ROOT}" = "true" ]; then
		require_insecure_root_ack
		echo "WARNING: insecure root mode enabled (DD_RUN_AS_ROOT + DD_ALLOW_INSECURE_ROOT)"
	elif [ -S /var/run/docker.sock ]; then
		DOCKER_GID=$(stat -c '%g' /var/run/docker.sock)
		if [ "$DOCKER_GID" != "0" ]; then
			# Non-root GID (e.g. Linux docker group): add node to socket group, drop to node
			# getent exits non-zero when the GID has no named group; that's expected on some hosts.
			EXISTING_GROUP=$(getent group "$DOCKER_GID" 2>/dev/null | cut -d: -f1 || true)
			if [ -n "$EXISTING_GROUP" ]; then
				addgroup node "$EXISTING_GROUP" 2>/dev/null || true
			else
				addgroup -g "$DOCKER_GID" -S docker 2>/dev/null || true
				addgroup node docker 2>/dev/null || true
			fi
			exec su-exec node "$0" "$@"
		fi
		cat >&2 <<'EOF'
Refusing implicit root mode: /var/run/docker.sock is owned by GID 0.

Recommended fix (secure): use a Docker socket proxy and keep privilege drop enabled.
Break-glass override (less secure): set BOTH:
  - DD_RUN_AS_ROOT=true
  - DD_ALLOW_INSECURE_ROOT=true
EOF
		exit 1
	else
		# No socket mounted: drop to node
		exec su-exec node "$0" "$@"
	fi
fi

# ── Application start ──
# if the first argument starts with `-`, prepend `node dist/index`
if [[ ${1#-} != "$1" ]]; then
	set -- node dist/index "$@"
fi

exec "$@"
