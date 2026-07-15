/**
 * Tests for the Ed25519 standard-mode request signer.
 *
 * Includes known-answer / cross-check tests that pin the exact wire contract
 * required by Portwing's verifier (internal/auth/verify.go):
 *  - the empty-body SHA-256 constant
 *  - the exact canonical-message byte layout (METHOD\nPATH\nhash\nts\nnonce)
 *  - a real Ed25519 sign/verify round trip over that canonical message
 */
import {
  createHash,
  createPrivateKey,
  verify as cryptoVerify,
  generateKeyPairSync,
} from 'node:crypto';
import { describe, expect, test } from 'vitest';
import {
  bodySha256Hex,
  buildCanonicalMessage,
  EMPTY_BODY_SHA256_HEX,
  generateNonce,
  loadEd25519PrivateKey,
  signRequest,
} from './ed25519-signer.js';

/** Generates a PKCS#8 PEM Ed25519 keypair for tests. */
function generateKeypairPem() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }) as string,
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
    publicKeyObject: publicKey,
  };
}

describe('EMPTY_BODY_SHA256_HEX / bodySha256Hex', () => {
  test('matches the well-known SHA-256 of the empty string', () => {
    // Cross-check against an independent computation of sha256('').
    expect(EMPTY_BODY_SHA256_HEX).toBe(createHash('sha256').update('').digest('hex'));
    expect(EMPTY_BODY_SHA256_HEX).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  test('bodySha256Hex returns the empty-body constant for a zero-length body', () => {
    expect(bodySha256Hex(new Uint8Array(0))).toBe(EMPTY_BODY_SHA256_HEX);
  });

  test('bodySha256Hex returns the SHA-256 hex of a non-empty body', () => {
    const body = Buffer.from('{"hello":"world"}', 'utf8');
    expect(bodySha256Hex(body)).toBe(createHash('sha256').update(body).digest('hex'));
    // Sanity: hex, lowercase, 64 chars.
    expect(bodySha256Hex(body)).toMatch(/^[0-9a-f]{64}$/);
  });

  test('bodySha256Hex is sensitive to body content (different bodies hash differently)', () => {
    const a = bodySha256Hex(Buffer.from('a'));
    const b = bodySha256Hex(Buffer.from('b'));
    expect(a).not.toBe(b);
  });
});

describe('buildCanonicalMessage', () => {
  test('produces the exact METHOD\\nPATH\\nhash\\nts\\nnonce byte layout with no trailing newline', () => {
    const message = buildCanonicalMessage(
      'GET',
      '/api/containers',
      EMPTY_BODY_SHA256_HEX,
      1_700_000_000,
      '0123456789abcdef0123456789abcdef',
    );
    expect(message).toBe(
      'GET\n/api/containers\ne3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855\n1700000000\n0123456789abcdef0123456789abcdef',
    );
    // Exactly 4 newlines (5 fields), no trailing newline.
    expect(message.match(/\n/g)).toHaveLength(4);
    expect(message.endsWith('\n')).toBe(false);
  });

  test('uses the literal timestamp integer with no padding/formatting', () => {
    const message = buildCanonicalMessage(
      'POST',
      '/api/x',
      EMPTY_BODY_SHA256_HEX,
      42,
      'n'.repeat(32),
    );
    expect(message).toContain('\n42\n');
  });
});

describe('loadEd25519PrivateKey', () => {
  test('parses a PEM PKCS#8 Ed25519 private key', () => {
    const { privateKeyPem } = generateKeypairPem();
    const keyObject = loadEd25519PrivateKey(privateKeyPem);
    expect(keyObject.asymmetricKeyType).toBe('ed25519');
    expect(keyObject.type).toBe('private');
  });

  test('throws for a non-Ed25519 private key', () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const rsaPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    expect(() => loadEd25519PrivateKey(rsaPem)).toThrow(/Ed25519/);
  });

  test('throws for garbage input', () => {
    expect(() => loadEd25519PrivateKey('not a pem key')).toThrow();
  });
});

describe('generateNonce', () => {
  test('produces 32 lowercase hex characters', () => {
    const nonce = generateNonce();
    expect(nonce).toMatch(/^[0-9a-f]{32}$/);
  });

  test('produces distinct values across calls', () => {
    const nonces = new Set(Array.from({ length: 50 }, () => generateNonce()));
    expect(nonces.size).toBe(50);
  });
});

describe('signRequest', () => {
  test('cross-check: signature verifies against the corresponding public key using the same canonical bytes', () => {
    const { privateKeyPem, publicKeyObject } = generateKeypairPem();
    const privateKey = loadEd25519PrivateKey(privateKeyPem);

    const headers = signRequest({
      method: 'post',
      path: '/api/triggers/docker/update',
      body: Buffer.from('{"id":"abc123"}', 'utf8'),
      keyId: 'deadbeefcafef00d',
      privateKey,
      now: () => 1_700_000_000_000,
      nonce: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });

    // Reconstruct the canonical message exactly as Portwing's verifier would
    // (internal/auth/verify.go: CanonicalMessage(method, path, bodyHash, ts, nonce)).
    const bodyHashHex = bodySha256Hex(Buffer.from('{"id":"abc123"}', 'utf8'));
    const canonicalMessage = buildCanonicalMessage(
      'POST',
      '/api/triggers/docker/update',
      bodyHashHex,
      1_700_000_000,
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    );

    const signatureBuf = Buffer.from(headers['X-Portwing-Signature'], 'base64url');
    const verified = cryptoVerify(
      null,
      Buffer.from(canonicalMessage, 'utf8'),
      publicKeyObject,
      signatureBuf,
    );
    expect(verified).toBe(true);

    // A signature over a tampered message must NOT verify (sanity on the round trip).
    const tampered = Buffer.from(`${canonicalMessage}x`, 'utf8');
    expect(cryptoVerify(null, tampered, publicKeyObject, signatureBuf)).toBe(false);
  });

  test('empty body: signs the canonical empty-body hash and headers verify', () => {
    const { privateKeyPem, publicKeyObject } = generateKeypairPem();
    const privateKey = loadEd25519PrivateKey(privateKeyPem);

    const headers = signRequest({
      method: 'GET',
      path: '/api/containers',
      keyId: 'key-1',
      privateKey,
      now: () => 1_700_000_500_000,
      nonce: 'b'.repeat(32),
    });

    const canonicalMessage = buildCanonicalMessage(
      'GET',
      '/api/containers',
      EMPTY_BODY_SHA256_HEX,
      1_700_000_500,
      'b'.repeat(32),
    );
    const signatureBuf = Buffer.from(headers['X-Portwing-Signature'], 'base64url');
    expect(
      cryptoVerify(null, Buffer.from(canonicalMessage, 'utf8'), publicKeyObject, signatureBuf),
    ).toBe(true);
  });

  test('sets X-Portwing-Key-ID to the provided keyId verbatim', () => {
    const { privateKeyPem } = generateKeypairPem();
    const privateKey = loadEd25519PrivateKey(privateKeyPem);
    const headers = signRequest({
      method: 'GET',
      path: '/api/containers',
      keyId: 'my-key-id-123',
      privateKey,
    });
    expect(headers['X-Portwing-Key-ID']).toBe('my-key-id-123');
  });

  test('X-Portwing-Timestamp is an integer-seconds base-10 string derived from the clock', () => {
    const { privateKeyPem } = generateKeypairPem();
    const privateKey = loadEd25519PrivateKey(privateKeyPem);
    const headers = signRequest({
      method: 'GET',
      path: '/api/containers',
      keyId: 'k',
      privateKey,
      now: () => 1_700_123_456_789, // ms, has sub-second component
    });
    expect(headers['X-Portwing-Timestamp']).toBe('1700123456');
    expect(headers['X-Portwing-Timestamp']).toMatch(/^[0-9]+$/);
    expect(Number.isInteger(Number(headers['X-Portwing-Timestamp']))).toBe(true);
  });

  test('X-Portwing-Timestamp defaults to the real clock (Date.now) when now is not supplied', () => {
    const { privateKeyPem } = generateKeypairPem();
    const privateKey = loadEd25519PrivateKey(privateKeyPem);
    const before = Math.floor(Date.now() / 1000);
    const headers = signRequest({ method: 'GET', path: '/api/x', keyId: 'k', privateKey });
    const after = Math.floor(Date.now() / 1000);
    const ts = Number(headers['X-Portwing-Timestamp']);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  test('X-Portwing-Nonce is exactly 32 lowercase hex characters', () => {
    const { privateKeyPem } = generateKeypairPem();
    const privateKey = loadEd25519PrivateKey(privateKeyPem);
    const headers = signRequest({ method: 'GET', path: '/api/x', keyId: 'k', privateKey });
    expect(headers['X-Portwing-Nonce']).toMatch(/^[0-9a-f]{32}$/);
  });

  test('a fresh nonce is generated per call when not injected', () => {
    const { privateKeyPem } = generateKeypairPem();
    const privateKey = loadEd25519PrivateKey(privateKeyPem);
    const first = signRequest({ method: 'GET', path: '/api/x', keyId: 'k', privateKey });
    const second = signRequest({ method: 'GET', path: '/api/x', keyId: 'k', privateKey });
    expect(first['X-Portwing-Nonce']).not.toBe(second['X-Portwing-Nonce']);
  });

  test('X-Portwing-Signature is base64url with no padding characters', () => {
    const { privateKeyPem } = generateKeypairPem();
    const privateKey = loadEd25519PrivateKey(privateKeyPem);
    const headers = signRequest({ method: 'GET', path: '/api/x', keyId: 'k', privateKey });
    const sig = headers['X-Portwing-Signature'];
    // Ed25519 signatures are 64 raw bytes -> 86 base64url chars, no '=' padding.
    expect(sig).toHaveLength(86);
    expect(sig).not.toMatch(/[+/=]/);
    expect(sig).toMatch(/^[A-Za-z0-9_-]+$/);
    // Decodes back to exactly 64 bytes.
    expect(Buffer.from(sig, 'base64url')).toHaveLength(64);
  });

  test('method is normalized to uppercase before signing', () => {
    const { privateKeyPem, publicKeyObject } = generateKeypairPem();
    const privateKey = loadEd25519PrivateKey(privateKeyPem);
    const headers = signRequest({
      method: 'delete',
      path: '/api/containers/abc',
      keyId: 'k',
      privateKey,
      now: () => 1_700_000_000_000,
      nonce: 'c'.repeat(32),
    });
    const canonicalMessage = buildCanonicalMessage(
      'DELETE',
      '/api/containers/abc',
      EMPTY_BODY_SHA256_HEX,
      1_700_000_000,
      'c'.repeat(32),
    );
    const signatureBuf = Buffer.from(headers['X-Portwing-Signature'], 'base64url');
    expect(
      cryptoVerify(null, Buffer.from(canonicalMessage, 'utf8'), publicKeyObject, signatureBuf),
    ).toBe(true);
  });

  test('different paths produce non-verifiable signatures against each other (no cross-path replay)', () => {
    const { privateKeyPem, publicKeyObject } = generateKeypairPem();
    const privateKey = loadEd25519PrivateKey(privateKeyPem);
    const headers = signRequest({
      method: 'GET',
      path: '/api/containers',
      keyId: 'k',
      privateKey,
      now: () => 1_700_000_000_000,
      nonce: 'd'.repeat(32),
    });
    const wrongPathMessage = buildCanonicalMessage(
      'GET',
      '/api/watchers',
      EMPTY_BODY_SHA256_HEX,
      1_700_000_000,
      'd'.repeat(32),
    );
    const signatureBuf = Buffer.from(headers['X-Portwing-Signature'], 'base64url');
    expect(
      cryptoVerify(null, Buffer.from(wrongPathMessage, 'utf8'), publicKeyObject, signatureBuf),
    ).toBe(false);
  });

  test('accepts a KeyObject created directly via node:crypto createPrivateKey', () => {
    const { privateKeyPem, publicKeyObject } = generateKeypairPem();
    const privateKey = createPrivateKey(privateKeyPem);
    const headers = signRequest({ method: 'GET', path: '/api/x', keyId: 'k', privateKey });
    expect(headers['X-Portwing-Signature']).toBeTruthy();
    void publicKeyObject;
  });
});
