import * as agentManager from '../agent/manager.js';
import * as registry from '../registry/index.js';
import * as storeContainer from '../store/container.js';
import * as watcherRouter from './watcher.js';

vi.mock('../registry/index.js', () => ({
  getState: vi.fn(),
}));

vi.mock('../agent/manager.js', () => ({
  getAgent: vi.fn(),
}));

vi.mock('../store/container.js', () => ({
  getContainersRaw: vi.fn(() => []),
}));

const EMPTY_WATCHER_STATS = {
  containers: { total: 0, running: 0, stopped: 0, updatesAvailable: 0 },
  images: 0,
};

function createMockResponse() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  };
}

describe('Watcher Router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('getWatchers should return local watcher metadata', async () => {
    registry.getState.mockReturnValue({
      watcher: {
        'docker.local': {
          type: 'docker',
          name: 'local',
          configuration: { cron: '0 * * * *' },
          maskConfiguration: vi.fn(() => ({ cron: '0 * * * *' })),
          getMetadata: vi.fn(() => ({ nextRunAt: '2026-04-09T13:00:00.000Z' })),
        },
      },
    });

    const res = createMockResponse();
    await watcherRouter.getWatchers({ query: {} }, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      data: [
        {
          id: 'docker.local',
          type: 'docker',
          name: 'local',
          configuration: { cron: '0 * * * *' },
          agent: undefined,
          metadata: { nextRunAt: '2026-04-09T13:00:00.000Z', ...EMPTY_WATCHER_STATS },
        },
      ],
      total: 1,
      limit: 0,
      offset: 0,
      hasMore: false,
    });
  });

  test('getWatchers should merge fresh metadata from agent-backed watchers', async () => {
    registry.getState.mockReturnValue({
      watcher: {
        'edge.docker.remote': {
          type: 'docker',
          name: 'remote',
          agent: 'edge',
          configuration: { cron: '0 * * * *' },
          maskConfiguration: vi.fn(() => ({ cron: '0 * * * *' })),
          getMetadata: vi.fn(() => ({})),
        },
      },
    });
    agentManager.getAgent.mockReturnValue({
      getWatcher: vi.fn().mockResolvedValue({
        id: 'docker.remote',
        type: 'docker',
        name: 'remote',
        configuration: { cron: '*/15 * * * *' },
        metadata: { nextRunAt: '2026-04-09T12:45:00.000Z' },
      }),
    });

    const res = createMockResponse();
    await watcherRouter.getWatchers({ query: {} }, res);

    expect(res.json).toHaveBeenCalledWith({
      data: [
        {
          id: 'edge.docker.remote',
          type: 'docker',
          name: 'remote',
          configuration: { cron: '*/15 * * * *' },
          agent: 'edge',
          metadata: { nextRunAt: '2026-04-09T12:45:00.000Z', ...EMPTY_WATCHER_STATS },
        },
      ],
      total: 1,
      limit: 0,
      offset: 0,
      hasMore: false,
    });
  });

  test('getWatcher should return a specific agent-backed watcher with refreshed metadata', async () => {
    registry.getState.mockReturnValue({
      watcher: {
        'edge.docker.remote': {
          type: 'docker',
          name: 'remote',
          agent: 'edge',
          configuration: { cron: '0 * * * *' },
          maskConfiguration: vi.fn(() => ({ cron: '0 * * * *' })),
          getMetadata: vi.fn(() => ({})),
        },
      },
    });
    agentManager.getAgent.mockReturnValue({
      getWatcher: vi.fn().mockResolvedValue({
        id: 'docker.remote',
        type: 'docker',
        name: 'remote',
        configuration: { cron: '*/15 * * * *' },
        metadata: { nextRunAt: '2026-04-09T12:45:00.000Z' },
      }),
    });

    const res = createMockResponse();
    await watcherRouter.getWatcher(
      { params: { type: 'docker', name: 'remote', agent: 'edge' } },
      res,
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      id: 'edge.docker.remote',
      type: 'docker',
      name: 'remote',
      configuration: { cron: '*/15 * * * *' },
      agent: 'edge',
      metadata: { nextRunAt: '2026-04-09T12:45:00.000Z', ...EMPTY_WATCHER_STATS },
    });
  });

  test('getWatcher should return 404 when watcher is missing', async () => {
    registry.getState.mockReturnValue({ watcher: {} });

    const res = createMockResponse();
    await watcherRouter.getWatcher({ params: { type: 'docker', name: 'missing' } }, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Component not found' });
  });

  test('getWatchers should sort, paginate, and report hasMore', async () => {
    registry.getState.mockReturnValue({
      watcher: {
        'docker.zeta': {
          type: 'docker',
          name: 'zeta',
          configuration: { cron: '0 * * * *' },
          maskConfiguration: vi.fn(() => ({ cron: '0 * * * *' })),
          getMetadata: vi.fn(() => ({ nextRunAt: '2026-04-09T13:00:00.000Z' })),
        },
        'docker.alpha': {
          type: 'docker',
          name: 'alpha',
          configuration: { cron: '*/5 * * * *' },
          maskConfiguration: vi.fn(() => ({ cron: '*/5 * * * *' })),
          getMetadata: vi.fn(() => ({ nextRunAt: '2026-04-09T12:05:00.000Z' })),
        },
        'slack.notify': {
          type: 'slack',
          name: 'notify',
          configuration: { channel: '#ops' },
          maskConfiguration: vi.fn(() => ({ channel: '#ops' })),
          getMetadata: vi.fn(() => ({ ready: true })),
        },
      },
    });

    const res = createMockResponse();
    await watcherRouter.getWatchers({ query: { limit: '1', offset: '1' } }, res);

    expect(res.json).toHaveBeenCalledWith({
      data: [
        {
          id: 'docker.zeta',
          type: 'docker',
          name: 'zeta',
          configuration: { cron: '0 * * * *' },
          agent: undefined,
          metadata: { nextRunAt: '2026-04-09T13:00:00.000Z', ...EMPTY_WATCHER_STATS },
        },
      ],
      total: 3,
      limit: 1,
      offset: 1,
      hasMore: true,
    });
  });

  test('getWatchers should return an empty page when offset exceeds result count', async () => {
    registry.getState.mockReturnValue({
      watcher: {
        'docker.local': {
          type: 'docker',
          name: 'local',
          configuration: { cron: '0 * * * *' },
          maskConfiguration: vi.fn(() => ({ cron: '0 * * * *' })),
          getMetadata: vi.fn(() => ({ nextRunAt: '2026-04-09T13:00:00.000Z' })),
        },
      },
    });

    const res = createMockResponse();
    await watcherRouter.getWatchers({ query: { offset: '5' } }, res);

    expect(res.json).toHaveBeenCalledWith({
      data: [],
      total: 1,
      limit: 0,
      offset: 5,
      hasMore: false,
    });
  });

  test('getWatchers should return an empty list when the registry has no watcher map', async () => {
    registry.getState.mockReturnValue({});

    const res = createMockResponse();
    await watcherRouter.getWatchers({ query: {} }, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      data: [],
      total: 0,
      limit: 0,
      offset: 0,
      hasMore: false,
    });
  });

  test('getWatchers should fall back to local metadata when no agent client is available', async () => {
    registry.getState.mockReturnValue({
      watcher: {
        'edge.docker.remote': {
          type: 'docker',
          name: 'remote',
          agent: 'edge',
          configuration: { cron: '0 * * * *' },
          maskConfiguration: vi.fn(() => ({ cron: '0 * * * *' })),
          getMetadata: vi.fn(() => ({ nextRunAt: '2026-04-09T13:00:00.000Z' })),
        },
      },
    });
    agentManager.getAgent.mockReturnValue(undefined);

    const res = createMockResponse();
    await watcherRouter.getWatchers({ query: {} }, res);

    expect(res.json).toHaveBeenCalledWith({
      data: [
        {
          id: 'edge.docker.remote',
          type: 'docker',
          name: 'remote',
          configuration: { cron: '0 * * * *' },
          agent: 'edge',
          metadata: { nextRunAt: '2026-04-09T13:00:00.000Z', ...EMPTY_WATCHER_STATS },
        },
      ],
      total: 1,
      limit: 0,
      offset: 0,
      hasMore: false,
    });
  });

  test('getWatchers should keep fallback configuration when remote refresh omits fields', async () => {
    registry.getState.mockReturnValue({
      watcher: {
        'edge.docker.remote': {
          type: 'docker',
          name: 'remote',
          agent: 'edge',
          configuration: { cron: '0 * * * *' },
          maskConfiguration: vi.fn(() => ({ cron: '0 * * * *' })),
          getMetadata: vi.fn(() => ({ nextRunAt: '2026-04-09T13:00:00.000Z' })),
        },
      },
    });
    agentManager.getAgent.mockReturnValue({
      getWatcher: vi.fn().mockResolvedValue({
        id: 'docker.remote',
        type: 'docker',
        name: 'remote',
        configuration: undefined,
        metadata: undefined,
      }),
    });

    const res = createMockResponse();
    await watcherRouter.getWatchers({ query: {} }, res);

    expect(res.json).toHaveBeenCalledWith({
      data: [
        {
          id: 'edge.docker.remote',
          type: 'docker',
          name: 'remote',
          configuration: { cron: '0 * * * *' },
          agent: 'edge',
          metadata: { nextRunAt: '2026-04-09T13:00:00.000Z', ...EMPTY_WATCHER_STATS },
        },
      ],
      total: 1,
      limit: 0,
      offset: 0,
      hasMore: false,
    });
  });

  test('getWatchers should fall back when refreshing remote watcher metadata throws', async () => {
    registry.getState.mockReturnValue({
      watcher: {
        'edge.docker.remote': {
          type: 'docker',
          name: 'remote',
          agent: 'edge',
          configuration: { cron: '0 * * * *' },
          maskConfiguration: vi.fn(() => ({ cron: '0 * * * *' })),
          getMetadata: vi.fn(() => ({ nextRunAt: '2026-04-09T13:00:00.000Z' })),
        },
      },
    });
    agentManager.getAgent.mockReturnValue({
      getWatcher: vi.fn().mockRejectedValue(new Error('refresh failed')),
    });

    const res = createMockResponse();
    await watcherRouter.getWatchers({ query: {} }, res);

    expect(res.json).toHaveBeenCalledWith({
      data: [
        {
          id: 'edge.docker.remote',
          type: 'docker',
          name: 'remote',
          configuration: { cron: '0 * * * *' },
          agent: 'edge',
          metadata: { nextRunAt: '2026-04-09T13:00:00.000Z', ...EMPTY_WATCHER_STATS },
        },
      ],
      total: 1,
      limit: 0,
      offset: 0,
      hasMore: false,
    });
  });

  test('init should wire all watcher routes to the exported handlers', async () => {
    registry.getState.mockReturnValue({
      watcher: {
        'docker.local': {
          type: 'docker',
          name: 'local',
          configuration: { cron: '0 * * * *' },
          maskConfiguration: vi.fn(() => ({ cron: '0 * * * *' })),
          getMetadata: vi.fn(() => ({ nextRunAt: '2026-04-09T13:00:00.000Z' })),
        },
        'edge.docker.remote': {
          type: 'docker',
          name: 'remote',
          agent: 'edge',
          configuration: { cron: '*/15 * * * *' },
          maskConfiguration: vi.fn(() => ({ cron: '*/15 * * * *' })),
          getMetadata: vi.fn(() => ({ nextRunAt: '2026-04-09T12:45:00.000Z' })),
        },
      },
    });
    agentManager.getAgent.mockReturnValue({
      getWatcher: vi.fn().mockResolvedValue({
        id: 'docker.remote',
        type: 'docker',
        name: 'remote',
        configuration: { cron: '*/15 * * * *' },
        metadata: { nextRunAt: '2026-04-09T12:45:00.000Z' },
      }),
    });

    const router = watcherRouter.init() as unknown as {
      stack: Array<{
        route?: {
          path: string;
          stack: Array<{ handle: (req: unknown, res: unknown) => unknown }>;
        };
      }>;
    };

    const listLayer = router.stack.find((layer) => layer.route?.path === '/');
    const watcherLayer = router.stack.find((layer) => layer.route?.path === '/:type/:name');
    const agentWatcherLayer = router.stack.find(
      (layer) => layer.route?.path === '/:type/:name/:agent',
    );
    if (!listLayer?.route || !watcherLayer?.route || !agentWatcherLayer?.route) {
      throw new Error('Expected watcher routes to be registered');
    }

    const listRes = createMockResponse();
    await listLayer.route.stack[0].handle({ query: {} }, listRes);
    await Promise.resolve();
    await Promise.resolve();
    expect(listRes.status).toHaveBeenCalledWith(200);

    const watcherRes = createMockResponse();
    await watcherLayer.route.stack[0].handle(
      { params: { type: 'docker', name: 'local' } },
      watcherRes,
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(watcherRes.status).toHaveBeenCalledWith(200);

    const agentWatcherRes = createMockResponse();
    await agentWatcherLayer.route.stack[0].handle(
      { params: { type: 'docker', name: 'remote', agent: 'edge' } },
      agentWatcherRes,
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(agentWatcherRes.status).toHaveBeenCalledWith(200);
  });

  test('getWatchers should populate per-watcher container and image stats from store (#301)', async () => {
    registry.getState.mockReturnValue({
      watcher: {
        'docker.primary': {
          type: 'docker',
          name: 'primary',
          configuration: { cron: '0 * * * *' },
          maskConfiguration: vi.fn(() => ({ cron: '0 * * * *' })),
          getMetadata: vi.fn(() => ({})),
        },
        'docker.secondary': {
          type: 'docker',
          name: 'secondary',
          configuration: { cron: '*/5 * * * *' },
          maskConfiguration: vi.fn(() => ({ cron: '*/5 * * * *' })),
          getMetadata: vi.fn(() => ({})),
        },
      },
    });
    storeContainer.getContainersRaw.mockReturnValue([
      {
        id: 'c1',
        watcher: 'primary',
        status: 'running',
        updateAvailable: true,
        image: { id: 'img-a', name: 'nginx:1' },
      },
      {
        id: 'c2',
        watcher: 'primary',
        status: 'exited',
        updateAvailable: false,
        image: { id: 'img-a', name: 'nginx:1' },
      },
      {
        id: 'c3',
        watcher: 'primary',
        status: 'running',
        updateAvailable: false,
        image: { id: 'img-b', name: 'grafana:10' },
      },
      {
        id: 'c4',
        watcher: 'secondary',
        status: 'running',
        updateAvailable: false,
        image: { id: 'img-c', name: 'redis:7' },
      },
      {
        id: 'c5',
        watcher: 'unrelated',
        status: 'running',
        updateAvailable: false,
        image: { id: 'img-z', name: 'other:1' },
      },
    ]);

    const res = createMockResponse();
    await watcherRouter.getWatchers({ query: {} }, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    const primary = payload.data.find((item) => item.id === 'docker.primary');
    const secondary = payload.data.find((item) => item.id === 'docker.secondary');

    expect(primary.metadata).toEqual({
      containers: { total: 3, running: 2, stopped: 1, updatesAvailable: 1 },
      images: 2,
    });
    expect(secondary.metadata).toEqual({
      containers: { total: 1, running: 1, stopped: 0, updatesAvailable: 0 },
      images: 1,
    });
  });

  test('getWatcher should populate stats for the single watcher and skip unrelated containers (#301)', async () => {
    registry.getState.mockReturnValue({
      watcher: {
        'docker.primary': {
          type: 'docker',
          name: 'primary',
          configuration: { cron: '0 * * * *' },
          maskConfiguration: vi.fn(() => ({ cron: '0 * * * *' })),
          getMetadata: vi.fn(() => ({})),
        },
      },
    });
    storeContainer.getContainersRaw.mockReturnValue([
      {
        id: 'c1',
        watcher: 'primary',
        status: 'running',
        updateAvailable: true,
        image: { id: 'img-a' },
      },
      {
        id: 'c2',
        watcher: 'other',
        status: 'running',
        updateAvailable: true,
        image: { id: 'img-z' },
      },
    ]);

    const res = createMockResponse();
    await watcherRouter.getWatcher({ params: { type: 'docker', name: 'primary' } }, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.metadata).toEqual({
      containers: { total: 1, running: 1, stopped: 0, updatesAvailable: 1 },
      images: 1,
    });
  });
});
