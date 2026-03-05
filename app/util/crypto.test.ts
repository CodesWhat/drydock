import { describe, expect, test } from 'vitest';
import { hashToken } from './crypto.js';

describe('hashToken', () => {
  test('returns a SHA-256 digest for a token', () => {
    expect(hashToken('drydock-sse-token').toString('hex')).toBe(
      'd16a2d208b57875b7a84fec28a1a7256938189476404e41443c1be1d9dc26995',
    );
  });

  test('returns a fixed-length digest buffer', () => {
    expect(hashToken('').byteLength).toBe(32);
  });
});
