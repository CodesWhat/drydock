import { createMockResponse } from '../test/helpers.js';
import * as requestUpdate from '../updates/request-update.js';

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

const mockActionsEnabled = vi.hoisted(() => vi.fn(() => true));
vi.mock('./container-update-dispatch.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./container-update-dispatch.js')>()),
  areContainerActionsEnabled: mockActionsEnabled,
}));

vi.mock('../agent', () => ({
  getAgent: vi.fn(),
}));

vi.mock('../log', () => ({
  default: { child: () => mockLog },
}));

vi.mock('../util/error', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../util/error.js')>()),
  getErrorMessage: mockGetErrorMessage,
}));

import * as agent from '../agent/index.js';
import * as registry from '../registry/index.js';
import * as updateOperationStore from '../store/update-operation.js';
import {
  getNotificationSkipsSnapshot,
  recordNotificationSkip,
  resetNotificationSkips,
} from '../triggers/notification-skips.js';
import * as component from './component.js';
import * as triggerRouter from './trigger.js';
import { runTrigger } from './trigger.js';
import { registerTriggerSkipRoutes } from './trigger-skips.js';

const componentInit = vi.mocked(component.init);

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
    mockActionsEnabled.mockReturnValue(true);
  });

  describe('init', () => {
    test('should register POST routes for triggers', () => {
      const router = triggerRouter.init();
      expect(router.post).toHaveBeenCalledWith('/:type/:name', expect.any(Function));
      expect(router.post).toHaveBeenCalledWith('/:type/:name/:agent', expect.any(Function));
    });

    test('hands the skip route registrar to the component router', () => {
      triggerRouter.init();
      expect(componentInit).toHaveBeenCalledWith('trigger', undefined, registerTriggerSkipRoutes);
    });
  });

  describe('API key scope, resolved from the trigger type', () => {
    function keyRequest(scopes: string[], params: Record<string, string>) {
      return {
        params,
        body: { id: 'c1' },
        principal: { kind: 'api-key', keyId: 'abcdef012345', name: 'ci', scopes },
      };
    }

    // docker/dockercompose/portainer dispatch a real container update through
    // requestContainerUpdate; command executes a configured host command. All
    // four are actions, so none of them is a test-fire.
    const ACTION_TYPES = ['docker', 'dockercompose', 'portainer', 'command'];

    test.each(ACTION_TYPES)(
      'a triggers:test-only key running a %s trigger gets 403 and dispatches nothing',
      async (triggerType) => {
        const spy = vi.spyOn(requestUpdate, 'requestContainerUpdate');
        const res = createMockResponse();

        await runTrigger(keyRequest(['triggers:test'], { type: triggerType, name: 'update' }), res);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({
          error: 'API key is missing the required scope',
          details: { requiredScope: 'containers:update' },
        });
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
      },
    );

    test.each(ACTION_TYPES)(
      'the same refusal applies to the agent-qualified %s route, before the agent is resolved',
      async (triggerType) => {
        const spy = vi.spyOn(requestUpdate, 'requestContainerUpdate');
        const handler = getRemoteTriggerHandler();
        const res = createMockResponse();

        await handler(
          keyRequest(['triggers:test'], { type: triggerType, name: 'update', agent: 'agent-1' }),
          res,
        );

        expect(res.status).toHaveBeenCalledWith(403);
        expect(spy).not.toHaveBeenCalled();
        // Refusing before the lookup keeps the 404 from naming which agents exist.
        expect(agent.getAgent).not.toHaveBeenCalled();
        spy.mockRestore();
      },
    );

    test('a containers:update key reaches the docker trigger', async () => {
      const res = createMockResponse();

      await runTrigger(keyRequest(['containers:update'], { type: 'docker', name: 'update' }), res);

      expect(res.status).not.toHaveBeenCalledWith(403);
    });

    test('a triggers:test key still reaches a notification trigger', async () => {
      const res = createMockResponse();

      await runTrigger(keyRequest(['triggers:test'], { type: 'slack', name: 'default' }), res);

      expect(res.status).not.toHaveBeenCalledWith(403);
    });

    test('a containers:update key does not inherit the notification test-fire', async () => {
      const res = createMockResponse();

      await runTrigger(keyRequest(['containers:update'], { type: 'slack', name: 'default' }), res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        error: 'API key is missing the required scope',
        details: { requiredScope: 'triggers:test' },
      });
    });

    test('a session is not gated by either scope', async () => {
      const res = createMockResponse();

      await runTrigger({ params: { type: 'docker', name: 'update' }, body: { id: 'c1' } }, res);

      expect(res.status).not.toHaveBeenCalledWith(403);
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

    test('a manual send clears the recorded skip, a failed one keeps it', async () => {
      resetNotificationSkips();
      recordNotificationSkip('slack.default', 'c1', 'rule-disabled');
      const mockTrigger = {
        type: 'slack',
        name: 'default',
        trigger: vi.fn().mockRejectedValueOnce(new Error('down')),
      };
      registry.getState.mockReturnValue({ trigger: { 'slack.default': mockTrigger } });
      const req = { params: { type: 'slack', name: 'default' }, body: { id: 'c1' } };

      await runTrigger(req, createMockResponse());
      expect(getNotificationSkipsSnapshot()).toHaveLength(1);

      mockTrigger.trigger.mockResolvedValueOnce(undefined);
      await runTrigger(req, createMockResponse());
      expect(getNotificationSkipsSnapshot()).toHaveLength(0);
    });

    test('should run trigger successfully', async () => {
      const mockTrigger = {
        type: 'slack',
        name: 'default',
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
        name: 'update',
        trigger: vi.fn().mockResolvedValue(undefined),
        getId: () => 'docker.update',
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

    test('should honor caller-supplied operationId in body (#289)', async () => {
      const mockTrigger = {
        type: 'docker',
        name: 'update',
        trigger: vi.fn().mockResolvedValue(undefined),
        getId: () => 'docker.update',
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
      const spy = vi.spyOn(requestUpdate, 'requestContainerUpdate');

      const req = {
        params: { type: 'docker', name: 'update' },
        body: { id: 'c1', operationId: 'caller-op-uuid' },
      };
      const res = createMockResponse();

      await runTrigger(req, res);
      spy.mockRestore();

      expect(res.status).toHaveBeenCalledWith(202);
      // Response operationId should match what was provided
      expect(res.json).toHaveBeenCalledWith({ operationId: 'caller-op-uuid' });
    });

    test('should reject a caller-supplied operationId that already exists with 409', async () => {
      const mockTrigger = {
        type: 'docker',
        name: 'update',
        trigger: vi.fn().mockResolvedValue(undefined),
        getId: () => 'docker.update',
      };
      registry.getState.mockReturnValue({
        trigger: { 'docker.update': mockTrigger },
      });
      mockGetContainer.mockReturnValue({
        id: 'dup-c1',
        name: 'dup-nginx',
        image: { name: 'nginx' },
        updateAvailable: true,
      });
      // A foreign container already owns this id, so the per-container
      // active-operation gate lets the request through and the id check is
      // what has to stop it.
      const getOperationByIdSpy = vi
        .spyOn(updateOperationStore, 'getOperationById')
        .mockImplementation((id: string) =>
          id === 'duplicate-op-uuid'
            ? ({ id, containerId: 'other-container', status: 'queued' } as never)
            : undefined,
        );

      const res = createMockResponse();
      await runTrigger(
        {
          params: { type: 'docker', name: 'update' },
          body: { id: 'dup-c1', operationId: 'duplicate-op-uuid' },
        },
        res,
      );
      getOperationByIdSpy.mockRestore();

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Update operation id already exists',
      });
      expect(mockTrigger.trigger).not.toHaveBeenCalled();
    });

    test('should reject body with empty-string operationId (#289)', async () => {
      const req = {
        params: { type: 'docker', name: 'update' },
        body: { id: 'c1', operationId: '' },
      };
      const res = createMockResponse();

      await runTrigger(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    test('should surface UpdateRequestError responses from accepted docker update triggers', async () => {
      const mockTrigger = {
        type: 'docker',
        name: 'update',
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
      const spy = vi
        .spyOn(requestUpdate, 'requestContainerUpdate')
        .mockRejectedValueOnce(new requestUpdate.UpdateRequestError(418, 'teapot'));

      const req = {
        params: { type: 'docker', name: 'update' },
        body: { id: 'c1' },
      };
      const res = createMockResponse();

      await runTrigger(req, res);
      spy.mockRestore();

      expect(res.status).toHaveBeenCalledWith(418);
      expect(res.json).toHaveBeenCalledWith({ error: 'teapot' });
    });

    test('should return 404 when docker update trigger targets a container missing from the store', async () => {
      const mockTrigger = {
        name: 'update',
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
        type: 'slack',
        name: 'default',
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
        type: 'slack',
        name: 'default',
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

    test('refuses an action trigger run on a container from a file watcher', async () => {
      const commandTrigger = { type: 'command', name: 'deploy', trigger: vi.fn() };
      const dockerTrigger = { type: 'docker', name: 'update', trigger: vi.fn() };
      registry.getState.mockReturnValue({
        trigger: { 'command.deploy': commandTrigger, 'docker.update': dockerTrigger },
      });

      for (const type of ['command', 'docker']) {
        const res = createMockResponse();

        await runTrigger(
          {
            params: { type, name: type === 'docker' ? 'update' : 'deploy' },
            body: { id: 'file-0123456789abcdef01234567' },
          },
          res,
        );

        expect(res.status).toHaveBeenCalledWith(409);
        expect(res.json).toHaveBeenCalledWith({
          error: 'Containers from a file watcher are notification-only',
        });
      }
      expect(commandTrigger.trigger).not.toHaveBeenCalled();
      expect(dockerTrigger.trigger).not.toHaveBeenCalled();
    });

    test('runs a notification trigger on a container from a file watcher', async () => {
      const mockTrigger = {
        type: 'slack',
        name: 'default',
        trigger: vi.fn().mockResolvedValue(undefined),
      };
      registry.getState.mockReturnValue({ trigger: { 'slack.default': mockTrigger } });
      const res = createMockResponse();

      await runTrigger(
        {
          params: { type: 'slack', name: 'default' },
          body: { id: 'file-0123456789abcdef01234567' },
        },
        res,
      );

      expect(mockTrigger.trigger).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('should return 409 when local trigger targets a temporary rollback container', async () => {
      const mockTrigger = {
        type: 'slack',
        name: 'default',
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
        type: 'slack',
        name: 'default',
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
        type: 'slack',
        name: 'default',
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
        type: 'slack',
        name: 'default',
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
        type: 'slack',
        name: 'default',
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
        type: 'slack',
        name: 'default',
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

    test('should scrub credentials embedded in the thrown error message before sending to the client', async () => {
      const mockTrigger = {
        type: 'slack',
        name: 'default',
        trigger: vi
          .fn()
          .mockRejectedValue(
            new Error(
              'Webhook call failed: Authorization: Bearer sk-secret-abc123, POST https://user:hunter2@hooks.example.com/notify timed out',
            ),
          ),
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
      const responseBody = JSON.stringify(res.json.mock.calls[0][0]);
      expect(responseBody).not.toContain('sk-secret-abc123');
      expect(responseBody).not.toContain('hunter2');
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
        undefined,
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

    test('should scrub credentials embedded in the remote trigger error message before sending to the client', async () => {
      const mockAgentClient = {
        runRemoteTrigger: vi
          .fn()
          .mockRejectedValue(
            new Error(
              'Webhook call failed: Authorization: Bearer sk-secret-abc123, POST https://user:hunter2@hooks.example.com/notify timed out',
            ),
          ),
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
      const responseBody = JSON.stringify(res.json.mock.calls[0][0]);
      expect(responseBody).not.toContain('sk-secret-abc123');
      expect(responseBody).not.toContain('hunter2');
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
              error: 'Error when running trigger slack.notify',
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
        params: { agent: 'my-agent', type: 'slack', name: 'notify' },
        body: { id: 'c1' },
      };
      const res = createMockResponse();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Error when running trigger slack.notify',
        details: {
          reason: 'No watcher found for container c1 (docker.default)',
        },
      });
    });

    test('should dispatch a remote docker update through the agent-qualified trigger exactly once', async () => {
      const mockAgentClient = {
        runRemoteTrigger: vi.fn().mockResolvedValue(undefined),
      };
      agent.getAgent.mockReturnValue(mockAgentClient);
      const localControllerTrigger = {
        type: 'docker',
        name: 'update',
        trigger: vi.fn().mockResolvedValue(undefined),
      };
      const remoteAgentTrigger = {
        type: 'docker',
        name: 'update',
        agent: 'my-agent',
        configuration: {},
        getId: () => 'my-agent.docker.update',
        isTriggerIncluded: vi.fn().mockReturnValue(true),
        isTriggerExcluded: vi.fn().mockReturnValue(false),
        trigger: vi.fn((container, runtimeContext) =>
          mockAgentClient.runRemoteTrigger(container, 'docker', 'update', runtimeContext),
        ),
      };
      registry.getState.mockReturnValue({
        trigger: {
          'docker.update': localControllerTrigger,
          'my-agent.docker.update': remoteAgentTrigger,
        },
      });
      mockGetContainer.mockReturnValue({
        id: 'c1',
        name: 'nginx',
        agent: 'my-agent',
        image: { name: 'nginx' },
        updateAvailable: true,
      });

      const handler = getRemoteTriggerHandler();
      const req = {
        params: { agent: 'my-agent', type: 'docker', name: 'update' },
        body: { id: 'c1' },
      };
      const res = createMockResponse();

      await handler(req, res);
      await flushAcceptedUpdateWork();

      expect(res.status).toHaveBeenCalledWith(202);
      expect(res.json).toHaveBeenCalledWith({ operationId: expect.any(String) });

      expect(localControllerTrigger.trigger).not.toHaveBeenCalled();
      expect(remoteAgentTrigger.trigger).toHaveBeenCalledTimes(1);
      expect(remoteAgentTrigger.trigger).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'c1', name: 'nginx', agent: 'my-agent' }),
        expect.objectContaining({ operationId: expect.any(String) }),
      );
      expect(mockAgentClient.runRemoteTrigger).toHaveBeenCalledTimes(1);
      const operationId = (res.json.mock.calls[0][0] as { operationId: string }).operationId;
      expect(mockAgentClient.runRemoteTrigger).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'c1', name: 'nginx', agent: 'my-agent' }),
        'docker',
        'update',
        { operationId },
      );
    });

    test('should honor caller-supplied operationId for remote docker update trigger', async () => {
      const mockAgentClient = {
        runRemoteTrigger: vi.fn().mockResolvedValue(undefined),
      };
      agent.getAgent.mockReturnValue(mockAgentClient);
      const mockTrigger = {
        type: 'docker',
        name: 'update',
        agent: 'my-agent',
        configuration: {},
        getId: () => 'my-agent.docker.update',
        isTriggerIncluded: vi.fn().mockReturnValue(true),
        isTriggerExcluded: vi.fn().mockReturnValue(false),
        trigger: vi.fn((container, runtimeContext) =>
          mockAgentClient.runRemoteTrigger(container, 'docker', 'update', runtimeContext),
        ),
      };
      registry.getState.mockReturnValue({
        trigger: { 'my-agent.docker.update': mockTrigger },
      });
      mockGetContainer.mockReturnValue({
        id: 'c1',
        name: 'nginx',
        agent: 'my-agent',
        image: { name: 'nginx' },
        updateAvailable: true,
      });
      const handler = getRemoteTriggerHandler();
      const req = {
        params: { agent: 'my-agent', type: 'docker', name: 'update' },
        body: { id: 'c1', operationId: 'caller-remote-op-uuid' },
      };
      const res = createMockResponse();

      await handler(req, res);
      await flushAcceptedUpdateWork();

      // Caller-supplied operationId must be honored in the response
      expect(res.status).toHaveBeenCalledWith(202);
      expect(res.json).toHaveBeenCalledWith({ operationId: 'caller-remote-op-uuid' });

      expect(mockTrigger.trigger).toHaveBeenCalledTimes(1);
      expect(mockAgentClient.runRemoteTrigger).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'c1', agent: 'my-agent' }),
        'docker',
        'update',
        { operationId: 'caller-remote-op-uuid' },
      );
    });

    test('should reject a duplicate caller-supplied operationId on the remote route with 409', async () => {
      const mockAgentClient = {
        runRemoteTrigger: vi.fn().mockResolvedValue(undefined),
      };
      agent.getAgent.mockReturnValue(mockAgentClient);
      const mockTrigger = {
        type: 'docker',
        name: 'update',
        agent: 'my-agent',
        configuration: {},
        getId: () => 'my-agent.docker.update',
        isTriggerIncluded: vi.fn().mockReturnValue(true),
        isTriggerExcluded: vi.fn().mockReturnValue(false),
        trigger: vi.fn((container, runtimeContext) =>
          mockAgentClient.runRemoteTrigger(container, 'docker', 'update', runtimeContext),
        ),
      };
      registry.getState.mockReturnValue({
        trigger: { 'my-agent.docker.update': mockTrigger },
      });
      mockGetContainer.mockReturnValue({
        id: 'dup-remote-c1',
        name: 'dup-remote-nginx',
        agent: 'my-agent',
        image: { name: 'nginx' },
        updateAvailable: true,
      });
      const getOperationByIdSpy = vi
        .spyOn(updateOperationStore, 'getOperationById')
        .mockImplementation((id: string) =>
          id === 'duplicate-remote-op-uuid'
            ? ({ id, containerId: 'other-container', status: 'succeeded' } as never)
            : undefined,
        );

      const handler = getRemoteTriggerHandler();
      const res = createMockResponse();
      await handler(
        {
          params: { agent: 'my-agent', type: 'docker', name: 'update' },
          body: { id: 'dup-remote-c1', operationId: 'duplicate-remote-op-uuid' },
        },
        res,
      );
      getOperationByIdSpy.mockRestore();

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Update operation id already exists',
      });
      expect(mockAgentClient.runRemoteTrigger).not.toHaveBeenCalled();
    });

    test('should not make a second remote update call when the agent would reject it with 409', async () => {
      const mockAgentClient = {
        runRemoteTrigger: vi
          .fn()
          .mockResolvedValueOnce(undefined)
          .mockRejectedValueOnce({
            response: {
              status: 409,
              data: { error: 'Container update already in progress' },
            },
          }),
      };
      agent.getAgent.mockReturnValue(mockAgentClient);
      const remoteAgentTrigger = {
        type: 'docker',
        name: 'update',
        agent: 'my-agent',
        configuration: {},
        getId: () => 'my-agent.docker.update',
        isTriggerIncluded: vi.fn().mockReturnValue(true),
        isTriggerExcluded: vi.fn().mockReturnValue(false),
        trigger: vi.fn((container, runtimeContext) =>
          mockAgentClient.runRemoteTrigger(container, 'docker', 'update', runtimeContext),
        ),
      };
      registry.getState.mockReturnValue({
        trigger: { 'my-agent.docker.update': remoteAgentTrigger },
      });
      mockGetContainer.mockReturnValue({
        id: 'c1',
        name: 'nginx',
        agent: 'my-agent',
        image: { name: 'nginx' },
        updateAvailable: true,
      });

      const handler = getRemoteTriggerHandler();
      const req = {
        params: { agent: 'my-agent', type: 'docker', name: 'update' },
        body: { id: 'c1' },
      };
      const res = createMockResponse();

      await handler(req, res);
      await flushAcceptedUpdateWork();

      expect(res.status).toHaveBeenCalledWith(202);
      expect(remoteAgentTrigger.trigger).toHaveBeenCalledTimes(1);
      expect(mockAgentClient.runRemoteTrigger).toHaveBeenCalledTimes(1);
      expect(res.json).toHaveBeenCalledWith({ operationId: expect.any(String) });
    });

    test('should return 404 when remote docker update trigger targets a container missing from the store', async () => {
      const mockAgentClient = {
        runRemoteTrigger: vi.fn().mockResolvedValue(undefined),
      };
      agent.getAgent.mockReturnValue(mockAgentClient);
      const mockTrigger = {
        name: 'update',
        type: 'docker',
        trigger: vi.fn().mockResolvedValue(undefined),
      };
      registry.getState.mockReturnValue({
        trigger: { 'docker.update': mockTrigger },
      });
      // mockGetContainer already returns undefined by default (set in beforeEach)

      const handler = getRemoteTriggerHandler();
      const req = {
        params: { agent: 'my-agent', type: 'docker', name: 'update' },
        body: { id: 'c1' },
      };
      const res = createMockResponse();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Container not found' });
      expect(mockAgentClient.runRemoteTrigger).not.toHaveBeenCalled();
    });

    test('should forward caller-supplied operationId as runtimeContext even when trigger is not found in controller registry', async () => {
      const mockAgentClient = {
        runRemoteTrigger: vi.fn().mockResolvedValue(undefined),
      };
      agent.getAgent.mockReturnValue(mockAgentClient);
      // No trigger registered in registry for this type — notification passthrough path
      registry.getState.mockReturnValue({ trigger: {} });

      const handler = getRemoteTriggerHandler();
      const req = {
        params: { agent: 'my-agent', type: 'slack', name: 'default' },
        body: { id: 'c1', operationId: 'caller-notify-op-uuid' },
      };
      const res = createMockResponse();

      await handler(req, res);

      // Non-update triggers still passthrough but MUST forward operationId
      expect(mockAgentClient.runRemoteTrigger).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'c1' }),
        'slack',
        'default',
        { operationId: 'caller-notify-op-uuid' },
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('should return 404 before dispatch when the agent-qualified update trigger is not registered', async () => {
      const mockAgentClient = {
        runRemoteTrigger: vi.fn().mockResolvedValue(undefined),
      };
      agent.getAgent.mockReturnValue(mockAgentClient);
      registry.getState.mockReturnValue({ trigger: {} });
      mockGetContainer.mockReturnValue({
        id: 'c1',
        name: 'nginx',
        agent: 'my-agent',
        image: { name: 'nginx' },
        updateAvailable: true,
      });
      const requestSpy = vi.spyOn(requestUpdate, 'requestContainerUpdate');

      const handler = getRemoteTriggerHandler();
      const req = {
        params: { agent: 'my-agent', type: 'docker', name: 'update' },
        body: { id: 'c1' },
      };
      const res = createMockResponse();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Remote update trigger my-agent.docker.update not found',
      });
      expect(requestSpy).not.toHaveBeenCalled();
      expect(mockAgentClient.runRemoteTrigger).not.toHaveBeenCalled();

      requestSpy.mockRestore();
    });

    test('should surface UpdateRequestError from requestContainerUpdate for remote update triggers', async () => {
      const mockAgentClient = {
        runRemoteTrigger: vi.fn().mockResolvedValue(undefined),
      };
      agent.getAgent.mockReturnValue(mockAgentClient);
      const mockTrigger = {
        type: 'docker',
        name: 'update',
        agent: 'my-agent',
        configuration: {},
        getId: () => 'my-agent.docker.update',
        isTriggerIncluded: vi.fn().mockReturnValue(true),
        isTriggerExcluded: vi.fn().mockReturnValue(false),
        trigger: vi.fn().mockResolvedValue(undefined),
      };
      registry.getState.mockReturnValue({
        trigger: { 'my-agent.docker.update': mockTrigger },
      });
      mockGetContainer.mockReturnValue({
        id: 'c1',
        name: 'nginx',
        agent: 'my-agent',
        image: { name: 'nginx' },
        updateAvailable: true,
      });
      const spy = vi
        .spyOn(requestUpdate, 'requestContainerUpdate')
        .mockRejectedValueOnce(new requestUpdate.UpdateRequestError(409, 'update in progress'));

      const handler = getRemoteTriggerHandler();
      const req = {
        params: { agent: 'my-agent', type: 'docker', name: 'update' },
        body: { id: 'c1' },
      };
      const res = createMockResponse();

      await handler(req, res);
      spy.mockRestore();

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({ error: 'update in progress' });
      expect(mockAgentClient.runRemoteTrigger).not.toHaveBeenCalled();
    });

    test('should reject route-agent/container-agent mismatch before enqueueing or calling the agent', async () => {
      const remoteAgentTrigger = {
        type: 'docker',
        name: 'update',
        agent: 'agent-a',
        configuration: {},
        getId: () => 'agent-a.docker.update',
        isTriggerIncluded: vi.fn().mockReturnValue(true),
        isTriggerExcluded: vi.fn().mockReturnValue(false),
        trigger: vi.fn().mockResolvedValue(undefined),
      };
      registry.getState.mockReturnValue({
        trigger: { 'agent-a.docker.update': remoteAgentTrigger },
      });

      const agentManagedContainer = {
        id: 'c1',
        name: 'nginx',
        agent: 'agent-b',
        updateAvailable: true,
        image: { name: 'nginx', tag: { value: 'v1.0' } },
        result: { tag: 'v2.0' },
      };
      mockGetContainer.mockReturnValue(agentManagedContainer);

      const mockAgentClient = {
        runRemoteTrigger: vi.fn().mockResolvedValue(undefined),
      };
      agent.getAgent.mockReturnValue(mockAgentClient);

      const requestSpy = vi.spyOn(requestUpdate, 'requestContainerUpdate');

      const handler = getRemoteTriggerHandler();
      const req = {
        params: { agent: 'agent-a', type: 'docker', name: 'update' },
        body: { id: 'c1' },
      };
      const res = createMockResponse();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Route agent agent-a does not own container agent-b.c1',
      });
      expect(requestSpy).not.toHaveBeenCalled();
      expect(remoteAgentTrigger.trigger).not.toHaveBeenCalled();
      expect(mockAgentClient.runRemoteTrigger).not.toHaveBeenCalled();

      requestSpy.mockRestore();
    });
  });

  describe('agent-qualified aliases cannot reach an agent action trigger', () => {
    const PROVIDERS = ['docker', 'dockercompose', 'portainer', 'command'];

    function keyRequest(scopes: string[], params: Record<string, string>) {
      return {
        params,
        body: { id: 'c1' },
        principal: { kind: 'api-key', keyId: 'abcdef012345', name: 'ci', scopes },
      };
    }

    function registerAgentProxy(agentName: string, type: string, name: string) {
      const proxy = {
        type,
        name,
        agent: agentName,
        configuration: {},
        getId: () => `${agentName}.${type}.${name}`,
        trigger: vi.fn().mockResolvedValue(undefined),
      };
      registry.getState.mockReturnValue({ trigger: { [`${agentName}.${type}.${name}`]: proxy } });
      return proxy;
    }

    test.each(PROVIDERS)(
      'a triggers:test key folding the agent into the type of a %s proxy is refused',
      async (provider) => {
        const proxy = registerAgentProxy('edge1', provider, 'update');
        const agentClient = { runRemoteTrigger: vi.fn() };
        agent.getAgent.mockReturnValue(agentClient);
        mockGetContainer.mockReturnValue({ id: 'c1', agent: 'edge1' });
        const spy = vi.spyOn(requestUpdate, 'requestContainerUpdate');
        const res = createMockResponse();

        await runTrigger(
          keyRequest(['triggers:test'], { type: `edge1.${provider}`, name: 'update' }),
          res,
        );

        expect(res.status).toHaveBeenCalledWith(404);
        expect(proxy.trigger).not.toHaveBeenCalled();
        expect(agentClient.runRemoteTrigger).not.toHaveBeenCalled();
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
      },
    );

    test('folding the agent and type into the name segment is refused too', async () => {
      const proxy = registerAgentProxy('slack', 'docker', 'update');
      const spy = vi.spyOn(requestUpdate, 'requestContainerUpdate');
      const res = createMockResponse();

      await runTrigger(
        keyRequest(['triggers:test'], { type: 'slack', name: 'docker.update' }),
        res,
      );

      expect(res.status).toHaveBeenCalledWith(404);
      expect(proxy.trigger).not.toHaveBeenCalled();
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    test('the same alias on the explicit agent route is refused', async () => {
      const proxy = registerAgentProxy('edge1', 'docker', 'update');
      const agentClient = { runRemoteTrigger: vi.fn() };
      agent.getAgent.mockReturnValue(agentClient);
      mockGetContainer.mockReturnValue({ id: 'c1', agent: 'edge1' });
      const spy = vi.spyOn(requestUpdate, 'requestContainerUpdate');
      const handler = getRemoteTriggerHandler();
      const res = createMockResponse();

      await handler(
        keyRequest(['triggers:test'], { type: 'edge1.docker', name: 'update', agent: 'x' }),
        res,
      );

      expect(res.status).not.toHaveBeenCalledWith(202);
      expect(proxy.trigger).not.toHaveBeenCalled();
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    test('a remote registry entry whose identity differs from the route is not run', async () => {
      // The registry key matches the route, but the component's own agent does not.
      const proxy = {
        type: 'docker',
        name: 'update',
        agent: 'other',
        trigger: vi.fn(),
      };
      registry.getState.mockReturnValue({ trigger: { 'my-agent.docker.update': proxy } });
      agent.getAgent.mockReturnValue({ runRemoteTrigger: vi.fn() });
      mockGetContainer.mockReturnValue({ id: 'c1', agent: 'my-agent' });
      const spy = vi.spyOn(requestUpdate, 'requestContainerUpdate');
      const res = createMockResponse();

      await getRemoteTriggerHandler()(
        { params: { agent: 'my-agent', type: 'docker', name: 'update' }, body: { id: 'c1' } },
        res,
      );

      expect(res.status).toHaveBeenCalledWith(404);
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    test('a canonical explicit-agent update with containers:update is accepted once, trigger not invoked directly', async () => {
      const proxy = registerAgentProxy('edge1', 'docker', 'update');
      agent.getAgent.mockReturnValue({ runRemoteTrigger: vi.fn() });
      mockGetContainer.mockReturnValue({ id: 'c1', agent: 'edge1' });
      const spy = vi
        .spyOn(requestUpdate, 'requestContainerUpdate')
        .mockResolvedValue({ operationId: 'op-1' } as never);
      const res = createMockResponse();

      await getRemoteTriggerHandler()(
        keyRequest(['containers:update'], { type: 'docker', name: 'update', agent: 'edge1' }),
        res,
      );

      expect(res.status).toHaveBeenCalledWith(202);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(proxy.trigger).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe('container actions feature flag', () => {
    function localKeyRequest(type: string) {
      return {
        params: { type, name: 'x' },
        body: { id: 'c1' },
        principal: {
          kind: 'api-key',
          keyId: 'abcdef012345',
          name: 'ci',
          scopes: ['containers:update', 'triggers:test'],
        },
      };
    }

    test.each(['docker', 'command'])(
      'refuses a local %s trigger with 403 when actions are disabled',
      async (type) => {
        mockActionsEnabled.mockReturnValue(false);
        const trigger = { type, name: 'x', trigger: vi.fn() };
        registry.getState.mockReturnValue({ trigger: { [`${type}.x`]: trigger } });
        const spy = vi.spyOn(requestUpdate, 'requestContainerUpdate');
        const res = createMockResponse();

        await runTrigger(localKeyRequest(type), res);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({ error: 'Container actions are disabled' });
        expect(spy).not.toHaveBeenCalled();
        expect(trigger.trigger).not.toHaveBeenCalled();
        spy.mockRestore();
      },
    );

    test('refuses a remote action trigger with 403 when actions are disabled', async () => {
      mockActionsEnabled.mockReturnValue(false);
      const spy = vi.spyOn(requestUpdate, 'requestContainerUpdate');
      const res = createMockResponse();

      await getRemoteTriggerHandler()(
        { ...localKeyRequest('docker'), params: { type: 'docker', name: 'x', agent: 'a' } },
        res,
      );

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'Container actions are disabled' });
      expect(agent.getAgent).not.toHaveBeenCalled();
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    test('scope is checked again against the resolved trigger and refuses a key that no longer holds it', async () => {
      // The route-level check passes on the first read; the post-resolution
      // check reads the scopes again and must be the one that refuses.
      let reads = 0;
      const principal = {
        kind: 'api-key',
        keyId: 'abcdef012345',
        name: 'ci',
        get scopes() {
          reads += 1;
          return reads === 1 ? ['triggers:test'] : [];
        },
      };
      const trigger = { type: 'slack', name: 'x', trigger: vi.fn() };
      registry.getState.mockReturnValue({ trigger: { 'slack.x': trigger } });
      const res = createMockResponse();

      await runTrigger(
        { params: { type: 'slack', name: 'x' }, body: { id: 'c1' }, principal },
        res,
      );

      expect(res.status).toHaveBeenCalledWith(403);
      expect(trigger.trigger).not.toHaveBeenCalled();
    });

    test('a notification trigger still fires when actions are disabled', async () => {
      mockActionsEnabled.mockReturnValue(false);
      const trigger = { type: 'slack', name: 'x', trigger: vi.fn().mockResolvedValue(undefined) };
      registry.getState.mockReturnValue({ trigger: { 'slack.x': trigger } });
      const res = createMockResponse();

      await runTrigger(localKeyRequest('slack'), res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(trigger.trigger).toHaveBeenCalledTimes(1);
    });
  });
});
