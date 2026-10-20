const { mockListApiKeys } = vi.hoisted(() => ({ mockListApiKeys: vi.fn() }));

vi.mock('../store/api-key.js', () => ({
  listApiKeys: mockListApiKeys,
  isApiKeyExpired: (record: { expiresAt: string | null }, now: Date = new Date()) =>
    record.expiresAt !== null && Date.parse(record.expiresAt) <= now.getTime(),
}));

import {
  acknowledgeApiKeyReview,
  flagApiKeyReviewIfNeeded,
  isApiKeyReviewPending,
} from './api-key-review.js';
import type { AuthRequest } from './auth-types.js';

const PAST = '2000-01-01T00:00:00.000Z';
const FUTURE = '2999-01-01T00:00:00.000Z';

function key(overrides: Record<string, unknown> = {}) {
  return { keyId: 'a'.repeat(12), revokedAt: null, expiresAt: null, ...overrides };
}

function request(overrides: Record<string, unknown> = {}): AuthRequest {
  return { session: {}, principal: { kind: 'session', username: 'scott' }, ...overrides } as never;
}

function response() {
  return {
    set: vi.fn().mockReturnThis(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockListApiKeys.mockReturnValue([]);
});

describe('flagApiKeyReviewIfNeeded', () => {
  test.each([
    ['a never-expiring key', [key()]],
    ['an unexpired key', [key({ expiresAt: FUTURE })]],
    ['an active key among dead ones', [key({ revokedAt: PAST }), key({ expiresAt: PAST }), key()]],
  ])('flags the session for %s', (_name, keys) => {
    mockListApiKeys.mockReturnValue(keys);
    const req = request();
    flagApiKeyReviewIfNeeded(req);
    expect(req.session?.apiKeyReviewPending).toBe(true);
  });

  test.each([
    ['no keys', []],
    ['only revoked keys', [key({ revokedAt: PAST })]],
    ['only expired keys', [key({ expiresAt: PAST })]],
  ])('leaves the session alone for %s', (_name, keys) => {
    mockListApiKeys.mockReturnValue(keys);
    const req = request();
    flagApiKeyReviewIfNeeded(req);
    expect(req.session?.apiKeyReviewPending).toBeUndefined();
  });

  test('does nothing without a session', () => {
    mockListApiKeys.mockReturnValue([key()]);
    expect(() => flagApiKeyReviewIfNeeded(request({ session: undefined }))).not.toThrow();
  });
});

describe('isApiKeyReviewPending', () => {
  test('is true for a flagged session', () => {
    expect(isApiKeyReviewPending(request({ session: { apiKeyReviewPending: true } }))).toBe(true);
  });

  test('is false for an unflagged session or no session', () => {
    expect(isApiKeyReviewPending(request())).toBe(false);
    expect(isApiKeyReviewPending(request({ session: undefined }))).toBe(false);
  });

  test('is false for a key caller even with a flagged cookie riding along', () => {
    const req = request({
      principal: { kind: 'api-key', username: 'ci', keyId: 'a'.repeat(12), scopes: [] },
      session: { apiKeyReviewPending: true },
    });
    expect(isApiKeyReviewPending(req)).toBe(false);
  });
});

describe('acknowledgeApiKeyReview', () => {
  test('clears the flag and answers 200', () => {
    const req = request({ session: { apiKeyReviewPending: true } });
    const res = response();
    acknowledgeApiKeyReview(req, res as never);
    expect(req.session?.apiKeyReviewPending).toBeUndefined();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ apiKeyReviewPending: false });
  });

  test('is idempotent on an unflagged session and tolerates a missing one', () => {
    const res = response();
    acknowledgeApiKeyReview(request(), res as never);
    acknowledgeApiKeyReview(request({ session: undefined }), res as never);
    expect(res.status).toHaveBeenCalledTimes(2);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test.each([
    ['an API key', { kind: 'api-key', username: 'ci', keyId: 'a'.repeat(12), scopes: ['admin'] }],
    ['anonymous access', { kind: 'anonymous', username: 'anonymous' }],
    ['no principal', undefined],
  ])('refuses %s with 403 and leaves the flag', (_name, principal) => {
    const req = request({ principal, session: { apiKeyReviewPending: true } });
    const res = response();
    acknowledgeApiKeyReview(req, res as never);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(req.session?.apiKeyReviewPending).toBe(true);
  });
});
