import { beforeEach, describe, expect, test } from 'vitest';
import * as manager from '../manager.js';
import AgentTrigger from './AgentTrigger.js';

const controllerMocks = vi.hoisted(() => {
  const delegate = {
    register: vi.fn(async function () {
      return this;
    }),
    trigger: vi.fn().mockResolvedValue('controller-update'),
    triggerBatch: vi.fn().mockResolvedValue('controller-batch-update'),
    getWatcher: vi.fn(),
    preview: vi.fn(),
    pullImage: vi.fn(),
    getCurrentContainer: vi.fn(),
    inspectContainer: vi.fn(),
    stopAndRemoveContainer: vi.fn(),
    recreateContainer: vi.fn(),
    reconcileInProgressContainerUpdateOperation: vi.fn(),
    deregister: vi.fn().mockResolvedValue(undefined),
  };
  return {
    delegate,
    // biome-ignore lint/complexity/useArrowFunction: constructor mock must remain constructable.
    DockerTrigger: vi.fn(function () {
      return delegate;
    }),
  };
});

vi.mock('../../triggers/providers/docker/Docker.js', () => ({
  default: controllerMocks.DockerTrigger,
}));

vi.mock('../../log/index.js', () => ({
  default: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

vi.mock('../../event/index.js', () => ({
  registerContainerReport: vi.fn(() => vi.fn()),
  registerContainerReports: vi.fn(() => vi.fn()),
  registerMaturityGateCleared: vi.fn(() => vi.fn()),
  registerContainerUpdateApplied: vi.fn(() => vi.fn()),
  registerContainerUpdateFailed: vi.fn(() => vi.fn()),
  registerSecurityAlert: vi.fn(() => vi.fn()),
  registerSecurityScanCycleComplete: vi.fn(() => vi.fn()),
  registerAgentConnected: vi.fn(() => vi.fn()),
  registerAgentDisconnected: vi.fn(() => vi.fn()),
  registerContainerHealthTransition: vi.fn(() => vi.fn()),
}));

vi.mock('../../prometheus/trigger.js', () => ({
  getTriggerCounter: () => ({ inc: vi.fn() }),
}));

vi.mock('../manager.js', () => ({
  getAgent: vi.fn(),
}));

describe('AgentTrigger', () => {
  let trigger;

  beforeEach(() => {
    vi.clearAllMocks();
    controllerMocks.delegate.register.mockImplementation(async function () {
      return this;
    });
    controllerMocks.delegate.trigger.mockResolvedValue('controller-update');
    controllerMocks.delegate.triggerBatch.mockResolvedValue('controller-batch-update');
    controllerMocks.delegate.preview.mockResolvedValue({ containerName: 'web' });
    controllerMocks.delegate.pullImage.mockResolvedValue(undefined);
    controllerMocks.delegate.getCurrentContainer.mockResolvedValue({ id: 'runtime-c1' });
    controllerMocks.delegate.inspectContainer.mockResolvedValue({ State: { Running: true } });
    controllerMocks.delegate.stopAndRemoveContainer.mockResolvedValue(undefined);
    controllerMocks.delegate.recreateContainer.mockResolvedValue({ id: 'replacement-c1' });
    controllerMocks.delegate.reconcileInProgressContainerUpdateOperation.mockResolvedValue(
      undefined,
    );
    trigger = new AgentTrigger();
    trigger.type = 'docker';
    trigger.name = 'update';
  });

  describe('trigger', () => {
    test('should throw when no agent is assigned', async () => {
      trigger.agent = undefined;
      await expect(trigger.trigger({ id: 'c1' })).rejects.toThrow(
        'AgentTrigger must have an agent assigned',
      );
    });

    test('should throw when agent is not found', async () => {
      trigger.agent = 'remote-agent';
      manager.getAgent.mockReturnValue(undefined);
      await expect(trigger.trigger({ id: 'c1' })).rejects.toThrow('Agent remote-agent not found');
    });

    test('should delegate to client.runRemoteTrigger', async () => {
      trigger.agent = 'remote-agent';
      const mockClient = { runRemoteTrigger: vi.fn().mockResolvedValue('ok') };
      manager.getAgent.mockReturnValue(mockClient);
      const container = { id: 'c1' };
      const result = await trigger.trigger(container);
      expect(mockClient.runRemoteTrigger).toHaveBeenCalledWith(
        container,
        'docker',
        'update',
        undefined,
      );
      expect(result).toBe('ok');
    });

    test('should forward runtimeContext to client.runRemoteTrigger', async () => {
      trigger.agent = 'remote-agent';
      const mockClient = { runRemoteTrigger: vi.fn().mockResolvedValue('ok') };
      manager.getAgent.mockReturnValue(mockClient);
      const container = { id: 'c1' };
      const runtimeContext = { operationId: 'uuid-controller-1' };
      await trigger.trigger(container, runtimeContext);
      expect(mockClient.runRemoteTrigger).toHaveBeenCalledWith(
        container,
        'docker',
        'update',
        runtimeContext,
      );
    });
  });

  describe('triggerBatch', () => {
    test('should throw when no agent is assigned', async () => {
      trigger.agent = undefined;
      await expect(trigger.triggerBatch([{ id: 'c1' }])).rejects.toThrow(
        'AgentTrigger must have an agent assigned',
      );
    });

    test('should throw when agent is not found', async () => {
      trigger.agent = 'remote-agent';
      manager.getAgent.mockReturnValue(undefined);
      await expect(trigger.triggerBatch([{ id: 'c1' }])).rejects.toThrow(
        'Agent remote-agent not found',
      );
    });

    test('should delegate to client.runRemoteTriggerBatch', async () => {
      trigger.agent = 'remote-agent';
      const mockClient = { runRemoteTriggerBatch: vi.fn().mockResolvedValue('ok') };
      manager.getAgent.mockReturnValue(mockClient);
      const containers = [{ id: 'c1' }, { id: 'c2' }];
      const result = await trigger.triggerBatch(containers);
      expect(mockClient.runRemoteTriggerBatch).toHaveBeenCalledWith(
        containers,
        'docker',
        'update',
        undefined,
      );
      expect(result).toBe('ok');
    });

    test('should forward runtimeContext to client.runRemoteTriggerBatch', async () => {
      trigger.agent = 'remote-agent';
      const mockClient = { runRemoteTriggerBatch: vi.fn().mockResolvedValue('ok') };
      manager.getAgent.mockReturnValue(mockClient);
      const containers = [{ id: 'c1' }, { id: 'c2' }];
      const runtimeContext = { operationIds: { c1: 'uuid-1', c2: 'uuid-2' } };
      await trigger.triggerBatch(containers, runtimeContext);
      expect(mockClient.runRemoteTriggerBatch).toHaveBeenCalledWith(
        containers,
        'docker',
        'update',
        runtimeContext,
      );
    });
  });

  describe('getConfigurationSchema', () => {
    test('should return a schema that allows unknown keys', () => {
      const schema = trigger.getConfigurationSchema();
      const result = schema.validate({ foo: 'bar', baz: 123 });
      expect(result.error).toBeUndefined();
    });
  });

  test('controller Docker transport delegates update execution locally and cleans up', async () => {
    const client = { runRemoteTrigger: vi.fn(), runRemoteTriggerBatch: vi.fn() };
    manager.getAgent.mockReturnValue(client);
    const runtimeContext = { operationId: 'controller-operation' };
    const container = { id: 'c1', name: 'web', watcher: 'docker', agent: 'remote-agent' };

    await trigger.register(
      'trigger',
      'docker',
      'update',
      {
        transport: 'docker-api',
        execution: 'controller',
        events: 'portwing',
        watcher: 'docker',
      },
      'remote-agent',
    );

    expect(controllerMocks.delegate.register).toHaveBeenCalledWith(
      'trigger',
      'docker',
      'update',
      {},
      'remote-agent',
    );
    expect(await trigger.trigger(container, runtimeContext)).toBe('controller-update');
    expect(controllerMocks.delegate.trigger).toHaveBeenCalledWith(container, runtimeContext);
    expect(client.runRemoteTrigger).not.toHaveBeenCalled();

    await trigger.deregister();
    expect(controllerMocks.delegate.deregister).toHaveBeenCalledOnce();
  });

  test('controller Docker transport propagates single and batch update failures', async () => {
    manager.getAgent.mockReturnValue({});
    await trigger.register(
      'trigger',
      'docker',
      'update',
      { transport: 'docker-api', execution: 'controller', events: 'portwing' },
      'remote-agent',
    );
    controllerMocks.delegate.trigger.mockRejectedValueOnce(new Error('single update failed'));
    controllerMocks.delegate.triggerBatch.mockRejectedValueOnce(new Error('batch update failed'));

    await expect(trigger.trigger({ id: 'c1' })).rejects.toThrow('single update failed');
    await expect(trigger.triggerBatch([{ id: 'c1' }, { id: 'c2' }])).rejects.toThrow(
      'batch update failed',
    );
  });

  test('controller Docker transport delegates action, preview, and rollback capabilities', async () => {
    manager.getAgent.mockReturnValue({});
    const dockerApi = { getContainer: vi.fn() };
    const watcher = { dockerApi };
    const runtimeContainer = { id: 'runtime-c1' };
    const inspected = { State: { Running: true } };
    const replacement = { id: 'replacement-c1' };
    const container = { id: 'c1', name: 'web', watcher: 'docker', agent: 'remote-agent' };
    const auth = { username: 'registry-user' };
    const log = { info: vi.fn(), warn: vi.fn() };
    controllerMocks.delegate.getWatcher.mockReturnValue(watcher);
    controllerMocks.delegate.getCurrentContainer.mockResolvedValue(runtimeContainer);
    controllerMocks.delegate.inspectContainer.mockResolvedValue(inspected);
    controllerMocks.delegate.recreateContainer.mockResolvedValue(replacement);

    await trigger.register(
      'trigger',
      'docker',
      'update',
      { transport: 'docker-api', execution: 'controller', events: 'portwing' },
      'remote-agent',
    );

    expect(trigger.getWatcher(container)).toBe(watcher);
    await expect(trigger.preview(container)).resolves.toEqual({ containerName: 'web' });
    expect(controllerMocks.delegate.preview).toHaveBeenCalledWith(container);

    await expect(trigger.pullImage(dockerApi, auth, 'nginx:1.26', log)).resolves.toBeUndefined();
    expect(controllerMocks.delegate.pullImage).toHaveBeenCalledWith(
      dockerApi,
      auth,
      'nginx:1.26',
      log,
    );
    await expect(trigger.getCurrentContainer(dockerApi, container)).resolves.toBe(runtimeContainer);
    expect(controllerMocks.delegate.getCurrentContainer).toHaveBeenCalledWith(dockerApi, container);
    await expect(trigger.inspectContainer(runtimeContainer, log)).resolves.toBe(inspected);
    expect(controllerMocks.delegate.inspectContainer).toHaveBeenCalledWith(runtimeContainer, log);
    await expect(
      trigger.stopAndRemoveContainer(runtimeContainer, inspected, container, log),
    ).resolves.toBeUndefined();
    expect(controllerMocks.delegate.stopAndRemoveContainer).toHaveBeenCalledWith(
      runtimeContainer,
      inspected,
      container,
      log,
    );
    await expect(
      trigger.recreateContainer(dockerApi, inspected, 'nginx:1.26', container, log),
    ).resolves.toBe(replacement);
    expect(controllerMocks.delegate.recreateContainer).toHaveBeenCalledWith(
      dockerApi,
      inspected,
      'nginx:1.26',
      container,
      log,
    );
    await expect(
      trigger.reconcileInProgressContainerUpdateOperation(dockerApi, container, log),
    ).resolves.toBeUndefined();
    expect(
      controllerMocks.delegate.reconcileInProgressContainerUpdateOperation,
    ).toHaveBeenCalledWith(dockerApi, container, log);
  });

  test('legacy remote mode keeps default preview behavior and rejects local-only Docker capabilities', async () => {
    manager.getAgent.mockReturnValue({});
    await trigger.register('trigger', 'docker', 'update', {}, 'remote-agent');
    const container = { id: 'c1', name: 'web', watcher: 'docker', agent: 'remote-agent' };

    await expect(trigger.preview(container)).resolves.toEqual({});
    expect(() => trigger.getWatcher(container)).toThrow(
      /does not advertise controller Docker transport/,
    );
    expect(() => trigger.pullImage({}, undefined, 'nginx:1.26', {})).toThrow(
      /does not advertise controller Docker transport/,
    );
    expect(() => trigger.getCurrentContainer({}, container)).toThrow(
      /does not advertise controller Docker transport/,
    );
    expect(() => trigger.inspectContainer({}, {})).toThrow(
      /does not advertise controller Docker transport/,
    );
    expect(() => trigger.stopAndRemoveContainer({}, {}, container, {})).toThrow(
      /does not advertise controller Docker transport/,
    );
    expect(() => trigger.recreateContainer({}, {}, 'nginx:1.26', container, {})).toThrow(
      /does not advertise controller Docker transport/,
    );

    await trigger.deregister();
  });
});
