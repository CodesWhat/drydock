/**
 * Tests for the bucket the pre-authentication API limiter charges.
 *
 * The store is mocked to the one call this module makes, because what is being
 * pinned is which requests get their own bucket, not how a key is stored. The
 * end-to-end proof that an unknown id and a known id with a wrong secret are
 * indistinguishable from outside lives in `api-key-enforcement.integration.test.ts`,
 * against a real store and real RateLimit headers.
 */
import type { Request } from 'express';
import type { AuthenticatedPrincipal } from './principal.js';

const { mockVerifyApiKey } = vi.hoisted(() => ({ mockVerifyApiKey: vi.fn(() => null) }));

vi.mock('../store/api-key.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../store/api-key.js')>()),
  verifyApiKey: mockVerifyApiKey,
}));

import { createOuterApiRateLimitKeyGenerator } from './outer-api-rate-limit-key.js';

function createRequest(
  overrides: Partial<
    Request & {
      sessionID?: unknown;
      principal?: AuthenticatedPrincipal;
    }
  >,
): Request {
  return {
    ip: '198.51.100.7',
    ...overrides,
  } as Request;
}

describe('the pre-authentication API limiter bucket', () => {
  const KEY_ID = 'a1b2c3d4e5f6';
  const CREDENTIAL = `ddk_${KEY_ID}_${'A'.repeat(43)}`;
  const WRONG_SECRET_CREDENTIAL = `ddk_${KEY_ID}_${'B'.repeat(43)}`;
  const UNKNOWN_ID_CREDENTIAL = `ddk_ffffffffffff_${'A'.repeat(43)}`;
  const IP_BUCKET = 'ip:198.51.100.7';

  function keyFor(
    authorization: string | undefined,
    { identityAware = false, overrides = {} } = {},
  ): string {
    const generator = createOuterApiRateLimitKeyGenerator(identityAware);
    return generator(
      createRequest({
        ...(authorization === undefined ? {} : { headers: { authorization } }),
        ...overrides,
      }),
    ) as string;
  }

  beforeEach(() => {
    mockVerifyApiKey.mockReset();
    mockVerifyApiKey.mockReturnValue(null);
  });

  test('is the client address when no key is presented', () => {
    expect(keyFor(undefined)).toBe(IP_BUCKET);
    expect(mockVerifyApiKey).not.toHaveBeenCalled();
  });

  test('splits a key onto its own bucket, so one NAT is not one budget', () => {
    mockVerifyApiKey.mockReturnValue({ keyId: KEY_ID } as never);

    expect(keyFor(`Bearer ${CREDENTIAL}`)).toBe(`${IP_BUCKET}|apikey:${KEY_ID}`);
    // The whole credential, not the id: the bucket is only split for a caller
    // that already holds the secret.
    expect(mockVerifyApiKey).toHaveBeenCalledWith(CREDENTIAL);
  });

  test('uses the id the store returned, never the one the header asked for', () => {
    // Belt and braces on the same point: nothing attacker-supplied reaches the
    // bucket string.
    mockVerifyApiKey.mockReturnValue({ keyId: 'deadbeef0001' } as never);

    expect(keyFor(`Bearer ${CREDENTIAL}`)).toBe(`${IP_BUCKET}|apikey:deadbeef0001`);
  });

  test.each([
    ['an id this instance never issued', UNKNOWN_ID_CREDENTIAL],
    ['a known id presented with the wrong secret', WRONG_SECRET_CREDENTIAL],
    ['a real credential that has been revoked or has expired', CREDENTIAL],
  ])('keeps the address bucket for %s', (_label, authorization) => {
    // All three are `verifyApiKey` returning null, and all three have to land
    // in the same bucket: any difference is readable from outside as an
    // existence oracle on key ids.
    expect(keyFor(`Bearer ${authorization}`)).toBe(IP_BUCKET);
  });

  test('gives an unknown id and a known id with a wrong secret the same bucket', () => {
    expect(keyFor(`Bearer ${UNKNOWN_ID_CREDENTIAL}`)).toBe(
      keyFor(`Bearer ${WRONG_SECRET_CREDENTIAL}`),
    );
  });

  test.each([
    ['a Basic credential', 'Basic dXNlcjpwYXNz'],
    ['a non-key bearer', 'Bearer eyJhbGciOiJSUzI1NiJ9.payload.sig'],
    ['a header with no scheme', 'ddk_bare_value_with_no_scheme'],
  ])('never reaches the store for %s', (_label, authorization) => {
    // The prefix is this authenticator's alone, so a credential belonging to
    // another scheme is not looked up, hashed or logged here either.
    expect(keyFor(authorization)).toBe(IP_BUCKET);
    expect(mockVerifyApiKey).not.toHaveBeenCalled();
  });

  test('keeps the address bucket for a truncated key', () => {
    expect(keyFor('Bearer ddk_short')).toBe(IP_BUCKET);
  });

  test('keeps identity keying underneath it when that is enabled', () => {
    mockVerifyApiKey.mockReturnValue({ keyId: KEY_ID } as never);
    const sessionBucket = keyFor(undefined, {
      identityAware: true,
      overrides: { principal: { kind: 'session', username: 'scott' }, sessionID: 'sid-1' },
    });

    expect(sessionBucket).toBe('session:sid-1');
  });
});
