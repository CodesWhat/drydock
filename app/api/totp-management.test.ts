vi.mock('../log/index.js', () => ({ default: { warn: vi.fn(), child: vi.fn() } }));

import { createManagementSessionGate, guarded } from './totp-management.js';

function response(headersSent: boolean) {
  const res = { headersSent, status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
}

describe('guarded', () => {
  test('answers 503 with a fixed body when a handler throws', async () => {
    const res = response(false);
    guarded(() => {
      throw Object.assign(new Error('secret detail'), { code: 'SQLITE_ERROR' });
    })({} as never, res as never, vi.fn());
    await vi.waitFor(() => expect(res.status).toHaveBeenCalledWith(503));
    expect(JSON.stringify(res.json.mock.calls)).not.toContain('secret detail');
  });

  test('leaves a response that has already started alone', async () => {
    const res = response(true);
    const handler = vi.fn(() => Promise.reject(new Error('late')));
    guarded(handler)({} as never, res as never, vi.fn());
    await vi.waitFor(() => expect(handler).toHaveBeenCalled());
    await new Promise((resolve) => setImmediate(resolve));
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe('the management session gate: transport', () => {
  const principal = {
    kind: 'session',
    username: 'scott',
    identity: {
      type: 'local',
      subjectId: 's'.repeat(64),
      providerId: 'basic.default',
      assurance: 'totp',
      factorVersion: 1,
      issuedAt: 1,
    },
  };

  function run(remoteAddress: string | undefined, allowPlainHttp = false) {
    const res = { locals: {}, set: vi.fn(), status: vi.fn(), json: vi.fn() };
    res.status.mockReturnValue(res);
    const next = vi.fn();
    createManagementSessionGate({ allowPlainHttp })(
      {
        method: 'POST',
        principal,
        secure: false,
        headers: { host: 'localhost:3000' },
        socket: { remoteAddress },
      } as never,
      res as never,
      next,
    );
    return { res, next };
  }

  test('an IPv4-mapped loopback peer counts as local', () => {
    expect(run('::ffff:127.0.0.1').next).toHaveBeenCalled();
  });

  test.each([['10.0.0.5'], ['::ffff:10.0.0.5'], [undefined]])(
    'a peer of %s is not local',
    (address) => {
      const { res, next } = run(address);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    },
  );

  test.each([['10.0.0.5'], ['::ffff:10.0.0.5'], [undefined]])(
    'with plain HTTP allowed, a peer of %s gets through',
    (address) => {
      const { res, next } = run(address, true);
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    },
  );
});
