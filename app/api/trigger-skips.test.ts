import { createMockResponse } from '../test/helpers.js';

const { mockRouter } = vi.hoisted(() => ({ mockRouter: { get: vi.fn() } }));
const mockGetState = vi.hoisted(() => vi.fn());
const mockGetContainer = vi.hoisted(() => vi.fn());

vi.mock('../registry/index.js', () => ({ getState: mockGetState }));
vi.mock('../store/container.js', () => ({ getContainer: mockGetContainer }));

import { recordNotificationSkip, resetNotificationSkips } from '../triggers/notification-skips.js';
import {
  getTriggerSkips,
  registerTriggerSkipRoutes,
  TRIGGER_SKIPS_DEFAULT_LIMIT,
  TRIGGER_SKIPS_MAX_LIMIT,
} from './trigger-skips.js';

function call(params: Record<string, string>, query: Record<string, string> = {}) {
  const res = createMockResponse();
  getTriggerSkips({ params, query } as never, res);
  return res;
}

describe('trigger skips API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetNotificationSkips();
    mockGetState.mockReturnValue({
      trigger: { 'smtp.ops': {}, 'edge.slack.team': {} },
    });
    mockGetContainer.mockImplementation((id: string) =>
      id === 'c1' ? { id: 'c1', name: 'web' } : undefined,
    );
  });

  test('registers both routes behind the read scope', () => {
    registerTriggerSkipRoutes(mockRouter as never);
    expect(mockRouter.get).toHaveBeenCalledWith('/:type/:name/skips', expect.any(Function));
    expect(mockRouter.get).toHaveBeenCalledWith('/:type/:name/:agent/skips', expect.any(Function));
  });

  test('404s for an unknown trigger', () => {
    const res = call({ type: 'smtp', name: 'nope' });
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns skips newest first with container names', () => {
    recordNotificationSkip('smtp.ops', 'c1', 'threshold-not-met', 'secret detail');
    recordNotificationSkip('smtp.ops', 'gone', 'rule-disabled');
    recordNotificationSkip('other.t', 'c1', 'rule-disabled');

    const res = call({ type: 'smtp', name: 'ops' });

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      data: [
        {
          containerId: 'gone',
          containerName: null,
          reason: 'rule-disabled',
          at: expect.any(String),
        },
        {
          containerId: 'c1',
          containerName: 'web',
          reason: 'threshold-not-met',
          at: expect.any(String),
        },
      ],
      total: 2,
      limit: TRIGGER_SKIPS_DEFAULT_LIMIT,
      offset: 0,
      hasMore: false,
    });
  });

  test('resolves an agent-qualified trigger id', () => {
    recordNotificationSkip('edge.slack.team', 'c1', 'digest-buffered');
    const res = call({ agent: 'edge', type: 'slack', name: 'team' });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ total: 1, data: [expect.objectContaining({ containerId: 'c1' })] }),
    );
  });

  test('paginates and caps the limit', () => {
    for (let i = 0; i < 5; i += 1) {
      recordNotificationSkip('smtp.ops', `c${i}`, 'rule-disabled');
    }
    let res = call({ type: 'smtp', name: 'ops' }, { limit: '2', offset: '1' });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        total: 5,
        limit: 2,
        offset: 1,
        hasMore: true,
        data: [
          expect.objectContaining({ containerId: 'c3' }),
          expect.objectContaining({ containerId: 'c2' }),
        ],
      }),
    );
    res = call({ type: 'smtp', name: 'ops' }, { limit: '99999' });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ limit: TRIGGER_SKIPS_MAX_LIMIT }),
    );
  });
});
