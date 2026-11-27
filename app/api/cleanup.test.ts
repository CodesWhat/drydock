import { createMockRequest, createMockResponse } from '../test/helpers.js';

const { mockRouter, mockServerConfig, mockPolicies, mockResolve, mockRun, mockLastRuns } =
  vi.hoisted(() => ({
    mockRouter: { use: vi.fn(), get: vi.fn(), post: vi.fn() },
    mockServerConfig: vi.fn(() => ({ feature: { containeractions: true } })),
    mockPolicies: vi.fn(),
    mockResolve: vi.fn(),
    mockRun: vi.fn(),
    mockLastRuns: vi.fn(),
  }));

vi.mock('express', () => ({ default: { Router: vi.fn(() => mockRouter) } }));
vi.mock('nocache', () => ({ default: vi.fn(() => 'nocache-middleware') }));
vi.mock('../log/index.js', () => ({
  default: { child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }) },
}));

vi.mock('../configuration/index.js', () => ({ getServerConfiguration: mockServerConfig }));
vi.mock('../cleanup/scheduler.js', () => ({ getCleanupPolicyList: mockPolicies }));
vi.mock('../cleanup/run.js', () => ({
  getLastCleanupRuns: mockLastRuns,
  resolvePolicyHosts: mockResolve,
  runCleanupOnHost: mockRun,
}));

import * as cleanupRouter from './cleanup.js';

type Handler = (
  req: unknown,
  res: ReturnType<typeof createMockResponse>,
  next?: () => void,
) => unknown;

function registered(method: 'get' | 'post', path: string): Handler[] {
  cleanupRouter.init();
  const call = (mockRouter[method].mock.calls as unknown[][]).find((entry) => entry[0] === path);
  return (call as unknown[]).slice(1) as Handler[];
}

const policy = { name: 'nightly' };

describe('cleanup api', () => {
  beforeEach(() => {
    mockServerConfig.mockReturnValue({ feature: { containeractions: true } });
    mockPolicies.mockReset().mockReturnValue([policy]);
    mockResolve.mockReset().mockReturnValue([{ id: 'docker.local' }, { id: 'docker.other' }]);
    mockRun.mockReset().mockImplementation(async (host: { id: string }) => ({ host: host.id }));
    mockLastRuns.mockReset().mockReturnValue([{ host: 'docker.local' }]);
  });

  test('GET / lists policies and last runs', () => {
    const [handler] = registered('get', '/');
    const res = createMockResponse();
    handler(createMockRequest(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      policies: [policy],
      lastRuns: [{ host: 'docker.local' }],
    });
  });

  describe('POST /run', () => {
    async function post(body: unknown) {
      const [confirm, handler] = registered('post', '/run');
      const res = createMockResponse();
      const next = vi.fn();
      const req = createMockRequest({ body, headers: {} });
      confirm(req, res, next);
      if (next.mock.calls.length > 0) {
        await handler(req, res);
      }
      return { res, next };
    }

    test('requires the confirmation header for a real run', async () => {
      const { res, next } = await post({ policy: 'nightly' });
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(428);
      expect(mockRun).not.toHaveBeenCalled();
    });

    test('a dry run needs no confirmation header', async () => {
      const { res } = await post({ policy: 'nightly', dryRun: true });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(mockRun).toHaveBeenCalledTimes(2);
      expect(mockRun).toHaveBeenCalledWith({ id: 'docker.local' }, policy, 'manual', true);
    });

    test('runs a confirmed policy on every host', async () => {
      const [, handler] = registered('post', '/run');
      const res = createMockResponse();
      await handler(createMockRequest({ body: { policy: 'nightly' }, headers: {} }), res);
      expect(mockRun).toHaveBeenCalledWith({ id: 'docker.local' }, policy, 'manual', undefined);
      expect(res.json).toHaveBeenCalledWith({
        data: [{ host: 'docker.local' }, { host: 'docker.other' }],
      });
    });

    test('limits the run to one host', async () => {
      const [, handler] = registered('post', '/run');
      const res = createMockResponse();
      await handler(createMockRequest({ body: { policy: 'nightly', host: 'docker.other' } }), res);
      expect(mockRun).toHaveBeenCalledTimes(1);
    });

    test('404s on an unknown policy or host', async () => {
      const [, handler] = registered('post', '/run');
      const unknownPolicy = createMockResponse();
      await handler(createMockRequest({ body: { policy: 'nope' } }), unknownPolicy);
      expect(unknownPolicy.status).toHaveBeenCalledWith(404);

      const unknownHost = createMockResponse();
      await handler(createMockRequest({ body: { policy: 'nightly', host: 'zzz' } }), unknownHost);
      expect(unknownHost.status).toHaveBeenCalledWith(404);

      const noBody = createMockResponse();
      await handler(createMockRequest({}), noBody);
      expect(noBody.status).toHaveBeenCalledWith(404);
    });

    test('403s when container actions are disabled', async () => {
      mockServerConfig.mockReturnValue({ feature: { containeractions: false } });
      const [, handler] = registered('post', '/run');
      const res = createMockResponse();
      await handler(createMockRequest({ body: { policy: 'nightly' } }), res);
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  test('a missing body counts as a real run for confirmation', () => {
    const [confirm] = registered('post', '/run');
    const res = createMockResponse();
    const next = vi.fn();
    confirm({ headers: {} }, res, next);
    expect(res.status).toHaveBeenCalledWith(428);
  });
});
