#!/usr/bin/env bash
# Fail unless every digest-pinned FROM in a Dockerfile resolves to a
# multi-platform image index covering every platform we ship.
#
# Why this exists: buildx resolves a digest pin identically for every
# --platform value, because the digest already names one manifest. Pin a
# per-platform manifest (application/vnd.oci.image.manifest.v1+json) and the
# arm64 stage builds on an amd64 rootfs with no error anywhere, producing an
# x86-64 image under an arm64 label. That is drydock#1021: v1.7.0-rc.4 through
# rc.10 shipped x86-64 /sbin/tini, node and healthcheck binaries on arm64.
#
# Usage: scripts/check-dockerfile-base-indexes.sh <Dockerfile> <platforms-csv>
#   scripts/check-dockerfile-base-indexes.sh Dockerfile linux/amd64,linux/arm64
set -euo pipefail

dockerfile="${1:-}"
platforms_csv="${2:-}"

if [ -z "${dockerfile}" ] || [ -z "${platforms_csv}" ]; then
	echo "Usage: $0 <Dockerfile> <platforms-csv>" >&2
	exit 2
fi

if [ ! -f "${dockerfile}" ]; then
	echo "::error::Dockerfile not found: ${dockerfile}" >&2
	exit 2
fi

# linux/arm64/v8 and linux/arm64 are the same platform for this check: the
# variant only ever narrows an architecture, so comparing os/arch is what
# decides whether a stage can build natively.
normalize_platform() {
	local value="$1"
	local os="${value%%/*}"
	local rest="${value#*/}"
	local arch="${rest%%/*}"
	printf '%s/%s\n' "${os}" "${arch}"
}

required_platforms=()
while IFS= read -r platform; do
	if [ -n "${platform}" ]; then
		required_platforms+=("$(normalize_platform "${platform}")")
	fi
done <<<"${platforms_csv//,/$'\n'}"

if [ "${#required_platforms[@]}" -eq 0 ]; then
	echo "::error::No platforms given; expected a csv such as linux/amd64,linux/arm64" >&2
	exit 2
fi

# FROM [--flag=value ...] <ref>@sha256:<64 hex> [AS <stage>]
from_pattern='^[[:space:]]*[Ff][Rr][Oo][Mm][[:space:]]+(--[^[:space:]]+[[:space:]]+)*([^[:space:]]+@sha256:[0-9a-f]{64})([[:space:]]|$)'

pinned_refs=()
while IFS= read -r line || [ -n "${line}" ]; do
	if [[ ${line} =~ ${from_pattern} ]]; then
		ref="${BASH_REMATCH[2]}"
		already_seen=false
		for seen in ${pinned_refs[@]+"${pinned_refs[@]}"}; do
			if [ "${seen}" = "${ref}" ]; then
				already_seen=true
				break
			fi
		done
		if [ "${already_seen}" = false ]; then
			pinned_refs+=("${ref}")
		fi
	fi
done <"${dockerfile}"

if [ "${#pinned_refs[@]}" -eq 0 ]; then
	echo "::error::${dockerfile} has no digest-pinned FROM instructions; base images must be pinned to an image index digest."
	exit 1
fi

echo "Checking ${#pinned_refs[@]} digest-pinned base image(s) in ${dockerfile} for ${required_platforms[*]}"

failures=0

for ref in "${pinned_refs[@]}"; do
	# inspect legitimately fails on a deleted digest or a registry outage, so
	# capture it rather than letting set -e abort with no explanation.
	raw=""
	if ! raw="$(docker buildx imagetools inspect --raw "${ref}" 2>&1)"; then
		echo "::error::${ref}: could not inspect the manifest: ${raw}"
		failures=$((failures + 1))
		continue
	fi

	media_type=""
	if ! media_type="$(printf '%s' "${raw}" | jq -r '.mediaType // ""')"; then
		echo "::error::${ref}: manifest is not valid JSON."
		failures=$((failures + 1))
		continue
	fi

	# mediaType is optional in the OCI image spec, so the presence of a
	# manifests array is the structural test and mediaType is the declared one.
	is_index="$(printf '%s' "${raw}" | jq -r 'if (.manifests | type) == "array" then "true" else "false" end')"

	case "${media_type}" in
	application/vnd.oci.image.index.v1+json | application/vnd.docker.distribution.manifest.list.v2+json) ;;
	"") ;;
	*)
		echo "::error::${ref}: pinned to a single-platform manifest (mediaType ${media_type}). Pin the image index digest instead. See drydock#1021."
		failures=$((failures + 1))
		continue
		;;
	esac

	if [ "${is_index}" != "true" ]; then
		echo "::error::${ref}: manifest carries no platform list, so it is a single-platform image. Pin the image index digest instead. See drydock#1021."
		failures=$((failures + 1))
		continue
	fi

	# unknown/unknown entries are attestation manifests, not platforms.
	available="$(printf '%s' "${raw}" | jq -r '
        [ .manifests[]?
          | select(.platform != null)
          | "\(.platform.os)/\(.platform.architecture)"
          | select(. != "unknown/unknown")
        ] | unique | .[]
    ')"

	missing=()
	for platform in "${required_platforms[@]}"; do
		found=false
		while IFS= read -r candidate; do
			if [ "${candidate}" = "${platform}" ]; then
				found=true
				break
			fi
		done <<<"${available}"
		if [ "${found}" = false ]; then
			missing+=("${platform}")
		fi
	done

	if [ "${#missing[@]}" -gt 0 ]; then
		echo "::error::${ref}: image index is missing ${missing[*]} (has: $(echo "${available}" | tr '\n' ' '))."
		failures=$((failures + 1))
		continue
	fi

	echo "ok: ${ref} is an image index covering ${required_platforms[*]}"
done

if [ "${failures}" -gt 0 ]; then
	echo "::error::${failures} base image pin(s) in ${dockerfile} are not multi-platform image indexes."
	exit 1
fi

echo "All base image pins in ${dockerfile} are image indexes covering ${required_platforms[*]}."
