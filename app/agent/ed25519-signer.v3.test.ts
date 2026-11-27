/**
 * Signature v3 (audience-bound) tests, driven by Portwing's published vectors
 * (internal/auth/testdata/signature-v3-vectors.json, copied verbatim into
 * ./fixtures so the suite never reads outside the repository).
 */
import { createPrivateKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  bodySha256Hex,
  buildCanonicalMessageV3,
  isValidAgentId,
  signRequest,
} from './ed25519-signer.js';

interface Vector {
  name: string;
  signedVersion: string;
  signedForAgent: string;
  request: { method: string; target: string; body: string };
  timestamp: number;
  nonce: string;
  canonicalString: string;
  signatureBase64url: string;
}

const vectorFile = JSON.parse(
  readFileSync(new URL('./fixtures/portwing-signature-v3-vectors.json', import.meta.url), 'utf8'),
) as {
  key: { seedAscii: string; keyId: string };
  agentIdRule: { valid: string[]; invalid: string[] };
  vectors: Vector[];
};

const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const vectorKey = createPrivateKey({
  key: Buffer.concat([PKCS8_ED25519_PREFIX, Buffer.from(vectorFile.key.seedAscii, 'ascii')]),
  format: 'der',
  type: 'pkcs8',
});
const v3Vectors = vectorFile.vectors.filter(
  (vector) => vector.signedVersion === '3' && vector.signedForAgent,
);

describe('signature v3 against the Portwing vectors', () => {
  test('the fixture carries v3 vectors', () => {
    expect(v3Vectors.length).toBeGreaterThan(0);
  });

  test.each(v3Vectors.map((vector) => [vector.name, vector] as const))(
    'signRequest reproduces vector %s byte for byte',
    (_name, vector) => {
      const headers = signRequest({
        method: vector.request.method,
        path: vector.request.target,
        body: Buffer.from(vector.request.body, 'utf8'),
        keyId: vectorFile.key.keyId,
        privateKey: vectorKey,
        audience: vector.signedForAgent,
        now: () => vector.timestamp * 1000,
        nonce: vector.nonce,
      });
      expect(headers['X-Portwing-Signature']).toBe(vector.signatureBase64url);
      expect(headers['X-Portwing-Signature-Version']).toBe('3');
      expect(headers['X-Portwing-Key-ID']).toBe(vectorFile.key.keyId);
      expect(headers['X-Portwing-Timestamp']).toBe(String(vector.timestamp));
      expect(headers['X-Portwing-Nonce']).toBe(vector.nonce);
      expect(headers['X-Portwing-Audience']).toBe(vector.signedForAgent);
    },
  );

  test.each(v3Vectors.map((vector) => [vector.name, vector] as const))(
    'buildCanonicalMessageV3 matches the canonical string of vector %s',
    (_name, vector) => {
      expect(
        buildCanonicalMessageV3(
          vector.signedForAgent,
          vector.request.method,
          vector.request.target,
          bodySha256Hex(Buffer.from(vector.request.body, 'utf8')),
          vector.timestamp,
          vector.nonce,
        ),
      ).toBe(vector.canonicalString);
    },
  );

  test('without an audience the signer still produces version 2', () => {
    const headers = signRequest({
      method: 'GET',
      path: '/_portwing/info',
      keyId: vectorFile.key.keyId,
      privateKey: vectorKey,
    });
    expect(headers['X-Portwing-Signature-Version']).toBe('2');
    expect(headers).not.toHaveProperty('X-Portwing-Audience');
  });

  test('a signature for agent A differs from the same request signed for agent B', () => {
    const options = {
      method: 'GET',
      path: '/x',
      keyId: 'k',
      privateKey: vectorKey,
      now: () => 1_000_000,
      nonce: '0'.repeat(32),
    };
    const forA = signRequest({ ...options, audience: 'agent-a' });
    const forB = signRequest({ ...options, audience: 'agent-b' });
    expect(forA['X-Portwing-Signature']).not.toBe(forB['X-Portwing-Signature']);
  });

  test('isValidAgentId follows the published agent ID rule', () => {
    for (const valid of vectorFile.agentIdRule.valid) expect(isValidAgentId(valid)).toBe(true);
    for (const invalid of vectorFile.agentIdRule.invalid) {
      expect(isValidAgentId(invalid)).toBe(false);
    }
    expect(isValidAgentId(undefined)).toBe(false);
    expect(isValidAgentId(42)).toBe(false);
  });

  test('signRequest refuses an audience outside the agent ID rule', () => {
    expect(() =>
      signRequest({
        method: 'GET',
        path: '/x',
        keyId: 'k',
        privateKey: vectorKey,
        audience: 'Bad_ID',
      }),
    ).toThrow(/agent ID/);
  });
});
