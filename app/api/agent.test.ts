import fs from 'node:fs';
import path from 'node:path';
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
  getContainersRaw: vi.fn(() => []),
}));

import { getAgents } from '../agent/index.js';
import { getContainersRaw } from '../store/container.js';
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
    getContainersRaw.mockReturnValue([
      { id: 'c1', agent: 'agent-1', status: 'running', image: { id: 'img-a' } },
      { id: 'c2', agent: 'agent-1', status: 'exited', image: { id: 'img-b' } },
      { id: 'c3', agent: 'agent-1', status: 'running', image: { id: 'img-a' } },
    ]);

    agentRouter.init();
    const handler = mockRouter.get.mock.calls.find((c) => c[0] === '/')[1];

    const res = createResponse();
    handler({}, res);

    expect(res.json).toHaveBeenCalledWith({
      data: [
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
          containers: { total: 3, running: 2, stopped: 1, updatesAvailable: 0 },
          images: 2,
        },
        {
          name: 'agent-2',
          host: 'remote',
          port: 4000,
          connected: false,
          containers: { total: 0, running: 0, stopped: 0, updatesAvailable: 0 },
          images: 0,
        },
      ],
      total: 2,
    });
    expect(getContainersRaw).toHaveBeenCalledTimes(1);
  });

  test('should fetch containers once for agent list stats', () => {
    getAgents.mockReturnValue([
      {
        name: 'agent-1',
        config: { host: 'localhost', port: 3000 },
        isConnected: true,
        info: {},
      },
      {
        name: 'agent-2',
        config: { host: 'remote', port: 4000 },
        isConnected: false,
        info: {},
      },
    ]);
    getContainersRaw.mockReturnValue([]);

    agentRouter.init();
    const handler = mockRouter.get.mock.calls.find((c) => c[0] === '/')[1];
    const res = createResponse();
    handler({}, res);

    expect(getContainersRaw).toHaveBeenCalledTimes(1);
  });

  test('should compute per-agent stats in a single pass regardless of agent count (#301 regression)', () => {
    // 10 agents × 60 containers = 600 rows. Pre-fix: 3 filter passes per
    // agent meant 10 × 3 × 60 = 1800 predicate evaluations. Post-fix: a
    // single pass over 600 containers. We can't measure flops directly in
    // a unit test, but we CAN assert the store is hit exactly once and the
    // response shape is correct no matter how many agents there are.
    const agents = Array.from({ length: 10 }, (_, i) => ({
      name: `agent-${i}`,
      config: { host: `host-${i}`, port: 3000 + i },
      isConnected: true,
      info: {},
    }));
    const containers = [];
    for (let i = 0; i < 10; i += 1) {
      for (let j = 0; j < 60; j += 1) {
        containers.push({
          id: `c-${i}-${j}`,
          agent: `agent-${i}`,
          status: j % 2 === 0 ? 'running' : 'exited',
          image: { id: `img-${i}-${j % 3}` },
          updateAvailable: j % 5 === 0,
        });
      }
    }
    getAgents.mockReturnValue(agents);
    getContainersRaw.mockReturnValue(containers);

    agentRouter.init();
    const handler = mockRouter.get.mock.calls.find((c) => c[0] === '/')[1];
    const res = createResponse();
    handler({}, res);

    expect(getContainersRaw).toHaveBeenCalledTimes(1);

    const payload = res.json.mock.calls[0][0];
    expect(payload.total).toBe(10);
    for (const entry of payload.data) {
      expect(entry.containers.total).toBe(60);
      expect(entry.containers.running).toBe(30);
      expect(entry.containers.stopped).toBe(30);
      expect(entry.containers.updatesAvailable).toBe(12);
      expect(entry.images).toBe(3);
    }
  });

  test('should return empty array when no agents', () => {
    getAgents.mockReturnValue([]);

    agentRouter.init();
    const handler = mockRouter.get.mock.calls.find((c) => c[0] === '/')[1];

    const res = createResponse();
    handler({}, res);

    expect(res.json).toHaveBeenCalledWith({ data: [], total: 0 });
  });

  test('should compute container stats using status and image fallbacks', () => {
    getAgents.mockReturnValue([
      {
        name: 'agent-fallbacks',
        config: { host: 'localhost', port: 3000 },
        isConnected: true,
        info: {},
      },
    ]);
    getContainersRaw.mockReturnValue([
      { id: 'c1', agent: 'agent-fallbacks', status: undefined, image: { name: 'img-name' } },
      { id: 'c2', agent: 'agent-fallbacks', status: 'running', image: {} },
      { id: 'c3', agent: 'agent-fallbacks', status: null },
    ]);

    agentRouter.init();
    const handler = mockRouter.get.mock.calls.find((c) => c[0] === '/')[1];
    const res = createResponse();
    handler({}, res);

    expect(res.json).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          name: 'agent-fallbacks',
          containers: { total: 3, running: 1, stopped: 2, updatesAvailable: 0 },
          images: 3,
        }),
      ],
      total: 1,
    });
  });

  test('should ignore containers with non-string agent identifiers when grouping', () => {
    getAgents.mockReturnValue([
      {
        name: 'agent-typed',
        config: { host: 'localhost', port: 3000 },
        isConnected: true,
        info: {},
      },
    ]);
    getContainersRaw.mockReturnValue([
      { id: 'c1', agent: ['agent-typed'], status: 'running', image: { id: 'img-a' } },
      { id: 'c2', agent: undefined, status: 'running', image: { id: 'img-b' } },
    ]);

    agentRouter.init();
    const handler = mockRouter.get.mock.calls.find((c) => c[0] === '/')[1];
    const res = createResponse();
    handler({}, res);

    expect(res.json).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          name: 'agent-typed',
          containers: { total: 0, running: 0, stopped: 0, updatesAvailable: 0 },
          images: 0,
        }),
      ],
      total: 1,
    });
  });

  test('agent route handlers should declare typed req and res parameters', () => {
    const source = fs.readFileSync(path.resolve(__dirname, './agent.ts'), 'utf8');
    expect(source).toMatch(
      /function getAgentsList\s*\(\s*req:\s*Request(?:<[^>]+>)?\s*,\s*res:\s*Response(?:<[^>]+>)?\s*\)/,
    );
    expect(source).toMatch(
      /async function getAgentLogEntries\s*\(\s*req:\s*Request(?:<[^>]+>)?\s*,\s*res:\s*Response(?:<[^>]+>)?\s*,?\s*\)/,
    );
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
    expect(res.json).toHaveBeenCalledWith([
      expect.objectContaining({
        ...mockEntries[0],
        displayTimestamp: expect.stringMatching(/^\[\d{2}:\d{2}:\d{2}\.\d{3}\]$/u),
      }),
    ]);
  });

  test('should preserve agent-provided display timestamps', async () => {
    const entry = {
      timestamp: 1000,
      level: 'info',
      component: 'test',
      msg: 'hello',
      displayTimestamp: '[already formatted]',
    };
    mockGetAgent.mockReturnValue({
      isConnected: true,
      getLogEntries: vi.fn().mockResolvedValue([entry]),
    });

    const req = createMockRequest({
      params: { name: 'agent-1' },
      query: {},
    });
    const res = createResponse();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith([entry]);
  });

  test('should strip unexpected properties from agent log entries', async () => {
    mockGetAgent.mockReturnValue({
      isConnected: true,
      getLogEntries: vi.fn().mockResolvedValue([
        {
          timestamp: 1000,
          level: 'info',
          component: 'test',
          msg: 'hello',
          displayTimestamp: '[already formatted]',
          secret: 'leak-me',
          nested: { leaked: true },
        },
      ]),
    });

    const req = createMockRequest({
      params: { name: 'agent-1' },
      query: {},
    });
    const res = createResponse();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith([
      {
        timestamp: 1000,
        level: 'info',
        component: 'test',
        msg: 'hello',
        displayTimestamp: '[already formatted]',
      },
    ]);
  });

  test('should normalize entries with string timestamps', async () => {
    mockGetAgent.mockReturnValue({
      isConnected: true,
      getLogEntries: vi.fn().mockResolvedValue([
        {
          timestamp: '2026-04-02T12:00:00.000Z',
          level: 'info',
          component: 'test',
          msg: 'hello',
        },
      ]),
    });

    const req = createMockRequest({
      params: { name: 'agent-1' },
      query: {},
    });
    const res = createResponse();

    await handler(req, res);

    const result = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(result[0].timestamp).toBe('2026-04-02T12:00:00.000Z');
    expect(result[0].displayTimestamp).toBeDefined();
  });

  test('should drop non-finite numeric timestamps and non-string/non-number timestamp values', async () => {
    mockGetAgent.mockReturnValue({
      isConnected: true,
      getLogEntries: vi.fn().mockResolvedValue([
        { timestamp: Number.POSITIVE_INFINITY, level: 'info', msg: 'inf' },
        { timestamp: { nested: true }, level: 'warn', msg: 'obj' },
      ]),
    });

    const req = createMockRequest({
      params: { name: 'agent-1' },
      query: {},
    });
    const res = createResponse();

    await handler(req, res);

    const result = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(result[0].timestamp).toBeUndefined();
    expect(result[0].displayTimestamp).toBe('-');
    expect(result[1].timestamp).toBeUndefined();
  });

  test('should leave non-object log entries unchanged when normalizing arrays', async () => {
    mockGetAgent.mockReturnValue({
      isConnected: true,
      getLogEntries: vi.fn().mockResolvedValue(['raw line', null]),
    });

    const req = createMockRequest({
      params: { name: 'agent-1' },
      query: {},
    });
    const res = createResponse();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith(['raw line', null]);
  });

  test('should pass through non-array agent log payloads unchanged', async () => {
    const payload = { entries: [] };
    mockGetAgent.mockReturnValue({
      isConnected: true,
      getLogEntries: vi.fn().mockResolvedValue(payload),
    });

    const req = createMockRequest({
      params: { name: 'agent-1' },
      query: {},
    });
    const res = createResponse();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith(payload);
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

  test('should return 400 when level query parameter is not allowlisted', async () => {
    const getLogEntries = vi.fn().mockResolvedValue([]);
    mockGetAgent.mockReturnValue({
      isConnected: true,
      getLogEntries,
    });

    const req = createMockRequest({
      params: { name: 'agent-1' },
      query: { level: 'verbose' },
    });
    const res = createResponse();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid level query parameter' });
    expect(getLogEntries).not.toHaveBeenCalled();
  });

  test.each([
    ['level', 123, 'Invalid level query parameter'],
    ['component', ['docker'], 'Invalid component query parameter'],
  ])('should return 400 when %s query parameter is not a string', async (param, value, expectedError) => {
    const getLogEntries = vi.fn().mockResolvedValue([]);
    mockGetAgent.mockReturnValue({
      isConnected: true,
      getLogEntries,
    });

    const req = createMockRequest({
      params: { name: 'agent-1' },
      query: { [param]: value },
    });
    const res = createResponse();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: expectedError });
    expect(getLogEntries).not.toHaveBeenCalled();
  });

  test('should return 400 when component query parameter contains unsafe characters', async () => {
    const getLogEntries = vi.fn().mockResolvedValue([]);
    mockGetAgent.mockReturnValue({
      isConnected: true,
      getLogEntries,
    });

    const req = createMockRequest({
      params: { name: 'agent-1' },
      query: { component: 'docker;rm -rf /' },
    });
    const res = createResponse();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid component query parameter' });
    expect(getLogEntries).not.toHaveBeenCalled();
  });

  test('should return 502 with a generic error when agent getLogEntries fails', async () => {
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
      error: 'Failed to fetch logs from agent',
    });
  });

  test('should return 502 with a generic error when agent throws a non-Error value', async () => {
    mockGetAgent.mockReturnValue({
      isConnected: true,
      getLogEntries: vi.fn().mockRejectedValue('Connection refused'),
    });

    const req = createMockRequest({
      params: { name: 'agent-1' },
      query: {},
    });
    const res = createResponse();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Failed to fetch logs from agent',
    });
  });

  test('should return 502 with a generic error for string failures from getLogEntries', async () => {
    mockGetAgent.mockReturnValue({
      isConnected: true,
      getLogEntries: vi.fn().mockRejectedValue('upstream unavailable'),
    });

    const req = createMockRequest({
      params: { name: 'agent-1' },
      query: {},
    });
    const res = createResponse();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Failed to fetch logs from agent',
    });
  });

  test('should return 502 with a generic error for numeric failures from getLogEntries', async () => {
    mockGetAgent.mockReturnValue({
      isConnected: true,
      getLogEntries: vi.fn().mockRejectedValue(503),
    });

    const req = createMockRequest({
      params: { name: 'agent-1' },
      query: {},
    });
    const res = createResponse();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Failed to fetch logs from agent',
    });
  });

  test('should return 502 with a generic error for object failures from getLogEntries', async () => {
    mockGetAgent.mockReturnValue({
      isConnected: true,
      getLogEntries: vi.fn().mockRejectedValue({ code: 'E_UPSTREAM' }),
    });

    const req = createMockRequest({
      params: { name: 'agent-1' },
      query: {},
    });
    const res = createResponse();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Failed to fetch logs from agent',
    });
  });
});
