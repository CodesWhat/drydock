const { mockDestroyOthers, mockEnforce, mockWrite, mockApply, mockWarn } = vi.hoisted(() => ({
  mockDestroyOthers: vi.fn(),
  mockEnforce: vi.fn(),
  mockWrite: vi.fn(),
  mockApply: vi.fn(),
  mockWarn: vi.fn(),
}));

vi.mock('../log/index.js', () => ({ default: { warn: mockWarn, child: vi.fn() } }));
vi.mock('../util/session-limit.js', () => ({ destroyOtherSubjectSessions: mockDestroyOthers }));
vi.mock('./auth-remember-me.js', () => ({ applyRememberMe: mockApply }));
vi.mock('./auth-session.js', () => ({ enforceSessionLimitBeforeLogin: mockEnforce }));
vi.mock('./session-principal.js', () => ({ writeSessionPrincipal: mockWrite }));

import type { AuthRequest } from './auth-types.js';
import { replaceSessionAfterFactorChange } from './totp-session.js';

const principal = {
  kind: 'basic',
  username: 'scott',
  identity: {
    subjectId: 's'.repeat(64),
    providerId: 'basic.default',
    assurance: 'totp',
    factorVersion: 1,
    issuedAt: 1,
  },
} as const;

function request(overrides: Record<string, unknown> = {}): AuthRequest {
  const req: Record<string, unknown> = {
    session: {
      rememberMe: true,
      regenerate: (done: (error?: unknown) => void) => done(),
    },
    sessionStore: { destroy: vi.fn() },
    sessionID: 'fresh',
    ...overrides,
  };
  return req as unknown as AuthRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEnforce.mockImplementation(
    (_req: unknown, _name: string, onSuccess: () => Promise<void>) => void onSuccess(),
  );
  mockDestroyOthers.mockResolvedValue(0);
});

describe('replaceSessionAfterFactorChange', () => {
  test('regenerates, keeps remember-me, writes the principal and destroys the others', async () => {
    const req = request();
    await expect(replaceSessionAfterFactorChange(req, principal)).resolves.toBe(true);
    expect((req.session as { rememberMe?: boolean }).rememberMe).toBe(true);
    expect(mockApply).toHaveBeenCalledWith(req);
    expect(mockWrite).toHaveBeenCalledWith(req, principal);
    expect(mockDestroyOthers).toHaveBeenCalledWith({
      subjectId: principal.identity.subjectId,
      username: 'scott',
      sessionStore: (req as unknown as { sessionStore: unknown }).sessionStore,
      currentSessionId: 'fresh',
    });
  });

  test('a session that did not ask to be remembered is not', async () => {
    const req = request({
      session: { regenerate: (done: () => void) => done() },
    });
    await replaceSessionAfterFactorChange(req, principal);
    expect((req.session as { rememberMe?: boolean }).rememberMe).toBe(false);
  });

  test('without a session store it still succeeds and has no others to destroy', async () => {
    await expect(
      replaceSessionAfterFactorChange(request({ sessionStore: undefined }), principal),
    ).resolves.toBe(true);
    expect(mockDestroyOthers).not.toHaveBeenCalled();
  });

  test('failing to destroy the others is logged and does not undo the new session', async () => {
    mockDestroyOthers.mockRejectedValue(new Error('store down'));
    await expect(replaceSessionAfterFactorChange(request(), principal)).resolves.toBe(true);
    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('store down'));
  });

  test.each([
    ['no session', { session: undefined }],
    ['a session that cannot regenerate', { session: {} }],
  ])('%s resolves false', async (_name, overrides) => {
    await expect(replaceSessionAfterFactorChange(request(overrides), principal)).resolves.toBe(
      false,
    );
    expect(mockWrite).not.toHaveBeenCalled();
  });

  test('a regeneration error resolves false', async () => {
    const req = request({
      session: { regenerate: (done: (error: Error) => void) => done(new Error('boom')) },
    });
    await expect(replaceSessionAfterFactorChange(req, principal)).resolves.toBe(false);
    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });

  test('a session that vanishes after regeneration resolves false', async () => {
    const req = request();
    (req.session as { regenerate: unknown }).regenerate = (done: () => void) => {
      (req as unknown as { session: undefined }).session = undefined;
      done();
    };
    await expect(replaceSessionAfterFactorChange(req, principal)).resolves.toBe(false);
  });

  test('a session limit failure resolves false', async () => {
    mockEnforce.mockImplementation(
      (_req: unknown, _name: string, _ok: unknown, onFailure: (message: string) => void) =>
        onFailure('limit store down'),
    );
    await expect(replaceSessionAfterFactorChange(request(), principal)).resolves.toBe(false);
  });
});
