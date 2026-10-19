#!/usr/bin/env bash
# Generates throwaway self-signed TLS key/cert pairs for the QA and migration
# compose stacks. Nothing is committed: run this before `docker compose up` for
# test/migration-test-compose.yml, test/qa-proxy-compose.yml or
# test/qa-traefik-compose.yml. Output paths are gitignored.
#
# Usage: bash test/generate-tls-fixtures.sh [output-root]
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
OUT_ROOT=${1:-$SCRIPT_DIR}

gen_pair() {
	local dir="$1" key_name="$2" cert_name="$3" cn="$4" san="$5"
	mkdir -p "$dir"
	openssl req -x509 -newkey rsa:2048 -nodes -days 30 \
		-subj "/CN=$cn" -addext "subjectAltName=$san" \
		-keyout "$dir/$key_name" -out "$dir/$cert_name" 2>/dev/null
	chmod 600 "$dir/$key_name"
}

# nginx TLS terminator in front of the mock OIDC provider (migration stack).
gen_pair "$OUT_ROOT/migration" tls.key tls.crt mock-oidc-tls "DNS:mock-oidc-tls"

# nginx and traefik QA proxy stacks.
gen_pair "$OUT_ROOT/qa-proxy-certs" key.pem cert.pem localhost "DNS:localhost,IP:127.0.0.1"

echo "Generated TLS fixtures under $OUT_ROOT"
