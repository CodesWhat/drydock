#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
TARGET_SCRIPT="$SCRIPT_DIR/generate-tls-fixtures.sh"

tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

bash "$TARGET_SCRIPT" "$tmp_dir" >/dev/null

check_pair() {
	local key="$1" cert="$2" expected_cn="$3"
	[[ -s "$key" && -s "$cert" ]] || { echo "FAIL: missing $key or $cert" >&2; exit 1; }
	openssl x509 -in "$cert" -noout -subject | grep -q "$expected_cn" ||
		{ echo "FAIL: $cert subject is not $expected_cn" >&2; exit 1; }
	local key_pub cert_pub
	key_pub=$(openssl pkey -in "$key" -pubout)
	cert_pub=$(openssl x509 -in "$cert" -noout -pubkey)
	[[ "$key_pub" == "$cert_pub" ]] || { echo "FAIL: $key does not match $cert" >&2; exit 1; }
	openssl x509 -in "$cert" -noout -checkend 3600 >/dev/null ||
		{ echo "FAIL: $cert expires within an hour" >&2; exit 1; }
}

check_pair "$tmp_dir/migration/tls.key" "$tmp_dir/migration/tls.crt" "mock-oidc-tls"
check_pair "$tmp_dir/qa-proxy-certs/key.pem" "$tmp_dir/qa-proxy-certs/cert.pem" "localhost"

echo "generate-tls-fixtures: ok"
