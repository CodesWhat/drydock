/**
 * Ed25519 standard-mode request signing client.
 *
 * Produces the four `X-Portwing-*` headers Portwing's HTTP verifier
 * (`internal/auth/verify.go`) expects on every authenticated standard-mode
 * request, as an opt-in alternative to the legacy `X-Dd-Agent-Secret` token
 * header (see AgentClient.ts / app/agent/components/Agent.ts `authMode`).
 *
 * This module is intentionally a small, pure unit with no AgentClient/axios
 * dependencies so the canonical byte layout and signature encoding can be
 * tested in isolation. It mirrors — byte for byte — the canonical message
 * format implemented server-side in Portwing's CanonicalMessage() and the
 * edge-mode hello signer in app/api/portwing-ws.ts#verifyHelloSignature.
 *
 * Canonical message (UTF-8, no trailing newline):
 *   METHOD\nPATH\nbody-sha256-hex\nunix-timestamp\nnonce
 *
 * - METHOD: HTTP method, uppercase, as sent.
 * - PATH: the request URL path only (no query string) — must match what the
 *   server's URL router reconstructs as the *decoded* path (Go's r.URL.Path),
 *   so callers must pass the plain, unescaped path segments here rather than
 *   a percent-encoded one.
 * - body-sha256-hex: lowercase hex SHA-256 of the raw request body bytes as
 *   they will appear on the wire. An empty/zero-length body hashes to the
 *   well-known SHA-256-of-empty-string constant (EMPTY_BODY_SHA256_HEX).
 * - unix-timestamp: integer seconds, base-10, identical to the timestamp
 *   header value.
 * - nonce: 32 lowercase hex characters (16 random bytes), identical to the
 *   nonce header value.
 */

import type { KeyObject } from 'node:crypto';
import { createHash, createPrivateKey, sign as cryptoSign, randomBytes } from 'node:crypto';

/** Header names used by Portwing's Ed25519 request verifier. */
export const ED25519_AUTH_HEADER_NAMES = {
  keyId: 'X-Portwing-Key-ID',
  timestamp: 'X-Portwing-Timestamp',
  nonce: 'X-Portwing-Nonce',
  signature: 'X-Portwing-Signature',
} as const;

/** SHA-256 hex digest of the empty string — the body hash for empty-body requests. */
export const EMPTY_BODY_SHA256_HEX =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

export interface Ed25519SignedHeaders {
  'X-Portwing-Key-ID': string;
  'X-Portwing-Timestamp': string;
  'X-Portwing-Nonce': string;
  'X-Portwing-Signature': string;
}

/**
 * Parse a PEM-encoded PKCS#8 Ed25519 private key (the format Portwing's own
 * `internal/auth/keygen.go` reads/writes) into a Node KeyObject usable by
 * signRequest(). Throws if the material is not a valid Ed25519 private key.
 */
export function loadEd25519PrivateKey(pem: string): KeyObject {
  const keyObject = createPrivateKey(pem);
  if (keyObject.asymmetricKeyType !== 'ed25519') {
    throw new Error(
      `Expected an Ed25519 private key, got asymmetricKeyType=${keyObject.asymmetricKeyType ?? 'unknown'}`,
    );
  }
  return keyObject;
}

/**
 * Hex-encoded SHA-256 of `body`. Returns the canonical empty-body hash when
 * body is zero-length, matching Portwing's BodyHashHex().
 */
export function bodySha256Hex(body: Uint8Array): string {
  if (body.length === 0) {
    return EMPTY_BODY_SHA256_HEX;
  }
  return createHash('sha256').update(body).digest('hex');
}

/**
 * Build the exact canonical byte string that is signed and verified.
 * Exposed separately from signRequest() so tests can assert the byte layout
 * independent of signing/encoding.
 */
export function buildCanonicalMessage(
  method: string,
  path: string,
  bodyHashHex: string,
  timestampSeconds: number,
  nonce: string,
): string {
  return `${method}\n${path}\n${bodyHashHex}\n${timestampSeconds}\n${nonce}`;
}

export interface SignRequestOptions {
  /** HTTP method, any case — normalized to uppercase before signing. */
  method: string;
  /** URL path only, no query string, unescaped (see module doc). */
  path: string;
  /** Raw request body bytes as they will be sent on the wire. Omit/empty for no body. */
  body?: Uint8Array;
  /** The key identifier to send in X-Portwing-Key-ID. */
  keyId: string;
  /** Parsed Ed25519 private key (see loadEd25519PrivateKey). */
  privateKey: KeyObject;
  /** Injectable clock (epoch milliseconds). Defaults to Date.now. */
  now?: () => number;
  /** Injectable nonce (32 lowercase hex chars). Defaults to a fresh random one. */
  nonce?: string;
}

/** Generate a fresh nonce: 16 random bytes, lowercase hex (32 chars). */
export function generateNonce(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Sign a standard-mode request and return the four X-Portwing-* headers to
 * attach to it. Pure aside from the injectable clock/nonce and the
 * node:crypto calls (randomBytes/sign) — no network or AgentClient coupling.
 */
export function signRequest(options: SignRequestOptions): Ed25519SignedHeaders {
  const { method, path, body = new Uint8Array(0), keyId, privateKey, now = Date.now } = options;

  const timestampSeconds = Math.floor(now() / 1000);
  const nonce = options.nonce ?? generateNonce();
  const bodyHashHex = bodySha256Hex(body);
  const canonicalMessage = buildCanonicalMessage(
    method.toUpperCase(),
    path,
    bodyHashHex,
    timestampSeconds,
    nonce,
  );

  const signature = cryptoSign(null, Buffer.from(canonicalMessage, 'utf8'), privateKey);

  return {
    'X-Portwing-Key-ID': keyId,
    'X-Portwing-Timestamp': String(timestampSeconds),
    'X-Portwing-Nonce': nonce,
    'X-Portwing-Signature': signature.toString('base64url'),
  };
}
