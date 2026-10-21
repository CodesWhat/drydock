#!/usr/bin/env bash
set -eo pipefail
umask 077

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

DOCKER_SOCK="${DD_ENTRYPOINT_DOCKER_SOCK:-/var/run/docker.sock}"

# Add node to a GID's group, creating a named group first when the GID has none.
# getent exits non-zero for an unnamed GID; that's expected, not an error.
ensure_node_in_gid() {
	_gid="$1"
	_fallback_name="$2"
	_name=$(getent group "$_gid" 2>/dev/null | cut -d: -f1 || true)
	if [ -z "$_name" ]; then
		_name="$_fallback_name"
		addgroup -g "$_gid" -S "$_name" 2>/dev/null || true
	fi
	addgroup node "$_name" 2>/dev/null || true
}

# su-exec rebuilds supplementary groups from /etc/group, which drops the GIDs
# Docker added with group_add. The image strips root from every /etc/group member
# list, so the supplementary list read here holds only group_add entries, with
# one exception: Docker always puts root's primary GID 0 in the list. GID 0 is
# therefore preserved only when it appears more than once (a group_add of "0"
# adds a second entry); a single 0 is the default and is not carried over.
preserve_group_add_gids() {
	_status_file="${DD_ENTRYPOINT_PROC_STATUS:-/proc/self/status}"
	_node_gid=$(id -g node)
	_preserved=""
	for _gid in $(awk '/^Groups:/ { for (i = 2; i <= NF; i++) { if (!($i in c)) o[++n] = $i; c[$i]++ } } END { for (j = 1; j <= n; j++) if (o[j] != "0" || c[o[j]] > 1) print o[j] }' "$_status_file" 2>/dev/null || true); do
		if [ "$_gid" = "$_node_gid" ]; then
			continue
		fi
		ensure_node_in_gid "$_gid" "dd-gid-$_gid"
		_preserved="${_preserved:+$_preserved }$_gid"
	done
	if [ -n "$_preserved" ]; then
		echo "Preserving group_add supplementary GIDs for node: $_preserved"
	fi
}

# ── Privilege-drop logic (runs only on first invocation as root) ──
if [ "$(id -u)" = "0" ]; then
	# Allow opting out of privilege drop for :ro socket compatibility
	if [ "${DD_RUN_AS_ROOT}" = "true" ]; then
		require_insecure_root_ack
		echo "WARNING: insecure root mode enabled (DD_RUN_AS_ROOT + DD_ALLOW_INSECURE_ROOT)"
	elif [ -S "$DOCKER_SOCK" ]; then
		DOCKER_GID=$(stat -c '%g' "$DOCKER_SOCK")
		if [ "$DOCKER_GID" != "0" ]; then
			# Non-root GID (e.g. Linux docker group): add node to socket group, drop to node
			ensure_node_in_gid "$DOCKER_GID" docker
			preserve_group_add_gids
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
		preserve_group_add_gids
		exec su-exec node "$0" "$@"
	fi
fi

# ── Application start ──
# if the first argument starts with `-`, prepend `node dist/index`
if [[ ${1#-} != "$1" ]]; then
	set -- node dist/index "$@"
fi

exec "$@"
