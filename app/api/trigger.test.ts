import { createMockResponse } from '../test/helpers.js';

const { mockRouter, mockLog, mockGetErrorMessage } = vi.hoisted(() => ({
  mockRouter: { use: vi.fn(), get: vi.fn(), post: vi.fn() },
  mockLog: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  mockGetErrorMessage: vi.fn((error: unknown) =>
    error instanceof Error ? error.message : String(error),
  ),
}));

vi.mock('express', () => ({
  default: { Router: vi.fn(() => mockRouter) },
}));

vi.mock('nocache', () => ({ default: vi.fn(() => 'nocache-middleware') }));

vi.mock('./component', () => ({
  init: vi.fn(() => mockRouter),
}));

vi.mock('../registry', () => ({
  getState: vi.fn(() => ({
    trigger: {},
  })),
}));

const mockGetContainer = vi.hoisted(() => vi.fn());
vi.mock('../store/container.js', () => ({
  getContainer: mockGetContainer,
}));

vi.mock('../agent', () => ({
  getAgent: vi.fn(),
}));

vi.mock('../log', () => ({
  default: { child: () => mockLog },
}));

vi.mock('../util/error', () => ({
  getErrorMessage: mockGetErrorMessage,
}));

import * as agent from '../agent/index.js';
import * as registry from '../registry/index.js';
import * as triggerRouter from './trigger.js';
import { runTrigger } from './trigger.js';

async function flushAcceptedUpdateWork() {
  await Promise.resolve();
  await Promise.resolve();
}

function getRemoteTriggerHandler() {
  triggerRouter.init();
  const call = mockRouter.post.mock.calls.find((c) => c[0] === '/:type/:name/:agent');
  return call[1];
}

describe('Trigger Router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetErrorMessage.mockImplementation((error: unknown) =>
      error instanceof Error ? error.message : String(error),
    );
    mockGetContainer.mockReturnValue(undefined);
  });

  describe('init', () => {
    test('should register POST routes for triggers', () => {
      const router = triggerRouter.init();
      expect(router.post).toHaveBeenCalledWith('/:type/:name', expect.any(Function));
      expect(router.post).toHaveBeenCalledWith('/:type/:name/:agent', expect.any(Function));
    });
  });

  describe('runTrigger', () => {
    test('should return 400 when no container in body', async () => {
      const req = {
        params: { type: 'slack', name: 'default' },
        body: undefined,
      };
      const res = createMockResponse();

      await runTrigger(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid trigger request body' });
    });

    test('should return 400 when container id is not a string', async () => {
      const req = {
        params: { type: 'slack', name: 'default' },
        body: { id: 123 },
      };
      const res = createMockResponse();

      await runTrigger(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid trigger request body' });
    });

    test('should return 400 when container has agent (remote)', async () => {
      const req = {
        params: { type: 'slack', name: 'default' },
        body: { id: 'c1', agent: 'remote-agent' },
      };
      const res = createMockResponse();

      await runTrigger(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Cannot execute local trigger slack.default on remote container remote-agent.c1',
      });
    });

    test('should return 404 when trigger not found', async () => {
      registry.getState.mockReturnValue({ trigger: {} });

      const req = {
        params: { type: 'slack', name: 'default' },
        body: { id: 'c1' },
      };
      const res = createMockResponse();

      await runTrigger(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Error when running trigger slack.default (trigger not found)',
      });
    });

    test('should run trigger successfully', async () => {
      const mockTrigger = {
        trigger: vi.fn().mockResolvedValue(undefined),
      };
      registry.getState.mockReturnValue({
        trigger: { 'slack.default': mockTrigger },
      });

      const req = {
        params: { type: 'slack', name: 'default' },
        body: { id: 'c1' },
      };
      const res = createMockResponse();

      await runTrigger(req, res);

      expect(mockTrigger.trigger).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1' }));
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('should accept docker update triggers against the stored container state', async () => {
      const mockTrigger = {
        type: 'docker',
        trigger: vi.fn().mockResolvedValue(undefined),
      };
      registry.getState.mockReturnValue({
        trigger: { 'docker.update': mockTrigger },
      });
      mockGetContainer.mockReturnValue({
        id: 'c1',
        name: 'nginx',
        image: { name: 'nginx' },
        updateAvailable: true,
      });

      const req = {
        params: { type: 'docker', name: 'update' },
        body: { id: 'c1' },
      };
      const res = createMockResponse();

      await runTrigger(req, res);
      await flushAcceptedUpdateWork();

      expect(mockTrigger.trigger).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'c1', name: 'nginx' }),
        expect.objectContaining({ operationId: expect.any(String) }),
      );
      expect(res.status).toHaveBeenCalledWith(202);
      expect(res.json).toHaveBeenCalledWith({ operationId: expect.any(String) });
    });

    test('should return 404 when docker update trigger targets a container missing from the store', async () => {
      const mockTrigger = {
        type: 'docker',
        trigger: vi.fn().mockResolvedValue(undefined),
      };
      registry.getState.mockReturnValue({
        trigger: { 'docker.update': mockTrigger },
      });

      const req = {
        params: { type: 'docker', name: 'update' },
        body: { id: 'c1' },
      };
      const res = createMockResponse();

      await runTrigger(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Container not found' });
      expect(mockTrigger.trigger).not.toHaveBeenCalled();
    });

    test('should set default updateKind when missing', async () => {
      const mockTrigger = {
        trigger: vi.fn().mockResolvedValue(undefined),
      };
      registry.getState.mockReturnValue({
        trigger: { 'slack.default': mockTrigger },
      });

      const container = { id: 'c1' };
      const req = {
        params: { type: 'slack', name: 'default' },
        body: container,
      };
      const res = createMockResponse();

      await runTrigger(req, res);

      expect(mockTrigger.trigger).toHaveBeenCalledWith(
        expect.objectContaining({
          updateKind: {
            kind: 'unknown',
            localValue: undefined,
            remoteValue: undefined,
            semverDiff: 'unknown',
          },
        }),
      );
    });

    test('should not override existing updateKind', async () => {
      const mockTrigger = {
        trigger: vi.fn().mockResolvedValue(undefined),
      };
      registry.getState.mockReturnValue({
        trigger: { 'slack.default': mockTrigger },
      });

      const container = {
        id: 'c1',
        updateKind: { kind: 'tag', remoteValue: '2.0', localValue: '1.0', semverDiff: 'major' },
      };
      const req = {
        params: { type: 'slack', name: 'default' },
        body: container,
      };
      const res = createMockResponse();

      await runTrigger(req, res);

      expect(mockTrigger.trigger).toHaveBeenCalledWith(
        expect.objectContaining({
          updateKind: { kind: 'tag', remoteValue: '2.0', localValue: '1.0', semverDiff: 'major' },
        }),
      );
    });

    test('should return 409 when local trigger targets a temporary rollback container', async () => {
      const mockTrigger = {
        trigger: vi.fn().mockResolvedValue(undefined),
      };
      registry.getState.mockReturnValue({
        trigger: { 'slack.default': mockTrigger },
      });

      const req = {
        params: { type: 'slack', name: 'default' },
        body: { id: 'c1', name: 'app-old-1234567890' },
      };
      const res = createMockResponse();

      await runTrigger(req, res);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Cannot update temporary rollback container',
      });
      expect(mockTrigger.trigger).not.toHaveBeenCalled();
    });

    test('should return 500 when trigger throws', async () => {
      const mockTrigger = {
        trigger: vi.fn().mockRejectedValue(new Error('trigger failed')),
      };
      registry.getState.mockReturnValue({
        trigger: { 'slack.default': mockTrigger },
      });

      const req = {
        params: { type: 'slack', name: 'default' },
        body: { id: 'c1' },
      };
      const res = createMockResponse();

      await runTrigger(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Error when running trigger slack.default',
        details: { reason: 'trigger failed' },
      });
      expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('trigger failed'));
    });

    test('should stringify non-Error trigger failures in logs', async () => {
      const mockTrigger = {
        trigger: vi.fn().mockRejectedValue(503),
      };
      registry.getState.mockReturnValue({
        trigger: { 'slack.default': mockTrigger },
      });

      const req = {
        params: { type: 'slack', name: 'default' },
        body: { id: 'c1' },
      };
      const res = createMockResponse();

      await runTrigger(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('(503)'));
    });

    test('should use shared getErrorMessage helper for trigger failures', async () => {
      const mockTrigger = {
        trigger: vi.fn().mockRejectedValue({ message: 'trigger failed from object' }),
      };
      registry.getState.mockReturnValue({
        trigger: { 'slack.default': mockTrigger },
      });
      mockGetErrorMessage.mockReturnValueOnce('shared helper message');

      const req = {
        params: { type: 'slack', name: 'default' },
        body: { id: 'c1' },
      };
      const res = createMockResponse();

      await runTrigger(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(mockGetErrorMessage).toHaveBeenCalledWith({ message: 'trigger failed from object' });
      expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('shared helper message'));
    });

    test('should include error details when trigger execution fails', async () => {
      const mockTrigger = {
        trigger: vi.fn().mockRejectedValue(new Error('watcher not found')),
      };
      registry.getState.mockReturnValue({
        trigger: { 'slack.default': mockTrigger },
      });

      const req = {
        params: { type: 'slack', name: 'default' },
        body: { id: 'c1' },
      };
      const res = createMockResponse();

      await runTrigger(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Error when running trigger slack.default',
        details: { reason: 'watcher not found' },
      });
    });

    test('should omit trigger error details when helper returns empty message', async () => {
      const mockTrigger = {
        trigger: vi.fn().mockRejectedValue(new Error('hidden error')),
      };
      registry.getState.mockReturnValue({
        trigger: { 'slack.default': mockTrigger },
      });
      mockGetErrorMessage.mockReturnValueOnce('');

      const req = {
        params: { type: 'slack', name: 'default' },
        body: { id: 'c1' },
      };
      const res = createMockResponse();

      await runTrigger(req, res);

      const responsePayload = res.json.mock.calls[0][0];
      expect(res.status).toHaveBeenCalledWith(500);
      expect(responsePayload.error).toBe('Error when running trigger slack.default');
      expect(responsePayload.details).toBeUndefined();
    });
  });

  describe('runRemoteTrigger', () => {
    test('should return 404 when agent not found', async () => {
      agent.getAgent.mockReturnValue(undefined);

      const handler = getRemoteTriggerHandler();
      const req = {
        params: { agent: 'unknown', type: 'slack', name: 'default' },
        body: { id: 'c1' },
      };
      const res = createMockResponse();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Agent unknown not found',
      });
    });

    test('should return 400 when no container in body', async () => {
      agent.getAgent.mockReturnValue({ runRemoteTrigger: vi.fn() });

      const handler = getRemoteTriggerHandler();
      const req = {
        params: { agent: 'my-agent', type: 'slack', name: 'default' },
        body: undefined,
      };
      const res = createMockResponse();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid trigger request body' });
    });

    test('should return 400 when container has no id', async () => {
      agent.getAgent.mockReturnValue({ runRemoteTrigger: vi.fn() });

      const handler = getRemoteTriggerHandler();
      const req = {
        params: { agent: 'my-agent', type: 'slack', name: 'default' },
        body: { name: 'test' },
      };
      const res = createMockResponse();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid trigger request body' });
    });

    test('should return 400 when container id is not a string', async () => {
      const mockAgentClient = {
        runRemoteTrigger: vi.fn().mockResolvedValue(undefined),
      };
      agent.getAgent.mockReturnValue(mockAgentClient);

      const handler = getRemoteTriggerHandler();
      const req = {
        params: { agent: 'my-agent', type: 'slack', name: 'default' },
        body: { id: 123 },
      };
      const res = createMockResponse();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid trigger request body' });
      expect(mockAgentClient.runRemoteTrigger).not.toHaveBeenCalled();
    });

    test('should run remote trigger successfully', async () => {
      const mockAgentClient = {
        runRemoteTrigger: vi.fn().mockResolvedValue(undefined),
      };
      agent.getAgent.mockReturnValue(mockAgentClient);

      const handler = getRemoteTriggerHandler();
      const req = {
        params: { agent: 'my-agent', type: 'slack', name: 'default' },
        body: { id: 'c1' },
      };
      const res = createMockResponse();

      await handler(req, res);

      expect(mockAgentClient.runRemoteTrigger).toHaveBeenCalledWith(
        { id: 'c1' },
        'slack',
        'default',
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('should return 409 when remote trigger targets a temporary rollback container', async () => {
      const mockAgentClient = {
        runRemoteTrigger: vi.fn().mockResolvedValue(undefined),
      };
      agent.getAgent.mockReturnValue(mockAgentClient);

      const handler = getRemoteTriggerHandler();
      const req = {
        params: { agent: 'my-agent', type: 'slack', name: 'default' },
        body: { id: 'c1', name: 'app-old-1234567890' },
      };
      const res = createMockResponse();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Cannot update temporary rollback container',
      });
      expect(mockAgentClient.runRemoteTrigger).not.toHaveBeenCalled();
    });

    test('should return 500 when remote trigger throws', async () => {
      const mockAgentClient = {
        runRemoteTrigger: vi.fn().mockRejectedValue(new Error('remote error')),
      };
      agent.getAgent.mockReturnValue(mockAgentClient);

      const handler = getRemoteTriggerHandler();
      const req = {
        params: { agent: 'my-agent', type: 'slack', name: 'default' },
        body: { id: 'c1' },
      };
      const res = createMockResponse();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Error when running remote trigger slack.default on agent my-agent',
        details: { reason: 'remote error' },
      });
      expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('remote error'));
    });

    test('should return generic 500 when remote trigger throws a non-object value', async () => {
      const mockAgentClient = {
        runRemoteTrigger: vi.fn().mockRejectedValue('remote error as string'),
      };
      agent.getAgent.mockReturnValue(mockAgentClient);

      const handler = getRemoteTriggerHandler();
      const req = {
        params: { agent: 'my-agent', type: 'slack', name: 'default' },
        body: { id: 'c1' },
      };
      const res = createMockResponse();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Error when running remote trigger slack.default on agent my-agent',
        details: { reason: 'remote error as string' },
      });
    });

    test('should omit fallback remote error details when helper returns empty message', async () => {
      const mockAgentClient = {
        runRemoteTrigger: vi.fn().mockRejectedValue(new Error('remote error')),
      };
      agent.getAgent.mockReturnValue(mockAgentClient);
      mockGetErrorMessage.mockReturnValueOnce('');

      const handler = getRemoteTriggerHandler();
      const req = {
        params: { agent: 'my-agent', type: 'slack', name: 'default' },
        body: { id: 'c1' },
      };
      const res = createMockResponse();

      await handler(req, res);

      const responsePayload = res.json.mock.calls[0][0];
      expect(res.status).toHaveBeenCalledWith(500);
      expect(responsePayload.error).toBe(
        'Error when running remote trigger slack.default on agent my-agent',
      );
      expect(responsePayload.details).toBeUndefined();
    });

    test('should ignore remote status codes outside the HTTP error range', async () => {
      const mockAgentClient = {
        runRemoteTrigger: vi.fn().mockRejectedValue({
          message: 'transport failure',
          response: {
            status: 200,
            data: {
              error: 'Error when running trigger slack.default',
            },
          },
        }),
      };
      agent.getAgent.mockReturnValue(mockAgentClient);
      mockGetErrorMessage.mockReturnValueOnce('transport failure');

      const handler = getRemoteTriggerHandler();
      const req = {
        params: { agent: 'my-agent', type: 'slack', name: 'default' },
        body: { id: 'c1' },
      };
      const res = createMockResponse();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Error when running remote trigger slack.default on agent my-agent',
        details: { reason: 'transport failure' },
      });
    });

    test('should fall back to generic error when remote payload is not an object', async () => {
      const mockAgentClient = {
        runRemoteTrigger: vi.fn().mockRejectedValue({
          message: 'Request failed with status code 500',
          response: {
            status: 500,
            data: 'unexpected error payload',
          },
        }),
      };
      agent.getAgent.mockReturnValue(mockAgentClient);
      mockGetErrorMessage.mockReturnValueOnce('Request failed with status code 500');

      const handler = getRemoteTriggerHandler();
      const req = {
        params: { agent: 'my-agent', type: 'slack', name: 'default' },
        body: { id: 'c1' },
      };
      const res = createMockResponse();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Error when running remote trigger slack.default on agent my-agent',
        details: { reason: 'Request failed with status code 500' },
      });
    });

    test('should propagate remote trigger error status and payload when available', async () => {
      const mockAgentClient = {
        runRemoteTrigger: vi.fn().mockRejectedValue({
          message: 'Request failed with status code 500',
          response: {
            status: 500,
            data: {
              error: 'Error when running trigger docker.update',
              details: {
                reason: 'No watcher found for container c1 (docker.default)',
              },
            },
          },
        }),
      };
      agent.getAgent.mockReturnValue(mockAgentClient);

      const handler = getRemoteTriggerHandler();
      const req = {
        params: { agent: 'my-agent', type: 'docker', name: 'update' },
        body: { id: 'c1' },
      };
      const res = createMockResponse();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Error when running trigger docker.update',
        details: {
          reason: 'No watcher found for container c1 (docker.default)',
        },
      });
    });
  });
});
