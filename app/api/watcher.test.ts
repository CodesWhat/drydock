import * as agentManager from '../agent/manager.js';
import * as registry from '../registry/index.js';
import * as watcherRouter from './watcher.js';

vi.mock('../registry/index.js', () => ({
  getState: vi.fn(),
}));

vi.mock('../agent/manager.js', () => ({
  getAgent: vi.fn(),
}));

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
          metadata: { nextRunAt: '2026-04-09T13:00:00.000Z' },
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
          metadata: { nextRunAt: '2026-04-09T12:45:00.000Z' },
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
      metadata: { nextRunAt: '2026-04-09T12:45:00.000Z' },
    });
  });

  test('getWatcher should return 404 when watcher is missing', async () => {
    registry.getState.mockReturnValue({ watcher: {} });

    const res = createMockResponse();
    await watcherRouter.getWatcher({ params: { type: 'docker', name: 'missing' } }, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Component not found' });
  });
});
