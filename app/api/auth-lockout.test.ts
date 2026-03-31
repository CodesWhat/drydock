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
});
