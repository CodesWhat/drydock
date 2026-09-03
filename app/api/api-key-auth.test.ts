/**
 * Tests for API key authentication.
 *
 * The store is real, backed by an in-memory LokiJS database, because the whole
 * point of this authenticator is what it does with a stored digest. Only the
 * audit sink is mocked, so a failure can be observed without asserting on
 * Prometheus internals.
 */
import Loki from 'lokijs';

const { mockRecordApiKeyAuthFailureAuditEvent } = vi.hoisted(() => ({
  mockRecordApiKeyAuthFailureAuditEvent: vi.fn(),
}));

vi.mock('./api-key-audit.js', () => ({
  recordApiKeyAuthFailureAuditEvent: mockRecordApiKeyAuthFailureAuditEvent,
}));

vi.mock('../log/index.js', () => ({
  default: {
    child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() })),
  },
}));

import * as apiKeyStore from '../store/api-key.js';
import {
  _apiKeyAuthFailureSourceCountForTests,
  _resetApiKeyAuthFailureBudgetForTests,
  API_KEY_AUTH_FAILURE_WINDOW_MS,
  API_KEY_AUTH_MAX_FAILURES_PER_SOURCE,
  API_KEY_AUTHENTICATOR_ID,
  apiKeyAuthenticator,
} from './api-key-auth.js';
import type { AuthRequest } from './auth-types.js';
import { isAuthenticationRejection } from './authenticator-chain.js';

type LokiDb = InstanceType<typeof Loki>;

let db: LokiDb;

function request(authorization?: string | string[], ip = '198.51.100.7'): AuthRequest {
  return {
    ip,
    headers: authorization === undefined ? {} : { authorization },
  } as AuthRequest;
}

function mintKey(overrides: Partial<apiKeyStore.CreateApiKeyInput> = {}) {
  return apiKeyStore.createApiKey({
    name: 'dashboard',
    scopes: ['read'],
    createdBy: { kind: 'user', username: 'scott' },
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetApiKeyAuthFailureBudgetForTests();
  db = new Loki('api-key-auth.test.db');
  apiKeyStore.createCollections(db as never);
});

describe('authenticator registration properties', () => {
  test('never persists a session, which is the whole DR-7 mechanism', () => {
    // Structural, not conditional: there is no code path in this module that
    // could write a session even by mistake.
    expect(apiKeyAuthenticator.persistsSession).toBe(false);
  });

  test('does not count toward authentication readiness', () => {
    // A key cannot exist until somebody authenticated to mint it, so a chain
    // holding only this authenticator can never admit a first request and
    // /health must keep failing closed.
    expect(apiKeyAuthenticator.countsTowardReadiness).toBe(false);
  });

  test('has the documented id', () => {
    expect(apiKeyAuthenticator.id).toBe(API_KEY_AUTHENTICATOR_ID);
  });
});

describe('authentication', () => {
  test('resolves a valid credential to an api-key principal', async () => {
    const created = mintKey({ name: 'wud-card', scopes: ['read', 'containers:watch'] });

    const principal = await apiKeyAuthenticator.authenticate(request(`Bearer ${created.apiKey}`));

    expect(principal).toStrictEqual({
      kind: 'api-key',
      username: 'wud-card',
      keyId: created.record.keyId,
      scopes: ['read', 'containers:watch'],
      parentKeyId: null,
    });
  });

  test('carries a per-key rate limit when the key has one', async () => {
    const created = mintKey({ rateLimitMax: 25 });

    const principal = await apiKeyAuthenticator.authenticate(request(`Bearer ${created.apiKey}`));

    expect(principal).toMatchObject({ rateLimitMax: 25 });
  });

  test('omits rateLimitMax entirely when the key has none, so the global limit applies', async () => {
    const created = mintKey();

    const principal = await apiKeyAuthenticator.authenticate(request(`Bearer ${created.apiKey}`));

    expect(principal).not.toHaveProperty('rateLimitMax');
  });

  test('carries parentKeyId for a key minted by another key', async () => {
    const parent = mintKey({ scopes: ['api-keys:manage'] });
    const child = mintKey({
      createdBy: { kind: 'api-key', keyId: parent.record.keyId },
    });

    const principal = await apiKeyAuthenticator.authenticate(request(`Bearer ${child.apiKey}`));

    expect(principal).toMatchObject({ parentKeyId: parent.record.keyId });
  });

  test('hands back a copy of the scopes, so a consumer cannot edit the stored record', async () => {
    const created = mintKey({ scopes: ['read'] });

    const principal = (await apiKeyAuthenticator.authenticate(
      request(`Bearer ${created.apiKey}`),
    )) as { scopes: string[] };
    principal.scopes.push('admin');

    const reread = await apiKeyAuthenticator.authenticate(request(`Bearer ${created.apiKey}`));
    expect(reread).toMatchObject({ scopes: ['read'] });
  });

  test('records usage so lastUsedAt reflects the request', async () => {
    const created = mintKey();

    await apiKeyAuthenticator.authenticate(request(`Bearer ${created.apiKey}`));

    expect(apiKeyStore.findApiKeyById(created.record.keyId)?.lastUsedAt).not.toBeNull();
  });

  test('returns undefined for a credential that is not ours, without touching it', async () => {
    const outcome = await apiKeyAuthenticator.authenticate(
      request('Bearer some-oidc-access-value'),
    );

    expect(outcome).toBeUndefined();
    expect(mockRecordApiKeyAuthFailureAuditEvent).not.toHaveBeenCalled();
  });

  test('returns undefined when no Authorization header is present', async () => {
    await expect(apiKeyAuthenticator.authenticate(request())).resolves.toBeUndefined();
  });
});

describe('owned-prefix failures are terminal and indistinguishable', () => {
  /**
   * Every one of these presents a `ddk_` credential that does not check out.
   * They must produce byte-identical outcomes: a caller who can tell "unknown
   * key" from "wrong secret" can enumerate valid key ids, and a caller who can
   * tell "revoked" from "expired" learns the state of somebody else's key.
   */
  async function outcomeFor(credential: string) {
    return apiKeyAuthenticator.authenticate(request(`Bearer ${credential}`));
  }

  test('a valid-shaped but unknown key is rejected', async () => {
    const unknown = `ddk_${'0'.repeat(12)}_${'A'.repeat(43)}`;
    expect(isAuthenticationRejection(await outcomeFor(unknown))).toBe(true);
  });

  test('a known key with the wrong secret is rejected', async () => {
    const created = mintKey();
    const wrong = `ddk_${created.record.keyId}_${'B'.repeat(43)}`;
    expect(isAuthenticationRejection(await outcomeFor(wrong))).toBe(true);
  });

  test('a revoked key is rejected', async () => {
    const created = mintKey();
    apiKeyStore.revokeApiKey(created.record.keyId, { revokedBy: 'user:scott' });
    expect(isAuthenticationRejection(await outcomeFor(created.apiKey))).toBe(true);
  });

  test('an expired key is rejected', async () => {
    const created = mintKey({ expiresAt: new Date(Date.now() + 60_000).toISOString() });
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 120_000));
    try {
      expect(isAuthenticationRejection(await outcomeFor(created.apiKey))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  test.each([
    ['a truncated credential', 'ddk_abc'],
    ['a non-hex key id', `ddk_${'z'.repeat(12)}_${'A'.repeat(43)}`],
    ['a short secret', `ddk_${'a'.repeat(12)}_short`],
    ['the prefix alone', 'ddk_'],
  ])('%s is rejected rather than passed on', async (_label, credential) => {
    expect(isAuthenticationRejection(await outcomeFor(credential))).toBe(true);
  });

  test('every failure produces the identical rejection value', async () => {
    const created = mintKey();
    const outcomes = [
      await outcomeFor('ddk_malformed'),
      await outcomeFor(`ddk_${'0'.repeat(12)}_${'A'.repeat(43)}`),
      await outcomeFor(`ddk_${created.record.keyId}_${'B'.repeat(43)}`),
    ];

    expect(outcomes[0]).toStrictEqual({ rejected: true, status: 401 });
    expect(outcomes[1]).toStrictEqual(outcomes[0]);
    expect(outcomes[2]).toStrictEqual(outcomes[0]);
  });

  test('a failure is recorded for audit, with the raw credential handed to the sink only', async () => {
    await outcomeFor('ddk_malformed');

    expect(mockRecordApiKeyAuthFailureAuditEvent).toHaveBeenCalledTimes(1);
    expect(mockRecordApiKeyAuthFailureAuditEvent).toHaveBeenCalledWith('ddk_malformed');
  });

  test('a rejected credential never records usage against a real key', async () => {
    const created = mintKey();
    await outcomeFor(`ddk_${created.record.keyId}_${'B'.repeat(43)}`);

    expect(apiKeyStore.findApiKeyById(created.record.keyId)?.lastUsedAt).toBeNull();
  });
});

describe('a chain is only as good as the keys above it', () => {
  test('refuses a live key whose parent was revoked without the cascade reaching it', async () => {
    const root = mintKey({ name: 'root' });
    const child = apiKeyStore.createApiKey({
      name: 'child',
      scopes: ['read'],
      createdBy: { kind: 'api-key', keyId: root.record.keyId },
    });
    // The state a process killed part-way through a cascade leaves behind: the
    // root is revoked on disk and the child is not.
    const stored = db.getCollection('api-keys').findOne({ keyId: root.record.keyId });
    stored.revokedAt = '2026-09-01T00:00:00.000Z';
    db.getCollection('api-keys').update(stored);

    const outcome = await apiKeyAuthenticator.authenticate(
      request(`Bearer ${child.apiKey}`, '203.0.113.30'),
    );

    // Terminal, and identical to every other owned-prefix failure, so nothing
    // behind this authenticator can admit the request on a session cookie.
    expect(isAuthenticationRejection(outcome) && outcome.status).toBe(401);
    expect(mockRecordApiKeyAuthFailureAuditEvent).toHaveBeenCalledWith(child.apiKey);
  });

  test('still accepts a live key under a live parent', async () => {
    const root = mintKey({ name: 'root' });
    const child = apiKeyStore.createApiKey({
      name: 'child',
      scopes: ['read'],
      createdBy: { kind: 'api-key', keyId: root.record.keyId },
    });

    const outcome = await apiKeyAuthenticator.authenticate(
      request(`Bearer ${child.apiKey}`, '203.0.113.31'),
    );

    expect(isAuthenticationRejection(outcome)).toBe(false);
  });
});

describe('the failed-attempt budget', () => {
  const UNKNOWN_CREDENTIAL = `ddk_${'0'.repeat(12)}_${'A'.repeat(43)}`;

  async function failFrom(ip: string) {
    return apiKeyAuthenticator.authenticate(request(`Bearer ${UNKNOWN_CREDENTIAL}`, ip));
  }

  async function statusOfFailureFrom(ip: string) {
    const outcome = await failFrom(ip);
    return isAuthenticationRejection(outcome) ? outcome.status : undefined;
  }

  test('answers 429 once an address has spent its failures', async () => {
    for (let attempt = 0; attempt < API_KEY_AUTH_MAX_FAILURES_PER_SOURCE; attempt += 1) {
      expect(await statusOfFailureFrom('203.0.113.9')).toBe(401);
    }

    expect(await statusOfFailureFrom('203.0.113.9')).toBe(429);
    // Still terminal, so nothing behind this authenticator sees the request.
    expect(await statusOfFailureFrom('203.0.113.9')).toBe(429);
  });

  test('charges failures only, so a working integration is never throttled', async () => {
    const created = mintKey();

    for (let attempt = 0; attempt < API_KEY_AUTH_MAX_FAILURES_PER_SOURCE * 2; attempt += 1) {
      const outcome = await apiKeyAuthenticator.authenticate(
        request(`Bearer ${created.apiKey}`, '203.0.113.10'),
      );
      expect(isAuthenticationRejection(outcome)).toBe(false);
    }

    expect(await statusOfFailureFrom('203.0.113.10')).toBe(401);
  });

  test('budgets one address at a time, so a spray cannot lock out a neighbour', async () => {
    for (let attempt = 0; attempt <= API_KEY_AUTH_MAX_FAILURES_PER_SOURCE; attempt += 1) {
      await failFrom('203.0.113.11');
    }

    expect(await statusOfFailureFrom('203.0.113.12')).toBe(401);
  });

  test('groups an IPv6 subnet, which is otherwise a free supply of addresses', async () => {
    for (let attempt = 0; attempt < API_KEY_AUTH_MAX_FAILURES_PER_SOURCE; attempt += 1) {
      expect(await statusOfFailureFrom(`2001:db8::${attempt.toString(16)}`)).toBe(401);
    }

    expect(await statusOfFailureFrom('2001:db8::ffff')).toBe(429);
  });

  test('refills on the next window', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-09-02T12:00:00.000Z'));
      for (let attempt = 0; attempt <= API_KEY_AUTH_MAX_FAILURES_PER_SOURCE; attempt += 1) {
        await failFrom('203.0.113.13');
      }
      expect(await statusOfFailureFrom('203.0.113.13')).toBe(429);

      vi.advanceTimersByTime(API_KEY_AUTH_FAILURE_WINDOW_MS);
      expect(await statusOfFailureFrom('203.0.113.13')).toBe(401);
    } finally {
      vi.useRealTimers();
    }
  });

  test('frees expired windows before it evicts a live one', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-09-02T12:00:00.000Z'));
      for (let index = 0; index < 1000; index += 1) {
        await failFrom(`10.${Math.floor(index / 256)}.${index % 256}.1`);
      }
      expect(_apiKeyAuthFailureSourceCountForTests()).toBe(1000);

      vi.advanceTimersByTime(API_KEY_AUTH_FAILURE_WINDOW_MS);
      await failFrom('192.0.2.1');

      expect(_apiKeyAuthFailureSourceCountForTests()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test.each([
    [
      'the socket address when the request has no resolved ip',
      { socket: { remoteAddress: '203.0.113.20' } },
    ],
    ['one shared bucket when the address cannot be discovered at all', {}],
  ])('falls back to %s', async (_label, overrides) => {
    const failWithout = async () =>
      apiKeyAuthenticator.authenticate({
        headers: { authorization: `Bearer ${UNKNOWN_CREDENTIAL}` },
        ...overrides,
      } as AuthRequest);

    for (let attempt = 0; attempt < API_KEY_AUTH_MAX_FAILURES_PER_SOURCE; attempt += 1) {
      await failWithout();
    }
    const outcome = await failWithout();

    expect(isAuthenticationRejection(outcome) && outcome.status).toBe(429);
  });

  test('bounds the tracked addresses, so the budget map is not the memory a spray exhausts', async () => {
    // Every address distinct and every entry fresh, which is the shape a sweep
    // of expired windows cannot free: the cap has to evict.
    for (let index = 0; index < 1200; index += 1) {
      await failFrom(`10.${Math.floor(index / 256)}.${index % 256}.1`);
    }

    expect(_apiKeyAuthFailureSourceCountForTests()).toBe(1000);
  });
});
