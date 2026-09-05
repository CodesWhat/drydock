#!/usr/bin/env bash
# Fail unless the binaries inside a built image are actually compiled for the
# platform the image claims. Reads the ELF e_machine field (2 bytes at offset
# 18, little-endian) straight out of the shipped binaries.
#
# Why this exists: a mislabelled base image pin produces an image whose index
# entry says linux/arm64 while every binary in it is x86-64, and nothing in a
# build, scan, or manifest check notices. Users find out with
# "exec /sbin/tini: exec format error" on first start. That is drydock#1021.
#
# Usage: scripts/check-image-arch.sh <image-ref> <platform>
#   scripts/check-image-arch.sh drydock:dev linux/arm64
set -euo pipefail

image_ref="${1:-}"
platform="${2:-}"

if [ -z "${image_ref}" ] || [ -z "${platform}" ]; then
	echo "Usage: $0 <image-ref> <platform>" >&2
	exit 2
fi

# Only the platforms drydock publishes. Anything else needs its own e_machine
# value (and, for s390x or ppc64, the opposite byte order), so guess nothing.
case "${platform}" in
linux/amd64 | linux/amd64/*)
	expected="3e 00"
	expected_arch="x86-64"
	;;
linux/arm64 | linux/arm64/*)
	expected="b7 00"
	expected_arch="aarch64"
	;;
*)
	echo "::error::Unsupported platform ${platform}. Add its ELF e_machine bytes to $0 before building for it."
	exit 2
	;;
esac

binaries=(/sbin/tini /usr/local/bin/node /bin/healthcheck)

# busybox od is present in every alpine-based stage; -j18 -N2 -tx1 prints the
# two e_machine bytes and nothing else. Only the paths interpolate here: the
# rest of the probe must reach the container's sh unexpanded.
# shellcheck disable=SC2016
probe="set -- ${binaries[*]}"'
for f in "$@"; do
  if [ -r "$f" ]; then
    printf "%s%s\n" "$f" "$(od -An -tx1 -j18 -N2 "$f")"
  else
    printf "%s MISSING MISSING\n" "$f"
  fi
done'

is_expected_binary() {
	local candidate="$1"
	local known
	for known in "${binaries[@]}"; do
		if [ "${known}" = "${candidate}" ]; then
			return 0
		fi
	done
	return 1
}

echo "Checking ${image_ref} (${platform}) for ${expected_arch} binaries, e_machine ${expected}"

# The release workflow hands us the same *index* digest for every platform
# ("...@sha256:<index>"), and running docker against that one reference twice
# fails the second time: docker's classic image store cannot hold two
# platform variants under one digest, and aborts with "cannot overwrite
# digest sha256:<index>". Resolve the platform's own manifest digest first so
# each docker run pulls a distinct reference. A reference that is not an
# index at all (no digest, or already a single-platform manifest) has
# nothing to resolve, so it runs unchanged.
repository="${image_ref%@*}"
last_segment="${repository##*/}"
if [[ ${last_segment} == *:* ]]; then
	repository="${repository%:*}"
fi

raw_manifest=""
if ! raw_manifest="$(docker buildx imagetools inspect --raw "${image_ref}" 2>&1)"; then
	echo "::error::Could not inspect ${image_ref}: ${raw_manifest}"
	exit 1
fi

is_index="$(printf '%s' "${raw_manifest}" | jq -r 'if (.manifests | type) == "array" then "true" else "false" end')"

run_ref="${image_ref}"
if [ "${is_index}" = "true" ]; then
	requested_os="${platform%%/*}"
	requested_rest="${platform#*/}"
	requested_arch="${requested_rest%%/*}"
	requested_variant=""
	if [[ ${requested_rest} == */* ]]; then
		requested_variant="${requested_rest#*/}"
	fi

	# unknown/unknown platforms and vnd.docker.reference.type annotations mark
	# attestation manifests, not platform images; exclude them explicitly
	# rather than trust that they never collide with a real request.
	matches="$(printf '%s' "${raw_manifest}" | jq -r --arg os "${requested_os}" --arg arch "${requested_arch}" --arg variant "${requested_variant}" '
        [ .manifests[]?
          | select(.platform != null)
          | select(.platform.os != "unknown")
          | select((.annotations["vnd.docker.reference.type"] // "") == "")
          | select(.platform.os == $os and .platform.architecture == $arch)
          | select($variant == "" or .platform.variant == $variant)
          | .digest
        ] | .[]
    ')"

	manifest_digests=()
	while IFS= read -r digest; do
		[ -n "${digest}" ] && manifest_digests+=("${digest}")
	done <<<"${matches}"

	if [ "${#manifest_digests[@]}" -eq 0 ]; then
		available="$(printf '%s' "${raw_manifest}" | jq -r '
            [ .manifests[]?
              | select(.platform != null)
              | select(.platform.os != "unknown")
              | select((.annotations["vnd.docker.reference.type"] // "") == "")
              | "\(.platform.os)/\(.platform.architecture)\(if .platform.variant then "/" + .platform.variant else "" end)"
            ] | unique | .[]
        ')"
		echo "::error::${image_ref} has no manifest for ${platform}. Index contains: $(echo "${available}" | tr '\n' ' ')"
		exit 1
	fi

	if [ "${#manifest_digests[@]}" -gt 1 ]; then
		echo "::error::${image_ref} has ${#manifest_digests[@]} manifests matching ${platform}, expected exactly one: ${manifest_digests[*]}"
		exit 1
	fi

	run_ref="${repository}@${manifest_digests[0]}"
fi

# stderr has to stay out of the parsed output: docker writes pull progress
# there, and on a runner that has never seen the image that is 30 lines of
# "Pulling fs layer" ahead of the probe's three.
docker_stderr="$(mktemp)"
trap 'rm -f "${docker_stderr}"' EXIT

# A pull failure or a missing emulator is a legitimate non-zero here, so keep
# the output instead of letting set -e abort with nothing to read.
output=""
if ! output="$(docker run --rm --pull always --platform "${platform}" --entrypoint sh "${run_ref}" -c "${probe}" 2>"${docker_stderr}")"; then
	echo "::error::Could not read ${run_ref} as ${platform}: $(cat "${docker_stderr}")"
	exit 1
fi

failures=0
checked=0

while IFS= read -r line; do
	[ -n "${line}" ] || continue
	path=""
	byte_low=""
	byte_high=""
	read -r path byte_low byte_high <<<"${line}"
	# Anything the image writes to stdout that is not one of the probed paths
	# is not evidence either way, so it cannot be allowed to move the count.
	if ! is_expected_binary "${path}"; then
		continue
	fi
	if [ -z "${byte_low}" ] || [ -z "${byte_high}" ]; then
		echo "::error::Unreadable probe output for ${image_ref} (${platform}): ${line}"
		failures=$((failures + 1))
		continue
	fi
	checked=$((checked + 1))
	actual="${byte_low} ${byte_high}"
	if [ "${actual}" = "MISSING MISSING" ]; then
		echo "::error::${platform} ${image_ref}: ${path} is missing from the image."
		failures=$((failures + 1))
		continue
	fi
	if [ "${actual}" = "${expected}" ]; then
		echo "ok: ${platform} ${path} e_machine=${actual} (${expected_arch})"
	else
		echo "::error::${platform} ${image_ref}: ${path} has e_machine=${actual}, expected ${expected} (${expected_arch}). The image is labelled ${platform} but was built from another architecture. See drydock#1021."
		failures=$((failures + 1))
	fi
done <<<"${output}"

if [ "${checked}" -ne "${#binaries[@]}" ]; then
	echo "::error::Expected ${#binaries[@]} binaries in ${image_ref} (${platform}), read ${checked}. Probe output: ${output}"
	exit 1
fi

if [ "${failures}" -gt 0 ]; then
	echo "::error::${image_ref} is not a ${platform} image: ${failures} of ${#binaries[@]} binaries have the wrong architecture."
	exit 1
fi

echo "All ${#binaries[@]} binaries in ${image_ref} are ${expected_arch} (${platform})."
