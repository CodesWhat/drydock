// @ts-nocheck
import { createMockRequest, createMockResponse } from '../test/helpers.js';

const { mockRouter, mockGetAgent } = vi.hoisted(() => ({
  mockRouter: { get: vi.fn() },
  mockGetAgent: vi.fn(),
}));

vi.mock('express', () => ({
  default: { Router: vi.fn(() => mockRouter) },
}));

vi.mock('../agent', () => ({
  getAgents: vi.fn(() => []),
  getAgent: mockGetAgent,
}));

vi.mock('../store/container.js', () => ({
  getContainers: vi.fn(() => []),
}));

import { getAgents } from '../agent/index.js';
import { getContainers } from '../store/container.js';
import * as agentRouter from './agent.js';

function createResponse() {
  return createMockResponse();
}

describe('Agent Router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('should register GET / route on init', () => {
    const router = agentRouter.init();
    expect(router.get).toHaveBeenCalledWith('/', expect.any(Function));
  });

  test('should register GET /:name/log/entries route on init', () => {
    agentRouter.init();
    expect(mockRouter.get).toHaveBeenCalledWith('/:name/log/entries', expect.any(Function));
  });

  test('should return mapped agent list', () => {
    getAgents.mockReturnValue([
      {
        name: 'agent-1',
        config: { host: 'localhost', port: 3000 },
        isConnected: true,
        info: {
          version: '1.5.0',
          os: 'linux',
          arch: 'x64',
          cpus: 8,
          memoryGb: 31.4,
          uptimeSeconds: 3600,
          lastSeen: '2026-02-28T10:00:00.000Z',
        },
      },
      {
        name: 'agent-2',
        config: { host: 'remote', port: 4000 },
        isConnected: false,
        info: {},
      },
    ]);
    getContainers.mockImplementation((query) => {
      if (query?.agent !== 'agent-1') return [];
      return [
        { id: 'c1', status: 'running', image: { id: 'img-a' } },
        { id: 'c2', status: 'exited', image: { id: 'img-b' } },
        { id: 'c3', status: 'running', image: { id: 'img-a' } },
      ];
    });

    agentRouter.init();
    const handler = mockRouter.get.mock.calls.find((c) => c[0] === '/')[1];

    const res = createResponse();
    handler({}, res);

    expect(res.json).toHaveBeenCalledWith([
      {
        name: 'agent-1',
        host: 'localhost',
        port: 3000,
        connected: true,
        version: '1.5.0',
        os: 'linux',
        arch: 'x64',
        cpus: 8,
        memoryGb: 31.4,
        uptimeSeconds: 3600,
        lastSeen: '2026-02-28T10:00:00.000Z',
        containers: { total: 3, running: 2, stopped: 1 },
        images: 2,
      },
      {
        name: 'agent-2',
        host: 'remote',
        port: 4000,
        connected: false,
        containers: { total: 0, running: 0, stopped: 0 },
        images: 0,
      },
    ]);
  });

  test('should return empty array when no agents', () => {
    getAgents.mockReturnValue([]);

    agentRouter.init();
    const handler = mockRouter.get.mock.calls.find((c) => c[0] === '/')[1];

    const res = createResponse();
    handler({}, res);

    expect(res.json).toHaveBeenCalledWith([]);
  });
});

describe('Agent Log Entries Route', () => {
  let handler;

  beforeEach(() => {
    vi.clearAllMocks();
    agentRouter.init();
    handler = mockRouter.get.mock.calls.find((c) => c[0] === '/:name/log/entries')[1];
  });

  test('should return 404 when agent not found', async () => {
    mockGetAgent.mockReturnValue(undefined);

    const req = createMockRequest({ params: { name: 'nonexistent' } });
    const res = createResponse();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Agent not found' });
  });

  test('should return 503 when agent is not connected', async () => {
    mockGetAgent.mockReturnValue({ isConnected: false });

    const req = createMockRequest({ params: { name: 'agent-1' } });
    const res = createResponse();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ error: 'Agent is not connected' });
  });

  test('should proxy log entries from connected agent', async () => {
    const mockEntries = [{ timestamp: 1000, level: 'info', component: 'test', msg: 'hello' }];
    mockGetAgent.mockReturnValue({
      isConnected: true,
      getLogEntries: vi.fn().mockResolvedValue(mockEntries),
    });

    const req = createMockRequest({
      params: { name: 'agent-1' },
      query: { level: 'warn', tail: '50' },
    });
    const res = createResponse();

    await handler(req, res);

    const agent = mockGetAgent.mock.results[0].value;
    expect(agent.getLogEntries).toHaveBeenCalledWith({
      level: 'warn',
      component: undefined,
      tail: 50,
      since: undefined,
    });
    expect(res.json).toHaveBeenCalledWith(mockEntries);
  });

  test('should pass all query params to agent', async () => {
    mockGetAgent.mockReturnValue({
      isConnected: true,
      getLogEntries: vi.fn().mockResolvedValue([]),
    });

    const req = createMockRequest({
      params: { name: 'agent-1' },
      query: { level: 'error', component: 'docker', tail: '100', since: '5000' },
    });
    const res = createResponse();

    await handler(req, res);

    const agent = mockGetAgent.mock.results[0].value;
    expect(agent.getLogEntries).toHaveBeenCalledWith({
      level: 'error',
      component: 'docker',
      tail: 100,
      since: 5000,
    });
  });

  test('should return 502 when agent getLogEntries fails', async () => {
    mockGetAgent.mockReturnValue({
      isConnected: true,
      getLogEntries: vi.fn().mockRejectedValue(new Error('Connection refused')),
    });

    const req = createMockRequest({
      params: { name: 'agent-1' },
      query: {},
    });
    const res = createResponse();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Failed to fetch logs from agent: Connection refused',
    });
  });
});
