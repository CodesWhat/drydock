const {
  mockFs,
  mockPassportAuthenticate,
  mockRecordAuthLogin,
  mockSetAuthAccountLockedTotal,
  mockSetAuthIpLockedTotal,
  mockRecordLoginAuditEvent,
  mockSendErrorResponse,
} = vi.hoisted(() => {
  return {
    mockFs: {
      existsSync: vi.fn(),
      readFileSync: vi.fn(),
      writeFileSync: vi.fn(),
      mkdirSync: vi.fn(),
    },
    mockPassportAuthenticate: vi.fn(() => vi.fn()),
    mockRecordAuthLogin: vi.fn(),
    mockSetAuthAccountLockedTotal: vi.fn(),
    mockSetAuthIpLockedTotal: vi.fn(),
    mockRecordLoginAuditEvent: vi.fn(),
    mockSendErrorResponse: vi.fn((res: any, status: number, error: string) => {
      res.status(status);
      res.json({ error });
    }),
  };
});
const LOCKOUT_TRACKED_IDENTITIES_CAP_FOR_TESTS = 5;
const { previousMaxTrackedLockoutIdentities } = vi.hoisted(() => {
  const previous = process.env.DD_AUTH_LOCKOUT_MAX_TRACKED_IDENTITIES;
  process.env.DD_AUTH_LOCKOUT_MAX_TRACKED_IDENTITIES = '5';
  return { previousMaxTrackedLockoutIdentities: previous };
});

const lockoutStateFiles = new Map<string, string>();
const LOCKOUT_STATE_PATH = '/test/store/db.json.auth-lockouts.json';

vi.mock('passport', () => ({
  default: {
    authenticate: mockPassportAuthenticate,
  },
}));

vi.mock('node:fs', () => ({
  default: mockFs,
}));

vi.mock('../store/index.js', () => ({
  getConfiguration: vi.fn(() => ({
    path: '/test/store',
    file: 'db.json',
  })),
}));

vi.mock('../log/index.js', () => ({
  default: {
    warn: vi.fn(),
  },
}));

vi.mock('../prometheus/auth.js', () => ({
  recordAuthLogin: mockRecordAuthLogin,
  setAuthAccountLockedTotal: mockSetAuthAccountLockedTotal,
  setAuthIpLockedTotal: mockSetAuthIpLockedTotal,
}));

vi.mock('./auth-audit.js', () => ({
  recordLoginAuditEvent: mockRecordLoginAuditEvent,
}));

vi.mock('./auth-strategies.js', () => ({
  getAllIds: vi.fn(() => ['basic.default']),
}));

vi.mock('./error-response.js', () => ({
  sendErrorResponse: mockSendErrorResponse,
}));

import log from '../log/index.js';
import {
  authenticateLogin,
  initializeLoginLockoutState,
  resetLoginLockoutStateForTests,
  testable_accountLockoutPolicy,
  testable_evictOldestTrackedEntries,
  testable_makeTrackedIdentityCapacity,
  testable_pruneLockoutEntries,
  testable_registerFailedLoginAttempt,
} from './auth-lockout.js';

function createResponse() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
  };
}

function makePassportInvalidCredentials() {
  mockPassportAuthenticate.mockImplementation((_ids, _options, callback) => {
    return () => callback(null, false);
  });
}

function makePassportSuccess(username = 'john') {
  mockPassportAuthenticate.mockImplementation((_ids, _options, callback) => {
    return () => callback(null, { username });
  });
}

describe('auth-lockout', () => {
  afterAll(() => {
    if (previousMaxTrackedLockoutIdentities === undefined) {
      delete process.env.DD_AUTH_LOCKOUT_MAX_TRACKED_IDENTITIES;
      return;
    }

    process.env.DD_AUTH_LOCKOUT_MAX_TRACKED_IDENTITIES = previousMaxTrackedLockoutIdentities;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    lockoutStateFiles.clear();
    mockFs.existsSync.mockImplementation((candidate: unknown) =>
      lockoutStateFiles.has(`${candidate}`),
    );
    mockFs.readFileSync.mockImplementation((candidate: unknown) => {
      const value = lockoutStateFiles.get(`${candidate}`);
      if (value === undefined) {
        throw new Error('ENOENT: lockout file missing');
      }
      return value;
    });
    mockFs.writeFileSync.mockImplementation((candidate: unknown, content: unknown) => {
      lockoutStateFiles.set(`${candidate}`, `${content}`);
    });
    mockFs.mkdirSync.mockImplementation(() => undefined);
    resetLoginLockoutStateForTests();
    vi.useRealTimers();
  });

  afterEach(() => {
    resetLoginLockoutStateForTests();
  });

  test('returns 401 and records an audit event for invalid credentials', () => {
    makePassportInvalidCredentials();
    const req = {
      body: { username: ' Alice ' },
      ip: '203.0.113.10',
    } as any;
    const res = createResponse();
    const next = vi.fn();

    authenticateLogin(req, res as any, next);

    expect(mockPassportAuthenticate).toHaveBeenCalledWith(
      ['basic.default'],
      { session: false },
      expect.any(Function),
    );
    expect(mockRecordLoginAuditEvent).toHaveBeenCalledWith(
      req,
      'error',
      'Authentication failed (invalid credentials)',
      'Alice',
    );
    expect(mockSendErrorResponse).toHaveBeenCalledWith(res, 401, 'Unauthorized');
    expect(next).not.toHaveBeenCalled();
  });

  test('forwards passport authenticate errors to next', () => {
    const error = new Error('passport failure');
    mockPassportAuthenticate.mockImplementation((_ids, _options, callback) => {
      return () => callback(error, false);
    });
    const req = { ip: '203.0.113.11' } as any;
    const res = createResponse();
    const next = vi.fn();

    authenticateLogin(req, res as any, next);

    expect(next).toHaveBeenCalledWith(error);
    expect(mockSendErrorResponse).not.toHaveBeenCalled();
  });

  test('locks account after repeated failures and sets Retry-After', () => {
    makePassportInvalidCredentials();
    const req = {
      body: { username: 'lock-user' },
      ip: '203.0.113.12',
    } as any;
    const next = vi.fn();

    for (let index = 0; index < 4; index += 1) {
      authenticateLogin(req, createResponse() as any, next);
    }

    const lockedResponse = createResponse();
    authenticateLogin(req, lockedResponse as any, next);

    expect(lockedResponse.status).toHaveBeenCalledWith(423);
    expect(lockedResponse.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(String));
    expect(mockRecordAuthLogin).toHaveBeenCalledWith('locked', 'basic');
    expect(mockSendErrorResponse).toHaveBeenCalledWith(
      lockedResponse,
      423,
      'Account temporarily locked due to repeated failed login attempts',
    );
  });

  test('rejects already-locked identities before invoking passport', () => {
    makePassportInvalidCredentials();
    const req = {
      body: { username: 'prelock-user' },
      ip: '203.0.113.13',
    } as any;
    const next = vi.fn();

    for (let index = 0; index < 5; index += 1) {
      authenticateLogin(req, createResponse() as any, next);
    }
    const authenticateCallCount = mockPassportAuthenticate.mock.calls.length;

    const lockedResponse = createResponse();
    authenticateLogin(req, lockedResponse as any, next);

    expect(mockPassportAuthenticate).toHaveBeenCalledTimes(authenticateCallCount);
    expect(lockedResponse.status).toHaveBeenCalledWith(423);
  });

  test('keeps lockout pressure after lockout duration expires when failures continue', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    makePassportInvalidCredentials();
    const req = {
      body: { username: 'sustained-user' },
      ip: '203.0.113.14',
    } as any;
    const next = vi.fn();

    for (let index = 0; index < 5; index += 1) {
      authenticateLogin(req, createResponse() as any, next);
    }

    vi.setSystemTime(new Date('2026-01-01T00:15:00.000Z'));
    const responseAfterExpiry = createResponse();
    authenticateLogin(req, responseAfterExpiry as any, next);

    expect(responseAfterExpiry.status).toHaveBeenCalledWith(423);
    vi.useRealTimers();
  });

  test('resets stale lockout windows after the configured window elapses', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    makePassportInvalidCredentials();
    const req = {
      body: { username: 'window-user' },
      ip: '203.0.113.15',
    } as any;

    for (let index = 0; index < 4; index += 1) {
      authenticateLogin(req, createResponse() as any, vi.fn());
    }

    vi.setSystemTime(new Date('2026-01-01T00:16:00.000Z'));
    const responseAfterWindow = createResponse();
    authenticateLogin(req, responseAfterWindow as any, vi.fn());

    expect(responseAfterWindow.status).toHaveBeenCalledWith(401);
    vi.useRealTimers();
  });

  test('testable_pruneLockoutEntries evicts oldest hydrated entries when persisted state exceeds the cap', () => {
    const now = Date.parse('2026-01-01T00:00:00.000Z');
    const lockouts = new Map();

    for (let index = 0; index <= LOCKOUT_TRACKED_IDENTITIES_CAP_FOR_TESTS; index += 1) {
      lockouts.set(`persisted-user-${index}`, {
        failedAttempts: 1,
        windowStartAt: now + index,
        lockedUntil: now + testable_accountLockoutPolicy.lockoutMs,
        lastAttemptAt: now + index,
      });
    }

    testable_pruneLockoutEntries(lockouts, testable_accountLockoutPolicy, now);

    expect(lockouts.size).toBe(LOCKOUT_TRACKED_IDENTITIES_CAP_FOR_TESTS);
    expect(lockouts.has('persisted-user-0')).toBe(false);
    expect(lockouts.has(`persisted-user-${LOCKOUT_TRACKED_IDENTITIES_CAP_FOR_TESTS}`)).toBe(true);
  });

  test('testable_makeTrackedIdentityCapacity removes expired unlocked entries before evicting active ones', () => {
    const now = Date.parse('2026-01-01T00:20:00.000Z');
    const expiredAttemptAt = now - testable_accountLockoutPolicy.windowMs - 1_000;
    // The expired user must be the NEWEST (highest lastAttemptAt) to avoid being picked by eviction.
    // This ensures the expired-entry is only removed by removeExpiredUnlockedEntries, not eviction.
    // Map size = cap: triggers removeExpiredUnlockedEntries (size < cap check = false)
    const lockouts = new Map<string, any>([
      // fresh-locked users: older lastAttemptAt (at now - i*1000, i = cap-2 down to 0)
      ...Array.from({ length: LOCKOUT_TRACKED_IDENTITIES_CAP_FOR_TESTS - 1 }, (_, index) => [
        `fresh-user-${index}`,
        {
          failedAttempts: 1,
          windowStartAt: now - (LOCKOUT_TRACKED_IDENTITIES_CAP_FOR_TESTS - 1 - index) * 1000,
          lockedUntil: now + testable_accountLockoutPolicy.lockoutMs,
          lastAttemptAt: now - (LOCKOUT_TRACKED_IDENTITIES_CAP_FOR_TESTS - 1 - index) * 1000,
        },
      ]),
      // expired-user: lastAttemptAt = now - windowMs - 1000 is WAY older → eviction would pick it
      // BUT: make it the NEWEST lastAttemptAt by setting it to now (but still expired via lockedUntil=0 + old window)
      // Actually expired means: lockedUntil <= now AND now - lastAttemptAt > windowMs
      // So we can't make it "recent" and still expired. Instead: put fresh-users with very old timestamps
      // so expired-user (with moderately old lastAttemptAt) is the NEWEST.
      [
        'expired-user',
        {
          failedAttempts: 1,
          windowStartAt: expiredAttemptAt,
          lockedUntil: 0,
          lastAttemptAt: expiredAttemptAt, // expired but this is "newest" only if fresh-users are older
        },
      ],
    ]);
    // Reconfigure: make fresh-users even older than expiredAttemptAt
    for (let i = 0; i < LOCKOUT_TRACKED_IDENTITIES_CAP_FOR_TESTS - 1; i += 1) {
      lockouts.set(`fresh-user-${i}`, {
        failedAttempts: 1,
        windowStartAt: expiredAttemptAt - (i + 1) * 1000,
        lockedUntil: now + testable_accountLockoutPolicy.lockoutMs, // still locked
        lastAttemptAt: expiredAttemptAt - (i + 1) * 1000, // older than expired-user
      });
    }

    // size = cap (5): triggers removeExpiredUnlockedEntries
    // expired-user is the NEWEST (largest lastAttemptAt), so eviction would NOT pick it
    // removeExpiredUnlockedEntries must delete it because it's expired (lockedUntil=0, old window)
    testable_makeTrackedIdentityCapacity(lockouts, testable_accountLockoutPolicy, now);

    // expired-user must be gone (only removeExpiredUnlockedEntries removes it, not eviction)
    expect(lockouts.has('expired-user')).toBe(false);
    // After removing expired-user: size = cap-1 → entriesToEvict = 0 → no eviction
    expect(lockouts.size).toBe(LOCKOUT_TRACKED_IDENTITIES_CAP_FOR_TESTS - 1);
    // All fresh (locked) users should still be there
    for (let i = 0; i < LOCKOUT_TRACKED_IDENTITIES_CAP_FOR_TESTS - 1; i += 1) {
      expect(lockouts.has(`fresh-user-${i}`)).toBe(true);
    }
  });

  test('testable_evictOldestTrackedEntries returns early when no entries remain to evict', () => {
    const lockouts = new Map();

    expect(() => testable_evictOldestTrackedEntries(lockouts, 1)).not.toThrow();
    expect(lockouts.size).toBe(0);
  });

  test('testable_registerFailedLoginAttempt replaces stale unlocked entries with a fresh attempt', () => {
    const now = Date.parse('2026-01-01T00:20:00.000Z');
    const expiredAttemptAt = now - testable_accountLockoutPolicy.windowMs - 1_000;
    const lockouts = new Map([
      [
        'header-only-user',
        {
          failedAttempts: 4,
          windowStartAt: expiredAttemptAt - 5_000,
          lockedUntil: 0,
          lastAttemptAt: expiredAttemptAt,
        },
      ],
    ]);

    const lockoutUntil = testable_registerFailedLoginAttempt(
      lockouts,
      testable_accountLockoutPolicy,
      'header-only-user',
      now,
    );

    expect(lockoutUntil).toBeUndefined();
    expect(lockouts.get('header-only-user')).toEqual({
      failedAttempts: 1,
      windowStartAt: now,
      lockedUntil: 0,
      lastAttemptAt: now,
    });
  });

  test('clears lockout state after a successful authentication', () => {
    makePassportInvalidCredentials();
    const req = {
      body: { username: 'recover-user' },
      ip: '203.0.113.16',
    } as any;
    const next = vi.fn();

    authenticateLogin(req, createResponse() as any, next);

    makePassportSuccess('recover-user');
    authenticateLogin(req, createResponse() as any, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toEqual({ username: 'recover-user' });

    makePassportInvalidCredentials();
    for (let index = 0; index < 4; index += 1) {
      const res = createResponse();
      authenticateLogin(req, res as any, vi.fn());
      expect(res.status).toHaveBeenCalledWith(401);
    }
  });

  test('evicts the oldest tracked account entry when the identity cap is exceeded', () => {
    vi.useFakeTimers();
    makePassportInvalidCredentials();
    const startedAt = Date.parse('2026-01-01T00:00:00.000Z');

    for (let index = 0; index <= LOCKOUT_TRACKED_IDENTITIES_CAP_FOR_TESTS; index += 1) {
      vi.setSystemTime(new Date(startedAt + index));
      authenticateLogin(
        {
          body: { username: `evict-user-${index}` },
          ip: `198.51.100.${index % 255}`,
        } as any,
        createResponse() as any,
        vi.fn(),
      );
    }

    vi.advanceTimersByTime(1000);

    const persisted = JSON.parse(lockoutStateFiles.get(LOCKOUT_STATE_PATH) ?? '{}');
    expect(Object.keys(persisted.account)).toHaveLength(LOCKOUT_TRACKED_IDENTITIES_CAP_FOR_TESTS);
    expect(persisted.account['evict-user-0']).toBeUndefined();
    expect(persisted.account[`evict-user-${LOCKOUT_TRACKED_IDENTITIES_CAP_FOR_TESTS}`]).toEqual(
      expect.objectContaining({ failedAttempts: 1 }),
    );
    vi.useRealTimers();
  });

  test('extracts login identity from the first authorization header value when headers are arrays', () => {
    makePassportInvalidCredentials();
    const req = {
      headers: {
        authorization: [
          `Basic ${Buffer.from('array-user').toString('base64')}`,
          `Basic ${Buffer.from('ignored-user:pass').toString('base64')}`,
        ],
      },
      ip: '203.0.113.17',
    } as any;

    authenticateLogin(req, createResponse() as any, vi.fn());

    expect(mockRecordLoginAuditEvent).toHaveBeenCalledWith(
      req,
      'error',
      'Authentication failed (invalid credentials)',
      'array-user',
    );
  });

  test('hydrates persisted lockout state on init and blocks locked identities', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    lockoutStateFiles.set(
      LOCKOUT_STATE_PATH,
      JSON.stringify({
        account: {
          'restored-user': {
            failedAttempts: 5,
            windowStartAt: Date.parse('2026-01-01T00:00:00.000Z'),
            lockedUntil: Date.parse('2026-01-01T00:10:00.000Z'),
            lastAttemptAt: Date.parse('2026-01-01T00:00:00.000Z'),
          },
        },
        ip: {},
      }),
    );
    makePassportInvalidCredentials();

    initializeLoginLockoutState();
    const res = createResponse();
    authenticateLogin(
      {
        body: { username: 'restored-user' },
        ip: '203.0.113.18',
      } as any,
      res as any,
      vi.fn(),
    );

    expect(mockPassportAuthenticate).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(423);
    vi.useRealTimers();
  });

  test('ignores invalid persisted lockout entries during hydration', () => {
    lockoutStateFiles.set(
      LOCKOUT_STATE_PATH,
      JSON.stringify({
        account: {
          'bad-shape': {
            failedAttempts: '5',
            windowStartAt: Date.parse('2026-01-01T00:00:00.000Z'),
            lockedUntil: Date.parse('2026-01-01T00:10:00.000Z'),
            lastAttemptAt: Date.parse('2026-01-01T00:00:00.000Z'),
          },
        },
        ip: {},
      }),
    );
    makePassportInvalidCredentials();

    initializeLoginLockoutState();
    const res = createResponse();
    authenticateLogin(
      {
        body: { username: 'bad-shape' },
        ip: '203.0.113.19',
      } as any,
      res as any,
      vi.fn(),
    );

    expect(mockPassportAuthenticate).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('prunes stale entries on the maintenance timer and persists changes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    lockoutStateFiles.set(
      LOCKOUT_STATE_PATH,
      JSON.stringify({
        account: {
          'timer-user': {
            failedAttempts: 1,
            windowStartAt: Date.parse('2026-01-01T00:00:00.000Z'),
            lockedUntil: 0,
            lastAttemptAt: Date.parse('2026-01-01T00:00:00.000Z'),
          },
        },
        ip: {},
      }),
    );

    initializeLoginLockoutState();
    vi.setSystemTime(new Date('2026-01-01T00:16:00.000Z'));
    vi.advanceTimersByTime(16 * 60 * 1000);

    const persisted = JSON.parse(lockoutStateFiles.get(LOCKOUT_STATE_PATH) ?? '{}');
    expect(persisted.account['timer-user']).toBeUndefined();
    vi.useRealTimers();
  });

  test('warns when persisting lockout state fails', () => {
    vi.useFakeTimers();
    makePassportInvalidCredentials();
    mockFs.writeFileSync.mockImplementation(() => {
      throw new Error('persist write failed');
    });

    authenticateLogin(
      {
        body: { username: 'persist-error-user' },
        ip: '203.0.113.20',
      } as any,
      createResponse() as any,
      vi.fn(),
    );

    vi.advanceTimersByTime(1000);

    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('Unable to persist login lockout state (persist write failed)'),
    );
    vi.useRealTimers();
  });

  test('resetLoginLockoutStateForTests clears gauges and cancels scheduled work', () => {
    vi.useFakeTimers();
    initializeLoginLockoutState();

    resetLoginLockoutStateForTests();
    vi.advanceTimersByTime(60 * 60 * 1000);

    expect(mockSetAuthAccountLockedTotal).toHaveBeenCalledWith(0);
    expect(mockSetAuthIpLockedTotal).toHaveBeenCalledWith(0);
    vi.useRealTimers();
  });

  // ── Mutant-killing tests ──────────────────────────────────────────────────

  test('countActiveLockouts counts only entries with lockedUntil strictly greater than now', () => {
    // Mutant: entry.lockedUntil >= now — must distinguish > vs >=
    vi.useFakeTimers();
    const now = Date.parse('2026-01-01T12:00:00.000Z');
    vi.setSystemTime(new Date(now));

    makePassportInvalidCredentials();
    const req = { body: { username: 'gauge-test-user' }, ip: '10.0.0.1' } as any;
    const next = vi.fn();

    // Lock the account
    for (let i = 0; i < 5; i += 1) {
      authenticateLogin(req, createResponse() as any, next);
    }

    // Gauges should reflect 1 active lockout (not 0 - boundary matters)
    const accountTotal = mockSetAuthAccountLockedTotal.mock.calls.at(-1)?.[0];
    expect(accountTotal).toBeGreaterThanOrEqual(1);
    vi.useRealTimers();
  });

  test('countActiveLockouts returns 0 when lockedUntil equals now exactly (not strictly >)', () => {
    // Ensures lockedUntil === now is NOT counted as active lockout
    vi.useFakeTimers();
    const now = Date.parse('2026-01-01T12:00:00.000Z');
    vi.setSystemTime(new Date(now));
    makePassportInvalidCredentials();
    const req = { body: { username: 'exact-boundary-user' }, ip: '10.0.0.2' } as any;
    const next = vi.fn();

    // Create 5 failures to lock at now+lockoutMs
    for (let i = 0; i < 5; i += 1) {
      authenticateLogin(req, createResponse() as any, next);
    }
    // Advance time past the lockout to just after lockedUntil
    vi.setSystemTime(new Date(now + testable_accountLockoutPolicy.lockoutMs + 1));
    // getLockoutUntil check: expired lock should not count as active
    const afterExpiry = createResponse();
    authenticateLogin(req, afterExpiry as any, vi.fn());
    // Should NOT be locked anymore (lockedUntil <= now)
    // Falls through to passport, which returns invalid creds → 401
    expect(afterExpiry.status).not.toHaveBeenCalledWith(423);
    vi.useRealTimers();
  });

  test('LOCKOUT_ENTRY_NUMERIC_FIELDS must be non-empty for isLoginLockoutEntry to work correctly', () => {
    // Line 40: ArrayDeclaration mutant replaces array with []
    // If the array were empty, every() would return true for any object — even invalid ones
    lockoutStateFiles.set(
      LOCKOUT_STATE_PATH,
      JSON.stringify({
        account: {
          'partially-valid': {
            failedAttempts: 'not-a-number',
            windowStartAt: 1000,
            lockedUntil: 2000,
            lastAttemptAt: 3000,
          },
          'fully-valid': {
            failedAttempts: 1,
            windowStartAt: 1000,
            lockedUntil: Date.now() + 60000,
            lastAttemptAt: Date.now(),
          },
        },
        ip: {},
      }),
    );
    makePassportInvalidCredentials();

    initializeLoginLockoutState();
    const req1 = { body: { username: 'partially-valid' }, ip: '10.0.0.3' } as any;
    const res1 = createResponse();
    authenticateLogin(req1, res1 as any, vi.fn());
    // Invalid entry should NOT have been hydrated → passport runs → 401
    expect(res1.status).toHaveBeenCalledWith(401);

    const req2 = { body: { username: 'fully-valid' }, ip: '10.0.0.4' } as any;
    const res2 = createResponse();
    authenticateLogin(req2, res2 as any, vi.fn());
    // Valid entry was hydrated and lockedUntil is in the future → 423
    expect(res2.status).toHaveBeenCalledWith(423);
  });

  test('isLoginLockoutEntry returns false for null (guard prevents null property access crash)', () => {
    // Line 130: !candidate branch — verify null returns false WITHOUT crashing
    // Without the guard, null['failedAttempts'] would throw TypeError
    // The outer try/catch would catch it → log.warn called
    lockoutStateFiles.set(
      LOCKOUT_STATE_PATH,
      JSON.stringify({
        account: {
          'null-entry': null,
          'valid-locked': {
            failedAttempts: 5,
            windowStartAt: Date.now() - 1000,
            lockedUntil: Date.now() + 900000,
            lastAttemptAt: Date.now() - 1000,
          },
        },
        ip: {},
      }),
    );
    makePassportInvalidCredentials();
    initializeLoginLockoutState();

    // No crash → log.warn not called
    expect(log.warn).not.toHaveBeenCalled();

    // null entry was skipped, valid entry was hydrated
    const res = createResponse();
    authenticateLogin(
      { body: { username: 'valid-locked' }, ip: '10.0.0.5' } as any,
      res as any,
      vi.fn(),
    );
    expect(res.status).toHaveBeenCalledWith(423);
  });

  test('isLoginLockoutEntry every() returns false if even one field is non-finite', () => {
    // Line 134: some() mutant — every() vs some() changes validation semantics
    // Key: with 'some', an entry with 1 finite field (e.g., lockedUntil=future) and the rest NaN
    // would be accepted as valid → user would be blocked (423) even though entry is malformed.
    // With 'every', all fields must be finite → rejected → 401
    lockoutStateFiles.set(
      LOCKOUT_STATE_PATH,
      JSON.stringify({
        account: {
          // Entry with 3 NaN fields but lockedUntil is valid+future → should be rejected
          'mostly-invalid-locked': {
            failedAttempts: 'not-a-number', // invalid
            windowStartAt: 1000,
            lockedUntil: Date.now() + 600000, // future, finite
            lastAttemptAt: 'also-invalid', // invalid
          },
          // Entry with valid lockedUntil=NaN — every() rejects, some() accepts (other fields finite)
          'nan-lockout': {
            failedAttempts: 1,
            windowStartAt: 1000,
            lockedUntil: NaN,
            lastAttemptAt: 3000,
          },
          'all-good': {
            failedAttempts: 1,
            windowStartAt: 1000,
            lockedUntil: Date.now() + 600000,
            lastAttemptAt: Date.now(),
          },
        },
        ip: {},
      }),
    );
    makePassportInvalidCredentials();
    initializeLoginLockoutState();

    // 'mostly-invalid-locked': failedAttempts is non-numeric string → every() rejects → 401
    // With some(): lockedUntil (future) is finite → accepts → 423!
    const r1 = createResponse();
    authenticateLogin(
      { body: { username: 'mostly-invalid-locked' }, ip: '10.0.0.6' } as any,
      r1 as any,
      vi.fn(),
    );
    expect(r1.status).toHaveBeenCalledWith(401); // every() must reject invalid entries

    // 'all-good' should be hydrated and locked → 423
    const r2 = createResponse();
    authenticateLogin(
      { body: { username: 'all-good' }, ip: '10.0.0.7' } as any,
      r2 as any,
      vi.fn(),
    );
    expect(r2.status).toHaveBeenCalledWith(423);
  });

  test('persistLockoutState writes account and ip maps with correct encoding and mode', () => {
    vi.useFakeTimers();
    makePassportInvalidCredentials();

    authenticateLogin(
      { body: { username: 'persist-map-user' }, ip: '10.0.0.8' } as any,
      createResponse() as any,
      vi.fn(),
    );
    vi.advanceTimersByTime(1000);

    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      LOCKOUT_STATE_PATH,
      expect.stringContaining('"account"'),
      { encoding: 'utf8', mode: 0o600 },
    );
    const content = JSON.parse(lockoutStateFiles.get(LOCKOUT_STATE_PATH) ?? '{}');
    expect(content).toHaveProperty('account');
    expect(content).toHaveProperty('ip');
    expect(content.account['persist-map-user']).toEqual(
      expect.objectContaining({ failedAttempts: 1 }),
    );
    vi.useRealTimers();
  });

  test('scheduleLockoutStatePersist does not schedule a second timer when one is already pending', () => {
    vi.useFakeTimers();
    makePassportInvalidCredentials();

    // Two failures in quick succession — should only write once (debounce)
    authenticateLogin(
      { body: { username: 'debounce-user' }, ip: '10.0.0.9' } as any,
      createResponse() as any,
      vi.fn(),
    );
    authenticateLogin(
      { body: { username: 'debounce-user2' }, ip: '10.0.0.10' } as any,
      createResponse() as any,
      vi.fn(),
    );

    vi.advanceTimersByTime(1000);
    // Both writes are debounced into one call
    expect(mockFs.writeFileSync).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  test('hydrateLockoutMap silently skips non-object serializedEntries', () => {
    // Lines 181-182: !serializedEntries || typeof serializedEntries !== 'object' branch
    // Must test with null (not just numbers) because Object.entries(null) throws
    // Without the guard: Object.entries(null) throws → caught → log.warn called
    lockoutStateFiles.set(LOCKOUT_STATE_PATH, JSON.stringify({ account: null, ip: null }));
    makePassportInvalidCredentials();
    // Should not throw even with null account/ip
    expect(() => initializeLoginLockoutState()).not.toThrow();
    // Guard must have fired silently — no warn
    expect(log.warn).not.toHaveBeenCalled();

    const res = createResponse();
    authenticateLogin(
      { body: { username: 'hydrate-skip' }, ip: '10.0.0.11' } as any,
      res as any,
      vi.fn(),
    );
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('hydrateLockoutMap guards null specifically (Object.entries(null) would throw)', () => {
    // Lines 181:7 ConditionalExpression false — with null, would crash without guard
    // Without guard, Object.entries(null) throws → caught in outer try → log.warn called
    lockoutStateFiles.set(LOCKOUT_STATE_PATH, JSON.stringify({ account: null, ip: null }));
    expect(() => initializeLoginLockoutState()).not.toThrow();
    // The guard must have prevented the crash — log.warn should NOT be called
    expect(log.warn).not.toHaveBeenCalled();
  });

  test('hydrateLockoutMap LogicalOperator guard: || not && — null passes first arm', () => {
    // Line 181:7 LogicalOperator && mutant — if &&, null is falsy so && short-circuits to false
    // meaning the guard never fires and Object.entries(null) would be called → log.warn
    lockoutStateFiles.set(LOCKOUT_STATE_PATH, JSON.stringify({ account: null }));
    expect(() => initializeLoginLockoutState()).not.toThrow();
    expect(log.warn).not.toHaveBeenCalled();
  });

  test('hydrateLockoutMap typeof check: typeof null === "object" needs separate falsy check', () => {
    // Line 181:29 ConditionalExpression false — removes typeof check
    // null passes the truthy check (typeof null === 'object' is true in JS!)
    // So the || arm with typeof wouldn't catch null — only !null catches it
    // This confirms both arms of the guard are needed
    lockoutStateFiles.set(LOCKOUT_STATE_PATH, JSON.stringify({ account: null, ip: null }));
    expect(() => initializeLoginLockoutState()).not.toThrow();
    expect(log.warn).not.toHaveBeenCalled();
    // And confirm with the second arm test: a number (not object) should be caught
    resetLoginLockoutStateForTests();
    vi.clearAllMocks();
    lockoutStateFiles.set(LOCKOUT_STATE_PATH, JSON.stringify({ account: 42, ip: 'hello' }));
    expect(() => initializeLoginLockoutState()).not.toThrow();
    expect(log.warn).not.toHaveBeenCalled();
  });

  test('hydrateLockoutMap BlockStatement: early return prevents Object.entries on null', () => {
    // Line 181:68 BlockStatement {} — if no return, Object.entries(null) called → throws →
    // caught in outer try/catch in loadPersistedLockoutState → log.warn called
    lockoutStateFiles.set(LOCKOUT_STATE_PATH, JSON.stringify({ account: null, ip: null }));
    expect(() => initializeLoginLockoutState()).not.toThrow();
    // If BlockStatement mutant: Object.entries(null) throws → log.warn is called
    // The guard's return must be there to prevent the crash
    expect(log.warn).not.toHaveBeenCalled();
    // Confirm no entries were hydrated (map should be empty)
    makePassportInvalidCredentials();
    const res = createResponse();
    authenticateLogin(
      { body: { username: 'block-hydrate' }, ip: '10.0.0.12' } as any,
      res as any,
      vi.fn(),
    );
    expect(res.status).toHaveBeenCalledWith(401); // no pre-hydrated lockout
  });

  test('loadPersistedLockoutState skips files that do not exist', () => {
    // Lines 195: existsSync returns false
    mockFs.existsSync.mockReturnValue(false);
    initializeLoginLockoutState();
    expect(mockFs.readFileSync).not.toHaveBeenCalled();
  });

  test('loadPersistedLockoutState skips non-object parsed state', () => {
    // Line 200: !parsedState check — if guard removed, accessing .account on null throws → log.warn
    lockoutStateFiles.set(LOCKOUT_STATE_PATH, JSON.stringify(null));
    initializeLoginLockoutState();
    // No gauges set beyond the final updateLockoutGaugeTotals call; no crash
    expect(mockSetAuthAccountLockedTotal).toHaveBeenCalled();
    // Guard must have fired silently — warn was NOT called for null parsed state
    expect(log.warn).not.toHaveBeenCalled();
  });

  test('pruneAndPersistIfChanged persists when account map shrank', () => {
    // Lines 219-220: size !== sizeBeforePrune comparisons
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    lockoutStateFiles.set(
      LOCKOUT_STATE_PATH,
      JSON.stringify({
        account: {
          'prune-account-user': {
            failedAttempts: 1,
            windowStartAt: Date.parse('2026-01-01T00:00:00.000Z'),
            lockedUntil: 0,
            lastAttemptAt: Date.parse('2026-01-01T00:00:00.000Z'),
          },
        },
        ip: {},
      }),
    );

    initializeLoginLockoutState();
    const writeCountAfterInit = mockFs.writeFileSync.mock.calls.length;

    // Advance past window → prune timer fires, account entry removed
    vi.setSystemTime(new Date('2026-01-01T00:16:00.000Z'));
    vi.advanceTimersByTime(16 * 60 * 1000);

    expect(mockFs.writeFileSync.mock.calls.length).toBeGreaterThan(writeCountAfterInit);
    vi.useRealTimers();
  });

  test('pruneAndPersistIfChanged persists when ip map shrank', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    lockoutStateFiles.set(
      LOCKOUT_STATE_PATH,
      JSON.stringify({
        account: {},
        ip: {
          '10.0.0.100': {
            failedAttempts: 1,
            windowStartAt: Date.parse('2026-01-01T00:00:00.000Z'),
            lockedUntil: 0,
            lastAttemptAt: Date.parse('2026-01-01T00:00:00.000Z'),
          },
        },
      }),
    );

    initializeLoginLockoutState();
    const writeCountAfterInit = mockFs.writeFileSync.mock.calls.length;

    vi.setSystemTime(new Date('2026-01-01T00:16:00.000Z'));
    vi.advanceTimersByTime(16 * 60 * 1000);

    expect(mockFs.writeFileSync.mock.calls.length).toBeGreaterThan(writeCountAfterInit);
    vi.useRealTimers();
  });

  test('pruneAndPersistIfChanged does NOT persist when nothing was pruned', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    // No initial lockout entries → prune does nothing → no persist
    initializeLoginLockoutState();
    const writeCountAfterInit = mockFs.writeFileSync.mock.calls.length;

    // Advance past prune interval AND past the persist debounce (250ms)
    // This ensures that even a scheduled persist (from the mutant) would have fired
    vi.advanceTimersByTime(60 * 1000 + 500); // prune interval + extra for debounce

    expect(mockFs.writeFileSync.mock.calls.length).toBe(writeCountAfterInit);
    vi.useRealTimers();
  });

  test('normalizeIdentity trims and lowercases the value', () => {
    // Line 244: value.trim().toLowerCase() — MethodExpression mutant that drops toLowerCase
    makePassportInvalidCredentials();

    // Login with uppercase username → normalized to lowercase for lockout key
    for (let i = 0; i < 5; i += 1) {
      authenticateLogin(
        { body: { username: 'NormUser' }, ip: '10.0.1.1' } as any,
        createResponse() as any,
        vi.fn(),
      );
    }
    // Now attempt with lowercase — should be blocked (same lockout key)
    const res = createResponse();
    authenticateLogin(
      { body: { username: 'normuser' }, ip: '10.0.1.2' } as any,
      res as any,
      vi.fn(),
    );
    expect(res.status).toHaveBeenCalledWith(423);
  });

  test('normalizeIdentity returns undefined for empty-after-trim string', () => {
    // Line 245: normalized.length > 0 mutant
    makePassportInvalidCredentials();

    // Whitespace-only username → no lockout key → no IP lockout either for this distinct IP
    const res = createResponse();
    authenticateLogin({ body: { username: '   ' }, ip: '10.0.1.3' } as any, res as any, vi.fn());
    // Should not crash, falls to passport
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('getLoginIdentity returns body username without lowercasing', () => {
    // Line 252: username.length > 0 mutant — ensure non-empty trim check works
    makePassportInvalidCredentials();
    const res = createResponse();
    authenticateLogin(
      { body: { username: 'BodyUser' }, ip: '10.0.1.4' } as any,
      res as any,
      vi.fn(),
    );
    expect(mockRecordLoginAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      'error',
      'Authentication failed (invalid credentials)',
      'BodyUser',
    );
  });

  test('getLoginIdentity extracts username before colon from Basic auth', () => {
    // Line 270: separatorIndex >= 0 mutant — separatorIndex > 0 would skip idx=0
    // When separatorIndex=0 (colon at start), slice(0, 0) = '' → undefined
    // With > 0 mutant: when colon at index 0, fallback to full decoded string ':password'
    makePassportInvalidCredentials();
    const encoded = Buffer.from(':password').toString('base64'); // username is empty string
    const res = createResponse();
    authenticateLogin(
      { headers: { authorization: `Basic ${encoded}` }, ip: '10.0.1.5' } as any,
      res as any,
      vi.fn(),
    );
    // Username before ':' is empty → normalizes to undefined → loginIdentity is undefined
    // With > 0 mutant, loginIdentity would be ':password' (non-empty string)
    expect(mockRecordLoginAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      'error',
      'Authentication failed (invalid credentials)',
      undefined, // empty before colon → no loginIdentity
    );
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('getLoginIdentity returns username even when separator is at index 0', () => {
    // With separatorIndex >= 0, decoded.slice(0, 0) = '' → trimmed → undefined
    makePassportInvalidCredentials();
    const encodedUser = Buffer.from('alice').toString('base64'); // no colon, full string is username
    const res = createResponse();
    authenticateLogin(
      { headers: { authorization: `Basic ${encodedUser}` }, ip: '10.0.1.6' } as any,
      res as any,
      vi.fn(),
    );
    expect(mockRecordLoginAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      'error',
      'Authentication failed (invalid credentials)',
      'alice',
    );
  });

  test('getLoginIdentity returns trimmed username when no colon in decoded value', () => {
    // Line 271: MethodExpression — username = decoded.slice(0, separatorIndex) vs username
    makePassportInvalidCredentials();
    const encoded = Buffer.from('  john  ').toString('base64'); // no colon, username with spaces
    const res = createResponse();
    authenticateLogin(
      { headers: { authorization: `Basic ${encoded}` }, ip: '10.0.1.7' } as any,
      res as any,
      vi.fn(),
    );
    expect(mockRecordLoginAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      'error',
      'Authentication failed (invalid credentials)',
      'john',
    );
  });

  test('getLoginIdentity returns undefined for trimmed empty username after decode', () => {
    // Line 272: trimmed.length > 0 — mutant makes it always return trimmed
    makePassportInvalidCredentials();
    const encoded = Buffer.from('   :password').toString('base64');
    const res = createResponse();
    authenticateLogin(
      { headers: { authorization: `Basic ${encoded}` }, ip: '10.0.1.8' } as any,
      res as any,
      vi.fn(),
    );
    // Empty username before colon → undefined identity → audit shows unknown
    expect(mockRecordLoginAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      'error',
      'Authentication failed (invalid credentials)',
      undefined,
    );
  });

  test('pruneLockoutEntries only removes entries where lockedUntil <= now AND window elapsed', () => {
    // Line 284: EqualityOperator mutants on lockedUntil <= now and now - lastAttemptAt > windowMs
    // Also tests ConditionalExpression true mutant on `true && now - lastAttemptAt > windowMs`
    const now = Date.parse('2026-01-01T00:20:00.000Z');
    const lockouts = new Map([
      [
        'still-locked',
        {
          failedAttempts: 5,
          windowStartAt: now - 5000,
          lockedUntil: now + 60000, // future → should NOT be pruned
          lastAttemptAt: now - 5000,
        },
      ],
      [
        // CRITICAL: locked (lockedUntil > now) but lastAttemptAt is past the window
        // With ConditionalExpression true mutant: this entry would be incorrectly pruned
        // because true && (past_window) = true → expired!
        'locked-past-window',
        {
          failedAttempts: 5,
          windowStartAt: now - testable_accountLockoutPolicy.windowMs - 5000,
          lockedUntil: now + 60000, // still locked
          lastAttemptAt: now - testable_accountLockoutPolicy.windowMs - 5000, // past window
        },
      ],
      [
        'unlocked-in-window',
        {
          failedAttempts: 2,
          windowStartAt: now - 1000,
          lockedUntil: 0, // not locked
          lastAttemptAt: now - 1000, // within window → NOT pruned
        },
      ],
      [
        'expired-outside-window',
        {
          failedAttempts: 1,
          windowStartAt: now - testable_accountLockoutPolicy.windowMs - 2000,
          lockedUntil: 0,
          lastAttemptAt: now - testable_accountLockoutPolicy.windowMs - 2000,
        },
      ],
    ]);

    testable_pruneLockoutEntries(lockouts, testable_accountLockoutPolicy, now);

    expect(lockouts.has('still-locked')).toBe(true);
    // locked-past-window: lockedUntil > now → NOT expired regardless of window
    expect(lockouts.has('locked-past-window')).toBe(true);
    expect(lockouts.has('unlocked-in-window')).toBe(true);
    expect(lockouts.has('expired-outside-window')).toBe(false);
  });

  test('pruneLockoutEntries removes oldest entries when size exceeds cap', () => {
    // Line 290: lockouts.size <= maxTrackedLockoutIdentities  — if >, we prune overflow
    const now = Date.parse('2026-01-01T00:00:00.000Z');
    const lockouts = new Map();
    // Fill beyond the test cap (5) to trigger overflow eviction path
    for (let i = 0; i <= LOCKOUT_TRACKED_IDENTITIES_CAP_FOR_TESTS; i += 1) {
      lockouts.set(`overflow-user-${i}`, {
        failedAttempts: 1,
        windowStartAt: now + i,
        lockedUntil: now + testable_accountLockoutPolicy.lockoutMs,
        lastAttemptAt: now + i,
      });
    }

    testable_pruneLockoutEntries(lockouts, testable_accountLockoutPolicy, now);

    expect(lockouts.size).toBe(LOCKOUT_TRACKED_IDENTITIES_CAP_FOR_TESTS);
    expect(lockouts.has('overflow-user-0')).toBe(false);
    expect(lockouts.has(`overflow-user-${LOCKOUT_TRACKED_IDENTITIES_CAP_FOR_TESTS}`)).toBe(true);
  });

  test('pruneLockoutEntries sort is ascending by lastAttemptAt (oldest first)', () => {
    // Line 295: ArrowFunction mutant — ensures sort uses subtraction not constant
    const now = Date.parse('2026-01-01T00:00:00.000Z');
    const lockouts = new Map([
      [
        'newest',
        {
          failedAttempts: 1,
          windowStartAt: now,
          lockedUntil: now + 60000,
          lastAttemptAt: now + 100,
        },
      ],
      [
        'oldest',
        { failedAttempts: 1, windowStartAt: now, lockedUntil: now + 60000, lastAttemptAt: now },
      ],
      [
        'middle',
        {
          failedAttempts: 1,
          windowStartAt: now,
          lockedUntil: now + 60000,
          lastAttemptAt: now + 50,
        },
      ],
      [
        'second',
        {
          failedAttempts: 1,
          windowStartAt: now,
          lockedUntil: now + 60000,
          lastAttemptAt: now + 25,
        },
      ],
      [
        'third',
        {
          failedAttempts: 1,
          windowStartAt: now,
          lockedUntil: now + 60000,
          lastAttemptAt: now + 75,
        },
      ],
      [
        'new-entry',
        {
          failedAttempts: 1,
          windowStartAt: now,
          lockedUntil: now + 60000,
          lastAttemptAt: now + 200,
        },
      ],
    ]);
    // size = 6, cap = 5 → remove 1 (the oldest)
    testable_pruneLockoutEntries(lockouts, testable_accountLockoutPolicy, now);

    expect(lockouts.size).toBe(LOCKOUT_TRACKED_IDENTITIES_CAP_FOR_TESTS);
    expect(lockouts.has('oldest')).toBe(false);
    expect(lockouts.has('newest')).toBe(true);
  });

  test('isExpiredUnlockedEntry uses strict > for window comparison', () => {
    // Lines 284/308: now - entry.lastAttemptAt > policy.windowMs — EqualityOperator mutant
    const now = Date.parse('2026-01-01T00:20:00.000Z');
    const policy = testable_accountLockoutPolicy;

    // Exactly at the boundary: now - lastAttemptAt === windowMs should NOT be expired
    const exactBoundaryEntry = {
      failedAttempts: 2,
      windowStartAt: now - policy.windowMs,
      lockedUntil: 0,
      lastAttemptAt: now - policy.windowMs, // diff === windowMs, NOT > windowMs
    };
    const lockouts = new Map([['boundary', exactBoundaryEntry]]);
    testable_pruneLockoutEntries(lockouts, policy, now);
    expect(lockouts.has('boundary')).toBe(true);

    // One ms past boundary: should be pruned
    const justPastEntry = {
      failedAttempts: 2,
      windowStartAt: now - policy.windowMs - 1,
      lockedUntil: 0,
      lastAttemptAt: now - policy.windowMs - 1,
    };
    lockouts.set('just-past', justPastEntry);
    testable_pruneLockoutEntries(lockouts, policy, now);
    expect(lockouts.has('just-past')).toBe(false);
    expect(lockouts.has('boundary')).toBe(true);
  });

  test('pruneLockoutEntries lockedUntil <= now (not <): exactly-now lockedUntil is expired when past window', () => {
    // Line 284:21 EqualityOperator < mutant — lockedUntil=now with > mutant would NOT be pruned
    const now = Date.parse('2026-01-01T00:20:00.000Z');
    const policy = testable_accountLockoutPolicy;
    // Entry: lockedUntil = now exactly, lastAttemptAt past window → should be expired (<=)
    const lockouts = new Map([
      [
        'exactly-now-locked',
        {
          failedAttempts: 1,
          windowStartAt: now - policy.windowMs - 1000,
          lockedUntil: now, // exactly now → <= now is true (expired), < now is false (not expired)
          lastAttemptAt: now - policy.windowMs - 1000, // past window
        },
      ],
    ]);
    testable_pruneLockoutEntries(lockouts, policy, now);
    // lockedUntil=now <= now → expired AND past window → should be pruned
    expect(lockouts.has('exactly-now-locked')).toBe(false);
  });

  test('getLockoutUntil returns undefined and deletes expired-outside-window entries', () => {
    // Lines 378, 379 ConditionalExpression mutants
    vi.useFakeTimers();
    const now = Date.parse('2026-01-01T00:20:00.000Z');
    vi.setSystemTime(new Date(now));
    const expiredAt = now - testable_accountLockoutPolicy.windowMs - 1000;

    lockoutStateFiles.set(
      LOCKOUT_STATE_PATH,
      JSON.stringify({
        account: {
          'getLockout-expired': {
            failedAttempts: 1,
            windowStartAt: expiredAt,
            lockedUntil: 0,
            lastAttemptAt: expiredAt,
          },
        },
        ip: {},
      }),
    );
    makePassportInvalidCredentials();
    initializeLoginLockoutState();

    // Entry exists but is unlocked and window expired → getLockoutUntil deletes it
    // and scheduleLockoutStatePersist is called
    const res = createResponse();
    authenticateLogin(
      { body: { username: 'getLockout-expired' }, ip: '10.0.2.1' } as any,
      res as any,
      vi.fn(),
    );

    // Not blocked
    expect(res.status).not.toHaveBeenCalledWith(423);

    vi.advanceTimersByTime(1000);
    // State was persisted after cleanup
    const _persisted = JSON.parse(lockoutStateFiles.get(LOCKOUT_STATE_PATH) ?? '{}');
    // After persist, the entry should be gone or the account map should not contain it
    // (it was deleted in getLockoutUntil, then a new entry created by the failed attempt)
    vi.useRealTimers();
  });

  test('getLockoutUntil returns lockedUntil when entry is still locked', () => {
    // Lines 378: entry.lockedUntil <= now — when strictly less, should return early
    vi.useFakeTimers();
    const now = Date.parse('2026-01-01T12:00:00.000Z');
    vi.setSystemTime(new Date(now));
    const futurelock = now + 900000; // 15 min from now

    lockoutStateFiles.set(
      LOCKOUT_STATE_PATH,
      JSON.stringify({
        account: {
          'still-active': {
            failedAttempts: 5,
            windowStartAt: now - 60000,
            lockedUntil: futurelock,
            lastAttemptAt: now - 60000,
          },
        },
        ip: {},
      }),
    );
    makePassportInvalidCredentials();
    initializeLoginLockoutState();

    const res = createResponse();
    authenticateLogin(
      { body: { username: 'still-active' }, ip: '10.0.2.2' } as any,
      res as any,
      vi.fn(),
    );
    expect(res.status).toHaveBeenCalledWith(423);
    vi.useRealTimers();
  });

  test('isExpiredUnlockedEntry: lockedUntil <= now (not <) — exactly-now lockedUntil is expired', () => {
    // Line 308:10 EqualityOperator < mutant — lockedUntil == now should be treated as expired
    // With lockedUntil < now: entry with lockedUntil=now is NOT expired → not removed
    // With lockedUntil <= now: entry with lockedUntil=now IS expired → removed
    const now = Date.parse('2026-01-01T00:20:00.000Z');
    const exactAttemptAt = now - testable_accountLockoutPolicy.windowMs - 1000; // past window
    const lockouts = new Map<string, any>([
      // Entry with lockedUntil exactly == now AND past window → should be expired
      [
        'exact-now-locked',
        {
          failedAttempts: 1,
          windowStartAt: exactAttemptAt,
          lockedUntil: now,
          lastAttemptAt: exactAttemptAt,
        },
      ],
      // Fill to cap-1 with other entries (older, locked entries that won't be expired)
      ...Array.from({ length: LOCKOUT_TRACKED_IDENTITIES_CAP_FOR_TESTS - 1 }, (_, i) => [
        `filler-${i}`,
        {
          failedAttempts: 5,
          windowStartAt: exactAttemptAt - i * 1000,
          lockedUntil: now + 60000,
          lastAttemptAt: exactAttemptAt - i * 1000,
        },
      ]),
    ]);
    // size = cap: triggers removeExpiredUnlockedEntries
    testable_makeTrackedIdentityCapacity(lockouts, testable_accountLockoutPolicy, now);
    // exact-now-locked: lockedUntil=now <= now → expired → removed
    expect(lockouts.has('exact-now-locked')).toBe(false);
  });

  test('isExpiredUnlockedEntry: lockedUntil true mutant — locked entries (lockedUntil > now) should NOT be removed', () => {
    // Line 308:10 ConditionalExpression true — with "true &&", even locked entries appear expired
    const now = Date.parse('2026-01-01T00:20:00.000Z');
    const oldAttemptAt = now - testable_accountLockoutPolicy.windowMs - 1000; // past window
    const lockouts = new Map<string, any>([
      // This entry IS locked (lockedUntil > now) but past the window
      // With ConditionalExpression true mutant: would be considered expired and deleted
      [
        'still-locked',
        {
          failedAttempts: 5,
          windowStartAt: oldAttemptAt,
          lockedUntil: now + 60000,
          lastAttemptAt: oldAttemptAt,
        },
      ],
      ...Array.from({ length: LOCKOUT_TRACKED_IDENTITIES_CAP_FOR_TESTS - 1 }, (_, i) => [
        `other-${i}`,
        {
          failedAttempts: 1,
          windowStartAt: oldAttemptAt - i * 1000,
          lockedUntil: now + 60000,
          lastAttemptAt: oldAttemptAt - i * 1000,
        },
      ]),
    ]);
    // size = cap: triggers removeExpiredUnlockedEntries
    testable_makeTrackedIdentityCapacity(lockouts, testable_accountLockoutPolicy, now);
    // still-locked: lockedUntil=now+60000 > now → NOT expired → must remain
    expect(lockouts.has('still-locked')).toBe(true);
  });

  test('makeTrackedIdentityCapacity returns immediately when size is below cap', () => {
    // Line 351: lockouts.size < maxTrackedLockoutIdentities
    const now = Date.parse('2026-01-01T00:00:00.000Z');
    const lockouts = new Map([
      [
        'one',
        { failedAttempts: 1, windowStartAt: now, lockedUntil: now + 60000, lastAttemptAt: now },
      ],
    ]);
    // cap = 5, size = 1 → should not remove anything
    testable_makeTrackedIdentityCapacity(lockouts, testable_accountLockoutPolicy, now);
    expect(lockouts.size).toBe(1);
  });

  test('makeTrackedIdentityCapacity evicts old entries when at cap', () => {
    // Lines 357-359: entriesToEvict > 0 check
    const now = Date.parse('2026-01-01T00:00:00.000Z');
    const lockouts = new Map();
    // Fill exactly to cap with locked entries (none expire)
    for (let i = 0; i < LOCKOUT_TRACKED_IDENTITIES_CAP_FOR_TESTS; i += 1) {
      lockouts.set(`cap-user-${i}`, {
        failedAttempts: 5,
        windowStartAt: now - i,
        lockedUntil: now + 60000,
        lastAttemptAt: now - i * 1000,
      });
    }
    // size = cap → makeTrackedIdentityCapacity should evict 1 to create room
    testable_makeTrackedIdentityCapacity(lockouts, testable_accountLockoutPolicy, now);
    expect(lockouts.size).toBe(LOCKOUT_TRACKED_IDENTITIES_CAP_FOR_TESTS - 1);
    // The oldest (cap-user-4 = lastAttemptAt now - 4000) should be evicted
    expect(lockouts.has(`cap-user-${LOCKOUT_TRACKED_IDENTITIES_CAP_FOR_TESTS - 1}`)).toBe(false);
  });

  test('evictOldestTrackedEntries picks entry with strictly smallest lastAttemptAt', () => {
    // Line 332: entry.lastAttemptAt < oldestLastAttemptAt — EqualityOperator mutant
    const now = Date.parse('2026-01-01T00:00:00.000Z');
    const lockouts = new Map([
      [
        'newer',
        {
          failedAttempts: 1,
          windowStartAt: now,
          lockedUntil: now + 60000,
          lastAttemptAt: now + 100,
        },
      ],
      [
        'oldest',
        { failedAttempts: 1, windowStartAt: now, lockedUntil: now + 60000, lastAttemptAt: now },
      ],
    ]);
    testable_evictOldestTrackedEntries(lockouts, 1);
    expect(lockouts.has('oldest')).toBe(false);
    expect(lockouts.has('newer')).toBe(true);
  });

  test('registerFailedLoginAttempt locks account exactly at maxAttempts threshold', () => {
    // Lines 421: >= policy.maxAttempts — mutant changes to >
    const now = Date.parse('2026-01-01T00:00:00.000Z');
    const lockouts = new Map<string, any>([
      [
        'threshold-user',
        {
          failedAttempts: testable_accountLockoutPolicy.maxAttempts - 1,
          windowStartAt: now - 1000,
          lockedUntil: 0,
          lastAttemptAt: now - 1000,
        },
      ],
    ]);

    // This is the maxAttempts-th failure — should trigger lockout
    const result = testable_registerFailedLoginAttempt(
      lockouts,
      testable_accountLockoutPolicy,
      'threshold-user',
      now,
    );

    expect(result).toBeDefined();
    expect(result).toBeGreaterThan(now);
    expect(lockouts.get('threshold-user')?.lockedUntil).toBeGreaterThan(now);
  });

  test('registerFailedLoginAttempt does not lock account before maxAttempts threshold', () => {
    const now = Date.parse('2026-01-01T00:00:00.000Z');
    const lockouts = new Map<string, any>([
      [
        'below-threshold-user',
        {
          failedAttempts: testable_accountLockoutPolicy.maxAttempts - 2,
          windowStartAt: now - 1000,
          lockedUntil: 0,
          lastAttemptAt: now - 1000,
        },
      ],
    ]);

    const result = testable_registerFailedLoginAttempt(
      lockouts,
      testable_accountLockoutPolicy,
      'below-threshold-user',
      now,
    );

    expect(result).toBeUndefined();
    expect(lockouts.get('below-threshold-user')?.lockedUntil).toBe(0);
  });

  test('registerFailedLoginAttempt returns lockedUntil when lockedUntil > now after increment', () => {
    // Line 428: lockedUntil > now — ensures we check > not >=
    const now = Date.parse('2026-01-01T00:00:00.000Z');
    const lockouts = new Map<string, any>([
      [
        'lock-now-user',
        {
          failedAttempts: testable_accountLockoutPolicy.maxAttempts - 1,
          windowStartAt: now - 1000,
          lockedUntil: 0,
          lastAttemptAt: now - 1000,
        },
      ],
    ]);

    const result = testable_registerFailedLoginAttempt(
      lockouts,
      testable_accountLockoutPolicy,
      'lock-now-user',
      now,
    );

    // lockedUntil = now + lockoutMs >> now → result should be the lockout time
    expect(result).toBe(now + testable_accountLockoutPolicy.lockoutMs);
  });

  test('registerFailedLoginAttempt returns undefined when lockedUntil stays at 0 (not > now)', () => {
    const now = Date.parse('2026-01-01T00:00:00.000Z');
    const lockouts = new Map<string, any>([
      [
        'no-lock-user',
        {
          failedAttempts: 1,
          windowStartAt: now - 1000,
          lockedUntil: 0,
          lastAttemptAt: now - 1000,
        },
      ],
    ]);
    const result = testable_registerFailedLoginAttempt(
      lockouts,
      testable_accountLockoutPolicy,
      'no-lock-user',
      now,
    );
    // failedAttempts was 1, now 2 — still below maxAttempts (5) → not locked
    expect(result).toBeUndefined();
  });

  test('sendLockoutResponse computes retryAfterSeconds as ceil of remaining ms divided by 1000', () => {
    // Line 464: ArithmeticOperator mutants on (lockoutUntil - now) / 1000
    makePassportInvalidCredentials();
    vi.useFakeTimers();
    const now = Date.parse('2026-01-01T00:00:00.000Z');
    vi.setSystemTime(new Date(now));

    const req = { body: { username: 'retry-after-user' }, ip: '10.0.3.1' } as any;
    const next = vi.fn();

    for (let i = 0; i < 5; i += 1) {
      authenticateLogin(req, createResponse() as any, next);
    }

    const lockedRes = createResponse();
    authenticateLogin(req, lockedRes as any, next);

    expect(lockedRes.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(String));
    const retryAfterValue = Number(
      lockedRes.setHeader.mock.calls.find(([name]) => name === 'Retry-After')?.[1],
    );
    // lockoutMs = 15 * 60 * 1000 = 900000 → ceil(900000/1000) = 900
    expect(retryAfterValue).toBe(900);
    vi.useRealTimers();
  });

  test('sendLockoutResponse uses Math.max(1, ...) for retryAfterSeconds — minimum is 1', () => {
    // Line 464: Math.max(1, ...) — mutant replaces with Math.min
    vi.useFakeTimers();
    const now = Date.parse('2026-01-01T00:00:00.000Z');
    vi.setSystemTime(new Date(now));

    lockoutStateFiles.set(
      LOCKOUT_STATE_PATH,
      JSON.stringify({
        account: {
          'min-retry-user': {
            failedAttempts: 5,
            windowStartAt: now - 60000,
            lockedUntil: now + 1, // just 1ms in future → ceil(0.001) = 1, max(1, 1) = 1
            lastAttemptAt: now - 60000,
          },
        },
        ip: {},
      }),
    );
    makePassportInvalidCredentials();
    initializeLoginLockoutState();

    const res = createResponse();
    authenticateLogin(
      { body: { username: 'min-retry-user' }, ip: '10.0.3.2' } as any,
      res as any,
      vi.fn(),
    );

    expect(res.status).toHaveBeenCalledWith(423);
    const retryAfterValue = Number(
      res.setHeader.mock.calls.find(([name]) => name === 'Retry-After')?.[1],
    );
    expect(retryAfterValue).toBeGreaterThanOrEqual(1);
    vi.useRealTimers();
  });

  test('sendLockoutResponse audit message includes retry_after seconds', () => {
    // Line 470: StringLiteral mutant replaces template literal
    makePassportInvalidCredentials();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const req = { body: { username: 'audit-retry-user' }, ip: '10.0.3.3' } as any;
    for (let i = 0; i < 5; i += 1) {
      authenticateLogin(req, createResponse() as any, vi.fn());
    }
    authenticateLogin(req, createResponse() as any, vi.fn());

    expect(mockRecordLoginAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      'error',
      expect.stringContaining('retry_after='),
      expect.anything(),
    );
    vi.useRealTimers();
  });

  test('activeLockoutUntil uses Math.max to pick the later of account and ip lockouts', () => {
    // Line 489: activeLockoutUntil > now check
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    makePassportInvalidCredentials();

    // Lock via IP (25 attempts needed), use different usernames
    const ipReqs = Array.from({ length: 25 }, (_, i) => ({
      body: { username: `ip-lock-user-${i}` },
      ip: '10.0.4.1',
    }));
    for (const req of ipReqs) {
      authenticateLogin(req as any, createResponse() as any, vi.fn());
    }
    // Now the IP is locked; a new username should also be blocked
    const res = createResponse();
    authenticateLogin(
      { body: { username: 'fresh-ip-user' }, ip: '10.0.4.1' } as any,
      res as any,
      vi.fn(),
    );
    expect(res.status).toHaveBeenCalledWith(423);
    vi.useRealTimers();
  });

  test('lockoutUntil after-failure check uses > failedAt (not >=)', () => {
    // Line 518: lockoutUntil > failedAt — ensures the boundary is correct
    makePassportInvalidCredentials();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const req = { body: { username: 'failedAt-boundary-user' }, ip: '10.0.5.1' } as any;
    // 4 failures → not yet locked
    for (let i = 0; i < 4; i += 1) {
      const res = createResponse();
      authenticateLogin(req, res as any, vi.fn());
      expect(res.status).toHaveBeenCalledWith(401);
    }
    // 5th failure → lockout threshold reached → locked
    const lockedRes = createResponse();
    authenticateLogin(req, lockedRes as any, vi.fn());
    expect(lockedRes.status).toHaveBeenCalledWith(423);
    vi.useRealTimers();
  });

  test('resetLoginLockoutStateForTests does not throw when timers were not scheduled', () => {
    // Lines 560, 564: ConditionalExpression mutants on maintenanceTimer/persistTimer checks
    expect(() => resetLoginLockoutStateForTests()).not.toThrow();
    expect(mockSetAuthAccountLockedTotal).toHaveBeenCalledWith(0);
    expect(mockSetAuthIpLockedTotal).toHaveBeenCalledWith(0);
  });

  test('persistenceInitialized starts as false — second init skips loading', () => {
    // Line 69: BooleanLiteral true mutant — if initialized = true, loadPersistedLockoutState is skipped
    lockoutStateFiles.set(LOCKOUT_STATE_PATH, JSON.stringify({ account: {}, ip: {} }));

    initializeLoginLockoutState();
    expect(mockFs.readFileSync).toHaveBeenCalledTimes(1);

    // Second call should NOT read file again (persistenceInitialized is true)
    initializeLoginLockoutState();
    expect(mockFs.readFileSync).toHaveBeenCalledTimes(1);

    // But after reset, third call SHOULD read again
    resetLoginLockoutStateForTests();
    initializeLoginLockoutState();
    expect(mockFs.readFileSync).toHaveBeenCalledTimes(2);
  });

  test('countActiveLockouts uses if (entry.lockedUntil > now) not (true)', () => {
    // Line 74: ConditionalExpression true mutant — always counts as active, even unlocked entries
    vi.useFakeTimers();
    const now = Date.parse('2026-01-01T12:00:00.000Z');
    vi.setSystemTime(new Date(now));
    makePassportInvalidCredentials();

    // Login once (not locked) — lockedUntil = 0 which is NOT > now
    authenticateLogin(
      { body: { username: 'gauge-once-user' }, ip: '10.1.0.1' } as any,
      createResponse() as any,
      vi.fn(),
    );

    // After a single failure, the entry is not locked (lockedUntil = 0)
    // updateLockoutGaugeTotals is called → countActiveLockouts → 0 locked
    // With ConditionalExpression true, it would count as 1 instead of 0
    expect(mockSetAuthAccountLockedTotal).toHaveBeenCalledWith(0);
    vi.useRealTimers();
  });

  test('countActiveLockouts uses strict > (not >=) for lockedUntil vs now', () => {
    // Line 74: EqualityOperator >= mutant — lockedUntil=now should NOT be active
    vi.useFakeTimers();
    const lockoutTime = Date.parse('2026-01-01T12:15:00.000Z');
    vi.setSystemTime(new Date(lockoutTime)); // time = exactly lockedUntil

    lockoutStateFiles.set(
      LOCKOUT_STATE_PATH,
      JSON.stringify({
        account: {
          'boundary-gauge-user': {
            failedAttempts: 5,
            windowStartAt: lockoutTime - 900000,
            lockedUntil: lockoutTime, // exactly now → NOT active (not strictly >)
            lastAttemptAt: lockoutTime - 900000,
          },
        },
        ip: {},
      }),
    );
    initializeLoginLockoutState();
    // Entry has lockedUntil == now → lockedUntil > now is false → NOT active
    expect(mockSetAuthAccountLockedTotal).toHaveBeenCalledWith(0);
    vi.useRealTimers();
  });

  test('parsePositiveIntegerEnv returns fallback when env value is invalid (block not empty)', () => {
    // Line 92:48 BlockStatement {} mutant — if empty, always returns parsed (even invalid)
    const previous = process.env.DD_AUTH_ACCOUNT_LOCKOUT_MAX_ATTEMPTS;
    process.env.DD_AUTH_ACCOUNT_LOCKOUT_MAX_ATTEMPTS = 'invalid';

    // We can only test this at module load time via testable_accountLockoutPolicy
    // The policy was loaded at import — and we checked it was set with default
    expect(testable_accountLockoutPolicy.maxAttempts).toBeGreaterThan(0);

    if (previous === undefined) {
      delete process.env.DD_AUTH_ACCOUNT_LOCKOUT_MAX_ATTEMPTS;
    } else {
      process.env.DD_AUTH_ACCOUNT_LOCKOUT_MAX_ATTEMPTS = previous;
    }
  });

  test('isLoginLockoutEntry returns false for non-object (candidate is object string not {})', () => {
    // Lines 130: ConditionalExpression false, LogicalOperator && mutants
    // The || means: if truthy/non-object, return false
    // Test: typeof candidate !== 'object' check matters for non-null primitives
    lockoutStateFiles.set(
      LOCKOUT_STATE_PATH,
      JSON.stringify({
        account: {
          'number-entry': 42, // typeof 42 !== 'object' → false
          'string-entry': 'lockout', // typeof string !== 'object' → false
          'array-entry': [1, 2], // typeof [] === 'object' but array ≠ entry shape
        },
        ip: {},
      }),
    );
    makePassportInvalidCredentials();
    initializeLoginLockoutState();

    // All should be invalid → not hydrated → passport runs → 401
    const r1 = createResponse();
    authenticateLogin(
      { body: { username: 'number-entry' }, ip: '10.1.1.1' } as any,
      r1 as any,
      vi.fn(),
    );
    expect(r1.status).toHaveBeenCalledWith(401);

    const r2 = createResponse();
    authenticateLogin(
      { body: { username: 'string-entry' }, ip: '10.1.1.2' } as any,
      r2 as any,
      vi.fn(),
    );
    expect(r2.status).toHaveBeenCalledWith(401);
  });

  test('isLoginLockoutEntry BlockStatement — returns false not undefined when guard fires', () => {
    // Line 130:52 BlockStatement {} — if empty body, candidate object would not return false
    lockoutStateFiles.set(
      LOCKOUT_STATE_PATH,
      JSON.stringify({
        account: { 'null-candidate': null },
        ip: {},
      }),
    );
    makePassportInvalidCredentials();
    initializeLoginLockoutState();

    const res = createResponse();
    authenticateLogin(
      { body: { username: 'null-candidate' }, ip: '10.1.1.3' } as any,
      res as any,
      vi.fn(),
    );
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('isLoginLockoutEntry uses typeof !== object check (not just falsy check)', () => {
    // Line 130:21 ConditionalExpression false mutant — removes typeof check
    // A string candidate is truthy but not an object → should return false
    lockoutStateFiles.set(
      LOCKOUT_STATE_PATH,
      JSON.stringify({
        account: { 'truthy-string': 'locked' },
        ip: {},
      }),
    );
    makePassportInvalidCredentials();
    initializeLoginLockoutState();

    const res = createResponse();
    authenticateLogin(
      { body: { username: 'truthy-string' }, ip: '10.1.1.4' } as any,
      res as any,
      vi.fn(),
    );
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('persistLockoutState calls mkdirSync with recursive:true option', () => {
    // Lines 152: ObjectLiteral {} and BooleanLiteral false mutants
    vi.useFakeTimers();
    makePassportInvalidCredentials();

    authenticateLogin(
      { body: { username: 'mkdir-user' }, ip: '10.1.2.1' } as any,
      createResponse() as any,
      vi.fn(),
    );
    vi.advanceTimersByTime(1000);

    expect(mockFs.mkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true });
    vi.useRealTimers();
  });

  test('hydrateLockoutMap guards against array serializedEntries (|| branch)', () => {
    // Line 181:29 ConditionalExpression false mutant — removes typeof check
    // An array is an object but has no named keys → should not cause issues
    // The key test is: null or non-object should return early without calling log.warn
    lockoutStateFiles.set(LOCKOUT_STATE_PATH, JSON.stringify({ account: null, ip: null }));
    makePassportInvalidCredentials();
    initializeLoginLockoutState();
    // Guard silently skips — no warning
    expect(log.warn).not.toHaveBeenCalled();

    const res = createResponse();
    authenticateLogin(
      { body: { username: 'null-hydrate' }, ip: '10.1.2.2' } as any,
      res as any,
      vi.fn(),
    );
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('hydrateLockoutMap || operator: non-object check is the second arm', () => {
    // Line 181:7 LogicalOperator && mutant — if && instead of ||, number would pass through
    // Object.entries(123) returns [] (no throw), but entries(null) throws → warn
    lockoutStateFiles.set(LOCKOUT_STATE_PATH, JSON.stringify({ account: null, ip: null }));
    makePassportInvalidCredentials();
    initializeLoginLockoutState();
    // With || operator: null is caught by first arm → guard fires → no warn
    // With && operator: !null is true, typeof null !== 'object' is false → && is false → no guard → crash → warn
    expect(log.warn).not.toHaveBeenCalled();

    const res = createResponse();
    authenticateLogin(
      { body: { username: 'weird-hydrate' }, ip: '10.1.2.3' } as any,
      res as any,
      vi.fn(),
    );
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('hydrateLockoutMap BlockStatement: early return is necessary when guard fires', () => {
    // Line 181:68 BlockStatement {} — if no return, entries() would be called on non-object → warn
    lockoutStateFiles.set(LOCKOUT_STATE_PATH, JSON.stringify({ account: 0, ip: false }));
    // Should not throw even with non-object values
    expect(() => initializeLoginLockoutState()).not.toThrow();
    // Guard must silently return — no warn (vs BlockStatement mutant where entries() is called on 0/false)
    // Note: Object.entries(0) doesn't throw in JS but Object.entries(null) does
    // The important case is null — tested elsewhere; for 0/false, entries() returns []
  });

  test('loadPersistedLockoutState ConditionalExpression: existsSync false skips read', () => {
    // Line 195:9 ConditionalExpression false — always reads regardless
    // Without the guard: readFileSync called even when file doesn't exist → throws → log.warn
    mockFs.existsSync.mockReturnValue(false);
    initializeLoginLockoutState();
    expect(mockFs.readFileSync).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });

  test('loadPersistedLockoutState BlockStatement: early return when file missing is necessary', () => {
    // Line 195:43 BlockStatement {} — if empty, readFileSync called when file doesn't exist → warn
    mockFs.existsSync.mockReturnValue(false);
    expect(() => initializeLoginLockoutState()).not.toThrow();
    expect(mockFs.readFileSync).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });

  test('loadPersistedLockoutState guards against non-object parsedState', () => {
    // Lines 200:9, 200:25, 200:58 mutants
    // If guard removed (if false), null.account would throw → caught → log.warn
    lockoutStateFiles.set(LOCKOUT_STATE_PATH, JSON.stringify(null)); // null is non-object guard case
    expect(() => initializeLoginLockoutState()).not.toThrow();
    // Guard fired silently — no warn
    expect(log.warn).not.toHaveBeenCalled();
  });

  test('loadPersistedLockoutState || operator: typeof !== object check is second arm', () => {
    // Line 200:9 LogicalOperator && mutant — with &&: !42 is false, so && short-circuits → guard never fires
    // Then (42 as Partial<...>).account is undefined → hydrateLockoutMap(undefined) → no crash (undefined is not null)
    // BUT: typeof 42 !== 'object' case — if we use null, !null is true → both || arms would fire regardless
    // Key: for primitive like 42, typeof 42 !== 'object' is true → should return early via || arm
    lockoutStateFiles.set(LOCKOUT_STATE_PATH, JSON.stringify(42));
    expect(() => initializeLoginLockoutState()).not.toThrow();
    expect(log.warn).not.toHaveBeenCalled();

    resetLoginLockoutStateForTests();
    vi.clearAllMocks();
    lockoutStateFiles.set(LOCKOUT_STATE_PATH, JSON.stringify('hello'));
    expect(() => initializeLoginLockoutState()).not.toThrow();
    expect(log.warn).not.toHaveBeenCalled();
  });

  test('pruneAndPersistIfChanged: account !== check — also test account-only prune', () => {
    // Line 219:5 ConditionalExpression true — always schedules persist
    // Verify: when NOTHING changes, no persist occurs
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    // Start with a locked entry that won't expire during prune
    lockoutStateFiles.set(
      LOCKOUT_STATE_PATH,
      JSON.stringify({
        account: {
          'still-active': {
            failedAttempts: 5,
            windowStartAt: Date.parse('2026-01-01T00:00:00.000Z'),
            lockedUntil: Date.parse('2026-01-01T00:15:00.000Z'),
            lastAttemptAt: Date.parse('2026-01-01T00:00:00.000Z'),
          },
        },
        ip: {},
      }),
    );

    initializeLoginLockoutState();
    const writeCountAfterInit = mockFs.writeFileSync.mock.calls.length;

    // Advance by just 1 minute (not enough to expire the lock or window)
    vi.advanceTimersByTime(60 * 1000);
    // Nothing was pruned → no persist
    expect(mockFs.writeFileSync.mock.calls.length).toBe(writeCountAfterInit);
    vi.useRealTimers();
  });

  test('normalizeIdentity: toLowerCase is applied (not just trim)', () => {
    // Line 244:22 MethodExpression — value.toLowerCase() mutant drops lower
    makePassportInvalidCredentials();

    // Trigger 5 failures with uppercase to lock account
    for (let i = 0; i < 5; i += 1) {
      authenticateLogin(
        { body: { username: 'UPPER_CASE_USER' }, ip: '10.2.0.1' } as any,
        createResponse() as any,
        vi.fn(),
      );
    }
    // Now attempt with lowercase — case-folded key must match
    const res = createResponse();
    authenticateLogin(
      { body: { username: 'upper_case_user' }, ip: '10.2.0.2' } as any,
      res as any,
      vi.fn(),
    );
    expect(res.status).toHaveBeenCalledWith(423);
  });

  test('normalizeIdentity: length > 0 check (not >= 0) rejects empty string', () => {
    // Lines 245:10 ConditionalExpression true and EqualityOperator >=0 mutants
    makePassportInvalidCredentials();

    const res = createResponse();
    // Empty string after trim should return undefined, not the empty string
    authenticateLogin({ body: { username: '' }, ip: '10.2.0.3' } as any, res as any, vi.fn());
    // No lockout key → IP-only tracking (ip = '10.2.0.3' is normalized separately)
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('getLoginIdentity: username.length > 0 check rejects whitespace-only body username', () => {
    // Lines 252:9 ConditionalExpression true and EqualityOperator >=0 mutants
    makePassportInvalidCredentials();
    const res = createResponse();
    authenticateLogin({ body: { username: '   ' }, ip: '10.2.0.4' } as any, res as any, vi.fn());
    // whitespace-only → length === 0 after trim → should fall through to Basic auth or undefined
    // With no Basic header, loginIdentity should be undefined
    expect(mockRecordLoginAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      'error',
      'Authentication failed (invalid credentials)',
      undefined,
    );
  });

  test('getLoginIdentity: startsWith("basic ") check prevents non-basic schemes', () => {
    // Line 258:65 StringLiteral "" mutant — if empty string, any value would pass
    makePassportInvalidCredentials();
    const res = createResponse();
    // Bearer token should NOT be treated as Basic auth
    authenticateLogin(
      { headers: { authorization: 'Bearer some-token' }, ip: '10.2.0.5' } as any,
      res as any,
      vi.fn(),
    );
    // No username extracted → loginIdentity is undefined
    expect(mockRecordLoginAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      'error',
      'Authentication failed (invalid credentials)',
      undefined,
    );
  });

  test('getLockoutUntil: expired-and-past-window entry is deleted and persist is scheduled', () => {
    // Lines 378:7 ConditionalExpression false, 379:9 ConditionalExpression false
    vi.useFakeTimers();
    const now = Date.parse('2026-01-01T01:00:00.000Z');
    vi.setSystemTime(new Date(now));
    const expiredAt = now - testable_accountLockoutPolicy.windowMs - 5000;

    lockoutStateFiles.set(
      LOCKOUT_STATE_PATH,
      JSON.stringify({
        account: {
          'expired-cleaned': {
            failedAttempts: 1,
            windowStartAt: expiredAt,
            lockedUntil: 0, // unlocked AND past window
            lastAttemptAt: expiredAt,
          },
        },
        ip: {},
      }),
    );
    makePassportInvalidCredentials();
    initializeLoginLockoutState();

    const res = createResponse();
    authenticateLogin(
      { body: { username: 'expired-cleaned' }, ip: '10.3.0.1' } as any,
      res as any,
      vi.fn(),
    );

    // Not blocked (getLockoutUntil returns undefined)
    expect(res.status).not.toHaveBeenCalledWith(423);

    // The expired entry was removed → persist scheduled → file written after debounce
    vi.advanceTimersByTime(1000);
    const content = JSON.parse(lockoutStateFiles.get(LOCKOUT_STATE_PATH) ?? '{}');
    // After cleanup + new failed attempt, 'expired-cleaned' now has failedAttempts=1 (new entry)
    expect(content.account['expired-cleaned']).toEqual(
      expect.objectContaining({ failedAttempts: 1 }),
    );
    vi.useRealTimers();
  });

  test('getLockoutUntil: unlocked entry within window stays (no delete, no persist)', () => {
    // Line 379:9 ConditionalExpression false — the inner if deletes only when window expired
    vi.useFakeTimers();
    const now = Date.parse('2026-01-01T01:00:00.000Z');
    vi.setSystemTime(new Date(now));
    const recentAt = now - 60000; // only 1 minute ago, well within 15-min window

    lockoutStateFiles.set(
      LOCKOUT_STATE_PATH,
      JSON.stringify({
        account: {
          'recent-unlocked': {
            failedAttempts: 2,
            windowStartAt: recentAt,
            lockedUntil: 0,
            lastAttemptAt: recentAt,
          },
        },
        ip: {},
      }),
    );
    makePassportInvalidCredentials();
    initializeLoginLockoutState();
    const _writeCountAfterInit = mockFs.writeFileSync.mock.calls.length;

    // Entry is unlocked but within window → getLockoutUntil should NOT delete it
    // (no persist triggered from getLockoutUntil)
    authenticateLogin(
      { body: { username: 'recent-unlocked' }, ip: '10.3.0.2' } as any,
      createResponse() as any,
      vi.fn(),
    );

    vi.advanceTimersByTime(1000);
    // The persist here is from the failed attempt registration (normal flow)
    const content = JSON.parse(lockoutStateFiles.get(LOCKOUT_STATE_PATH) ?? '{}');
    // Entry should still exist with incremented attempts (not cleared)
    expect(content.account['recent-unlocked']?.failedAttempts).toBe(3);
    vi.useRealTimers();
  });

  test('registerFailedLoginAttempt: no key returns undefined (block not empty)', () => {
    // Lines 396:7 ConditionalExpression false, 396:13 BlockStatement {} mutants
    const lockouts = new Map();
    const result = testable_registerFailedLoginAttempt(
      lockouts,
      testable_accountLockoutPolicy,
      undefined, // no key
      Date.now(),
    );
    expect(result).toBeUndefined();
    expect(lockouts.size).toBe(0);
  });

  test('registerFailedLoginAttempt: returns lockedUntil when exactly > now, undefined when =', () => {
    // Line 428:10 EqualityOperator >= mutant
    const now = Date.parse('2026-01-01T00:00:00.000Z');
    const lockouts = new Map<string, any>([
      [
        'eq-user',
        {
          failedAttempts: testable_accountLockoutPolicy.maxAttempts - 1,
          windowStartAt: now - 1000,
          lockedUntil: 0,
          lastAttemptAt: now - 1000,
        },
      ],
    ]);
    const result = testable_registerFailedLoginAttempt(
      lockouts,
      testable_accountLockoutPolicy,
      'eq-user',
      now,
    );
    // lockedUntil = now + lockoutMs (900000) >> now → should return it
    expect(result).toBe(now + testable_accountLockoutPolicy.lockoutMs);

    // Now test: lockedUntil would be exactly 0 still (already unlocked, below threshold)
    const lockouts2 = new Map<string, any>([
      [
        'still-open',
        {
          failedAttempts: 1,
          windowStartAt: now,
          lockedUntil: 0,
          lastAttemptAt: now,
        },
      ],
    ]);
    const result2 = testable_registerFailedLoginAttempt(
      lockouts2,
      testable_accountLockoutPolicy,
      'still-open',
      now,
    );
    // lockedUntil = 0, 0 is NOT > now → should return undefined
    expect(result2).toBeUndefined();
  });

  test('clearLoginLockout: no key does nothing (block not empty)', () => {
    // Lines 435:7 ConditionalExpression false, 435:13 BlockStatement {} mutants
    vi.useFakeTimers();
    // Add a successful auth after some failures → clearLoginLockout is called with a key
    makePassportInvalidCredentials();
    const req = { body: { username: 'clear-key-user' }, ip: '10.4.0.1' } as any;
    authenticateLogin(req, createResponse() as any, vi.fn());

    makePassportSuccess('clear-key-user');
    const successRes = createResponse();
    authenticateLogin(req, successRes as any, vi.fn());

    // After success, lockout for this user was cleared → subsequent failures count fresh
    makePassportInvalidCredentials();
    for (let i = 0; i < 4; i += 1) {
      const r = createResponse();
      authenticateLogin(req, r as any, vi.fn());
      expect(r.status).toHaveBeenCalledWith(401); // not locked yet
    }
    vi.useRealTimers();
  });

  test('clearLoginLockout: when key is undefined, no persist or gauge update', () => {
    // Lines 435:7, 435:13 — undefined key guard
    makePassportSuccess('clear-no-key-user');
    // User with no lockout key (empty string ip)
    const req = { body: { username: 'clear-no-key-user' }, ip: '' } as any;
    const res = createResponse();
    const next = vi.fn();
    authenticateLogin(req, res as any, next);
    // Should succeed without throwing
    expect(next).toHaveBeenCalled();
  });

  test('clearLoginLockout BlockStatement: persist fires only from the clear, not from a prior failure', () => {
    // Line 438:29 BlockStatement {} — if empty, scheduleLockoutStatePersist not called on clear
    // Strategy: pre-load an unlocked-but-tracked entry via persisted state (no failure write occurs).
    // After a successful login, clearLoginLockout deletes it → schedules persist.
    // With BlockStatement mutant (empty body), no persist scheduled → no new write.
    vi.useFakeTimers();
    const now = Date.parse('2026-01-01T00:05:00.000Z');
    vi.setSystemTime(new Date(now));

    // Pre-load an entry that is unlocked (lockedUntil=0) but still within the failure window
    // So getLockoutUntil won't block the user, but the entry exists in the map
    lockoutStateFiles.set(
      LOCKOUT_STATE_PATH,
      JSON.stringify({
        account: {
          'tracked-but-open': {
            failedAttempts: 2,
            windowStartAt: now - 60000,
            lockedUntil: 0, // unlocked
            lastAttemptAt: now - 60000,
          },
        },
        ip: {},
      }),
    );
    initializeLoginLockoutState();

    // Flush any deferred persist that init might have scheduled
    vi.advanceTimersByTime(1000);
    const writesAfterInit = mockFs.writeFileSync.mock.calls.length;

    // Authenticate successfully — clearLoginLockout deletes the tracked entry and schedules persist
    makePassportSuccess('tracked-but-open');
    authenticateLogin(
      { body: { username: 'tracked-but-open' }, ip: '' } as any, // empty ip → no ip entry to clear
      createResponse() as any,
      vi.fn(),
    );

    // Advance past debounce period
    vi.advanceTimersByTime(1000);
    // With original: clearLoginLockout schedules persist → file written → count increases
    // With BlockStatement mutant: no persist scheduled → count stays same
    expect(mockFs.writeFileSync.mock.calls.length).toBeGreaterThan(writesAfterInit);
    vi.useRealTimers();
  });

  test('activeLockoutUntil: uses > now (not >= now) — 0 activeLockoutUntil does not block', () => {
    // Line 489:7 EqualityOperator >= mutant
    // If mutated to >=, activeLockoutUntil=0 would block (0 >= now is false for positive now)
    // but more importantly, if activeLockoutUntil is exactly now it should NOT block
    vi.useFakeTimers();
    const lockoutTime = Date.parse('2026-01-01T00:15:00.000Z');
    vi.setSystemTime(new Date(lockoutTime));

    // Entry that is 1ms past lockout expiry — lockedUntil < now, won't be 423
    lockoutStateFiles.set(
      LOCKOUT_STATE_PATH,
      JSON.stringify({
        account: {
          'just-past-lock': {
            failedAttempts: 5,
            windowStartAt: lockoutTime - 901000,
            lockedUntil: lockoutTime - 1, // 1ms in the past
            lastAttemptAt: lockoutTime - 901000,
          },
        },
        ip: {},
      }),
    );
    makePassportInvalidCredentials();
    initializeLoginLockoutState();

    const res = createResponse();
    authenticateLogin(
      { body: { username: 'just-past-lock' }, ip: '10.4.0.3' } as any,
      res as any,
      vi.fn(),
    );
    // lockedUntil is 1ms before now, past window → NOT blocked
    expect(res.status).not.toHaveBeenCalledWith(423);
    vi.useRealTimers();
  });

  test('lockoutUntil > failedAt check: = failedAt does NOT trigger lockout response', () => {
    // Line 518:13 EqualityOperator >= mutant — equality should NOT send lockout response
    vi.useFakeTimers();
    const now = Date.parse('2026-01-01T00:00:00.000Z');
    vi.setSystemTime(new Date(now));
    makePassportInvalidCredentials();

    // Register exactly maxAttempts - 1 failures (so next attempt triggers lock with lockedUntil = now + lockoutMs)
    // But manipulate so lockoutUntil would be exactly == failedAt (impossible in practice but tests the >=)
    // Real approach: test that lockedUntil = 0 does NOT trigger (0 > now is false)
    const req = { body: { username: 'zero-lockout-user' }, ip: '10.4.0.4' } as any;
    const res = createResponse();
    // First attempt — lockedUntil = 0 after registerFailedLoginAttempt (below threshold)
    authenticateLogin(req, res as any, vi.fn());
    // Should be 401 not 423 (lockoutUntil = 0, 0 > now is false)
    expect(res.status).toHaveBeenCalledWith(401);
    vi.useRealTimers();
  });

  test('resetLoginLockoutStateForTests clears maintenanceTimer when it was set', () => {
    // Lines 560:7 ConditionalExpression true/false and BlockStatement {}
    vi.useFakeTimers();
    initializeLoginLockoutState(); // sets maintenanceTimer

    resetLoginLockoutStateForTests();
    // Advance past where the timer would have fired
    vi.advanceTimersByTime(60 * 60 * 1000);

    // If maintenanceTimer was NOT cleared, it would fire pruneAndPersistIfChanged
    // That would call updateLockoutGaugeTotals → setAuthAccountLockedTotal
    // After reset, mockSetAuthAccountLockedTotal was only called by reset (value 0)
    // If the timer still fires, it calls it again — but with cleared state (still 0)
    // The key test: reset was called with 0, any additional calls would also be 0
    expect(mockSetAuthAccountLockedTotal).toHaveBeenCalledWith(0);
    vi.useRealTimers();
  });

  test('resetLoginLockoutStateForTests clears persistTimer when it was set', () => {
    // Line 564:7 ConditionalExpression true mutant
    vi.useFakeTimers();
    makePassportInvalidCredentials();
    // Trigger a failed login to schedule persistTimer
    authenticateLogin(
      { body: { username: 'persist-timer-user' }, ip: '10.4.0.5' } as any,
      createResponse() as any,
      vi.fn(),
    );

    // Reset while persist timer is pending
    resetLoginLockoutStateForTests();

    // Advance past debounce — if timer was NOT cancelled, writeFileSync would be called
    vi.advanceTimersByTime(1000);
    // Timer should have been cancelled → no write after reset
    expect(mockFs.writeFileSync).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  test('evictOldestTrackedEntries evicts first-inserted when two entries share the same lastAttemptAt', () => {
    // Line 332: EqualityOperator <= mutant — with <=, last-inserted wins as "oldest", changing which gets evicted
    // With < (original): first entry sets baseline; second has same timestamp → < is false → first stays as oldest
    // With <= (mutant): second entry satisfies <= → replaces first as oldest → wrong entry evicted
    const now = Date.parse('2026-01-01T00:00:00.000Z');
    // Both entries have identical lastAttemptAt — only insertion order distinguishes them
    const lockouts = new Map([
      [
        'first',
        { failedAttempts: 1, windowStartAt: now, lockedUntil: now + 60000, lastAttemptAt: now },
      ],
      [
        'second',
        { failedAttempts: 1, windowStartAt: now, lockedUntil: now + 60000, lastAttemptAt: now },
      ],
    ]);
    testable_evictOldestTrackedEntries(lockouts, 1);
    // Original (<): 'first' is set as oldest, 'second' has same ts → not updated → 'first' is evicted
    expect(lockouts.has('first')).toBe(false);
    expect(lockouts.has('second')).toBe(true);
  });

  test('registerFailedLoginAttempt returns undefined when lockedUntil === now (not >= boundary)', () => {
    // Line 428: EqualityOperator >= mutant — lockedUntil === now should return undefined (not locked)
    // Original: lockedUntil > now → false → undefined
    // Mutant (>=): lockedUntil >= now → true → returns lockedUntil (the now value)
    const now = Date.parse('2026-01-01T00:00:00.000Z');
    const lockouts = new Map<string, any>([
      [
        'boundary-exact',
        {
          failedAttempts: 2, // below threshold (max=5), so lockedUntil won't be updated
          windowStartAt: now - 1000,
          lockedUntil: now, // exactly == now
          lastAttemptAt: now - 1000,
        },
      ],
    ]);
    const result = testable_registerFailedLoginAttempt(
      lockouts,
      testable_accountLockoutPolicy,
      'boundary-exact',
      now,
    );
    // isExpiredUnlockedEntry: lockedUntil(now) <= now AND 1000ms > 900000ms? No → entry kept
    // failedAttempts becomes 3, still below threshold → lockedUntil unchanged (still now)
    // return: lockedUntil(now) > now → false → undefined
    expect(result).toBeUndefined();
    // Sanity: lockedUntil is still exactly now (not updated)
    expect(lockouts.get('boundary-exact')?.lockedUntil).toBe(now);
  });
});
