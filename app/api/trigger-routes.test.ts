import { createMockResponse } from '../test/helpers.js';

const { mockRouter, mockLog, mockComponentInit } = vi.hoisted(() => {
  const router = { use: vi.fn(), get: vi.fn(), post: vi.fn() };
  return {
    mockRouter: router,
    mockLog: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    mockComponentInit: vi.fn(() => router),
  };
});

vi.mock('./component', () => ({ init: mockComponentInit }));
vi.mock('./trigger-skips', () => ({ getTriggerSkips: vi.fn() }));
vi.mock('./trigger', () => ({ runTrigger: vi.fn(), runRemoteTrigger: vi.fn() }));
vi.mock('../log', () => ({ default: { child: () => mockLog } }));

import * as triggerRoutes from './trigger-routes.js';

function getFilter() {
  return mockComponentInit.mock.calls.at(-1)[1] as (c: { type: string }) => boolean;
}

function getGuard() {
  return mockRouter.post.mock.calls.find((c) => c[0] === '/:type/:name')[1];
}

describe('trigger category routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    triggerRoutes._resetLegacyTriggerRouteWarningForTests();
  });

  describe('skip routes', () => {
    test('registers guarded skip routes before the by-id routes', () => {
      triggerRoutes.initNotificationTriggers();
      const hook = mockComponentInit.mock.calls.at(-1)[2] as (r: typeof mockRouter) => void;
      hook(mockRouter);

      expect(mockRouter.get).toHaveBeenCalledWith(
        '/:type/:name/skips',
        expect.any(Function),
        expect.any(Function),
      );
      expect(mockRouter.get).toHaveBeenCalledWith(
        '/:type/:name/:agent/skips',
        expect.any(Function),
        expect.any(Function),
      );
    });
  });

  describe('initActions', () => {
    test('exposes only action triggers and registers run routes behind a category guard', () => {
      triggerRoutes.initActions();

      expect(mockComponentInit).toHaveBeenCalledWith(
        'trigger',
        expect.any(Function),
        expect.any(Function),
      );
      const filter = getFilter();
      expect(filter({ type: 'docker' })).toBe(true);
      expect(filter({ type: 'dockercompose' })).toBe(true);
      expect(filter({ type: 'portainer' })).toBe(true);
      expect(filter({ type: 'command' })).toBe(true);
      expect(filter({ type: 'slack' })).toBe(false);
      expect(mockRouter.post).toHaveBeenCalledWith(
        '/:type/:name',
        expect.any(Function),
        expect.any(Function),
      );
      expect(mockRouter.post).toHaveBeenCalledWith(
        '/:type/:name/:agent',
        expect.any(Function),
        expect.any(Function),
      );
    });

    test('guard passes action types and 404s notification types', () => {
      triggerRoutes.initActions();
      const guard = getGuard();

      const next = vi.fn();
      guard({ params: { type: 'docker' } }, createMockResponse(), next);
      expect(next).toHaveBeenCalledTimes(1);

      const res = createMockResponse();
      const blocked = vi.fn();
      guard({ params: { type: 'slack' } }, res, blocked);
      expect(blocked).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe('initNotificationTriggers', () => {
    test('exposes only notification triggers', () => {
      triggerRoutes.initNotificationTriggers();

      const filter = getFilter();
      expect(filter({ type: 'slack' })).toBe(true);
      expect(filter({ type: 'docker' })).toBe(false);
    });

    test('guard passes notification types and 404s action types', () => {
      triggerRoutes.initNotificationTriggers();
      const guard = getGuard();

      const next = vi.fn();
      guard({ params: { type: 'smtp' } }, createMockResponse(), next);
      expect(next).toHaveBeenCalledTimes(1);

      const res = createMockResponse();
      guard({ params: { type: 'command' } }, res, vi.fn());
      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe('deprecateLegacyTriggerRoutes', () => {
    function run(path: string, baseUrl = '/api/v1/triggers') {
      const res = { setHeader: vi.fn() };
      const next = vi.fn();
      triggerRoutes.deprecateLegacyTriggerRoutes({ path, baseUrl } as never, res as never, next);
      expect(next).toHaveBeenCalledTimes(1);
      return res.setHeader.mock.calls;
    }

    test('list route points at both successors', () => {
      expect(run('/')).toEqual([
        ['Deprecation', 'true'],
        [
          'Link',
          '</api/v1/actions>; rel="successor-version", </api/v1/notification-triggers>; rel="successor-version"',
        ],
      ]);
    });

    test('action detail route points at /actions with the same path', () => {
      expect(run('/docker/local')[1]).toEqual([
        'Link',
        '</api/v1/actions/docker/local>; rel="successor-version"',
      ]);
    });

    test('notification agent route points at /notification-triggers', () => {
      expect(run('/slack/alerts/agent1')[1]).toEqual([
        'Link',
        '</api/v1/notification-triggers/slack/alerts/agent1>; rel="successor-version"',
      ]);
    });

    test('malformed percent-encoding falls back to the raw type', () => {
      expect(run('/%E0%A4%A/x')[1][1]).toContain('/api/v1/notification-triggers/%E0%A4%A/x');
    });

    test('logs the deprecation warning once per process', () => {
      run('/');
      run('/slack/a');
      expect(mockLog.warn).toHaveBeenCalledTimes(1);
      expect(mockLog.warn.mock.calls[0][0]).toContain('v1.9.0');
    });
  });
});
