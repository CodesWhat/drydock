/**
 * The full notification-triggers path: category guard, then the real handlers.
 * An aliased action (agent folded into the type or name segment) passes the
 * guard because it classifies as notification, so the handlers have to be the
 * ones that refuse it. Percent-encoded dots are decoded by Express before the
 * handlers see them, so the decoded form is what is exercised here.
 */
import { createMockResponse } from '../test/helpers.js';

const { mockRouter, mockGetState, mockGetContainer, mockGetAgent } = vi.hoisted(() => ({
  mockRouter: { use: vi.fn(), get: vi.fn(), post: vi.fn() },
  mockGetState: vi.fn(),
  mockGetContainer: vi.fn(),
  mockGetAgent: vi.fn(),
}));

vi.mock('./component', () => ({ init: vi.fn(() => mockRouter) }));
vi.mock('../registry', () => ({ getState: mockGetState }));
vi.mock('../store/container.js', () => ({ getContainer: mockGetContainer }));
vi.mock('../agent', () => ({ getAgent: mockGetAgent }));
vi.mock('../log', () => ({
  default: { child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

import * as requestUpdate from '../updates/request-update.js';
import * as triggerRoutes from './trigger-routes.js';

const key = { kind: 'api-key', keyId: 'abcdef012345', name: 'ci', scopes: ['triggers:test'] };

function route(path: string) {
  const call = mockRouter.post.mock.calls.find((c) => c[0] === path);
  return { guard: call[1], handler: call[2] };
}

describe('notification-triggers route with an aliased action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    triggerRoutes._resetLegacyTriggerRouteWarningForTests();
  });

  test.each([
    ['edge1.docker', 'update'],
    ['edge1.command', 'run'],
    ['edge1.dockercompose', 'update'],
  ])('refuses %s/%s end to end without running the agent trigger', async (type, name) => {
    const [agentName, provider] = type.split('.');
    const proxy = {
      type: provider,
      name,
      agent: agentName,
      trigger: vi.fn().mockResolvedValue(undefined),
    };
    mockGetState.mockReturnValue({ trigger: { [`${agentName}.${provider}.${name}`]: proxy } });
    const spy = vi.spyOn(requestUpdate, 'requestContainerUpdate');
    triggerRoutes.initNotificationTriggers();
    const { guard, handler } = route('/:type/:name');
    const req = { params: { type, name }, body: { id: 'c1' }, principal: key };
    const res = createMockResponse();
    const next = vi.fn();

    guard(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(proxy.trigger).not.toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
    expect(mockGetAgent).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
