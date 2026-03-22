import { watch } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getState } from '../../../registry/index.js';
import Dockercompose from './Dockercompose.js';
import {
  makeCompose,
  makeContainer,
  makeDockerContainerHandle,
  makeExecMocks,
  setupDockercomposeTestContext,
} from './Dockercompose.test.helpers.js';

vi.mock('../../../registry', () => ({
  getState: vi.fn(),
}));

vi.mock('../../../event/index.js', () => ({
  emitContainerUpdateApplied: vi.fn().mockResolvedValue(undefined),
  emitContainerUpdateFailed: vi.fn().mockResolvedValue(undefined),
  emitSecurityAlert: vi.fn().mockResolvedValue(undefined),
  emitSelfUpdateStarting: vi.fn(),
}));

vi.mock('../../../model/container.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fullName: vi.fn((c) => `test_${c.name}`),
  };
});

vi.mock('../../../store/backup', () => ({
  insertBackup: vi.fn(),
  pruneOldBackups: vi.fn(),
  getBackupsByName: vi.fn().mockReturnValue([]),
}));

// Modules used by the shared lifecycle (inherited from Docker trigger)
vi.mock('../../../configuration/index.js', async () => {
  const actual = await vi.importActual('../../../configuration/index.js');
  return { ...actual, getSecurityConfiguration: vi.fn().mockReturnValue({ enabled: false }) };
});
vi.mock('../../../store/audit.js', () => ({ insertAudit: vi.fn() }));
vi.mock('../../../prometheus/audit.js', () => ({ getAuditCounter: vi.fn().mockReturnValue(null) }));
vi.mock('../../../security/scan.js', () => ({
  scanImageForVulnerabilities: vi.fn(),
  verifyImageSignature: vi.fn(),
  generateImageSbom: vi.fn(),
  clearDigestScanCache: vi.fn(),
  getDigestScanCacheSize: vi.fn().mockReturnValue(0),
  updateDigestScanCache: vi.fn(),
  scanImageWithDedup: vi.fn(),
}));
vi.mock('../../../store/container.js', () => ({
  getContainer: vi.fn(),
  updateContainer: vi.fn(),
  cacheSecurityState: vi.fn(),
}));
vi.mock('../../hooks/HookRunner.js', () => ({ runHook: vi.fn() }));
vi.mock('../docker/HealthMonitor.js', () => ({ startHealthMonitor: vi.fn() }));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    watch: vi.fn(),
  };
});

vi.mock('../../../util/sleep.js', () => ({
  sleep: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    default: {
      ...actual.default,
      access: vi.fn().mockResolvedValue(undefined),
      copyFile: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockResolvedValue(Buffer.from('')),
      writeFile: vi.fn().mockResolvedValue(undefined),
      rename: vi.fn().mockResolvedValue(undefined),
      unlink: vi.fn().mockResolvedValue(undefined),
      stat: vi.fn().mockResolvedValue({ mtimeMs: Date.now() }),
    },
    access: vi.fn().mockResolvedValue(undefined),
    copyFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(Buffer.from('')),
    writeFile: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockResolvedValue({ mtimeMs: Date.now() }),
  };
});

describe('Dockercompose Trigger', () => {
  let trigger;
  let mockLog;
  let mockDockerApi;

  beforeEach(() => {
    ({ trigger, mockLog, mockDockerApi } = setupDockercomposeTestContext({
      DockercomposeCtor: Dockercompose,
      watchMock: watch,
      getStateMock: getState,
    }));
  });

  // compose command execution
  // -----------------------------------------------------------------------

  test('updateContainerWithCompose should skip Docker API calls in dry-run mode', async () => {
    trigger.configuration.dryrun = true;
    const pullImageSpy = vi.spyOn(trigger, 'pullImage').mockResolvedValue();
    const container = makeContainer({ name: 'nginx' });

    await trigger.updateContainerWithCompose('/opt/drydock/test/stack.yml', 'nginx', container);

    expect(pullImageSpy).not.toHaveBeenCalled();
    expect(mockLog.child).toHaveBeenCalledWith({ container: 'nginx' });
    expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('dry-run mode is enabled'));
  });

  test('updateContainerWithCompose should pull and recreate the target service via Docker API', async () => {
    trigger.configuration.dryrun = false;
    const pullImageSpy = vi.spyOn(trigger, 'pullImage').mockResolvedValue();
    const stopContainerSpy = vi.spyOn(trigger, 'stopContainer').mockResolvedValue();
    const removeContainerSpy = vi.spyOn(trigger, 'removeContainer').mockResolvedValue();
    const createContainerSpy = vi.spyOn(trigger, 'createContainer').mockResolvedValue({
      start: vi.fn().mockResolvedValue(undefined),
    } as any);
    const startContainerSpy = vi.spyOn(trigger, 'startContainer').mockResolvedValue();
    const container = makeContainer({ name: 'nginx' });

    await trigger.updateContainerWithCompose('/opt/drydock/test/stack.yml', 'nginx', container);

    expect(pullImageSpy).toHaveBeenCalledTimes(1);
    expect(stopContainerSpy).toHaveBeenCalledTimes(1);
    expect(removeContainerSpy).toHaveBeenCalledTimes(1);
    expect(createContainerSpy).toHaveBeenCalledTimes(1);
    expect(startContainerSpy).toHaveBeenCalledTimes(1);
  });

  test('updateContainerWithCompose should preserve stopped runtime state', async () => {
    trigger.configuration.dryrun = false;
    const pullImageSpy = vi.spyOn(trigger, 'pullImage').mockResolvedValue();
    const startContainerSpy = vi.spyOn(trigger, 'startContainer').mockResolvedValue();
    vi.spyOn(trigger, 'getCurrentContainer').mockResolvedValue(
      makeDockerContainerHandle({
        running: false,
      }),
    );
    const container = makeContainer({ name: 'nginx' });

    await trigger.updateContainerWithCompose('/opt/drydock/test/stack.yml', 'nginx', container);

    expect(pullImageSpy).toHaveBeenCalledTimes(1);
    expect(startContainerSpy).not.toHaveBeenCalled();
  });

  test('updateContainerWithCompose should skip pull when requested and still recreate', async () => {
    trigger.configuration.dryrun = false;
    const pullImageSpy = vi.spyOn(trigger, 'pullImage').mockResolvedValue();
    const createContainerSpy = vi.spyOn(trigger, 'createContainer').mockResolvedValue({
      start: vi.fn().mockResolvedValue(undefined),
    } as any);
    const container = makeContainer({ name: 'nginx' });

    await trigger.updateContainerWithCompose('/opt/drydock/test/stack.yml', 'nginx', container, {
      shouldStart: true,
      skipPull: true,
      forceRecreate: true,
    });

    expect(pullImageSpy).not.toHaveBeenCalled();
    expect(createContainerSpy).toHaveBeenCalledTimes(1);
  });

  test('updateContainerWithCompose should ignore compose file chain and use Docker API path', async () => {
    trigger.configuration.dryrun = false;
    const pullImageSpy = vi.spyOn(trigger, 'pullImage').mockResolvedValue();
    const container = makeContainer({ name: 'nginx' });
    const composeFiles = ['/opt/drydock/test/stack.yml', '/opt/drydock/test/stack.override.yml'];

    await trigger.updateContainerWithCompose('/opt/drydock/test/stack.yml', 'nginx', container, {
      shouldStart: true,
      skipPull: true,
      composeFiles,
    });

    expect(pullImageSpy).not.toHaveBeenCalled();
  });

  test('updateContainerWithCompose should reuse runtime context without resolving registry manager', async () => {
    trigger.configuration.dryrun = false;
    const container = makeContainer({ name: 'nginx' });
    const pullImageSpy = vi.spyOn(trigger, 'pullImage').mockResolvedValue();
    const resolveRegistryManagerSpy = vi.spyOn(trigger, 'resolveRegistryManager');
    const getWatcherSpy = vi.spyOn(trigger, 'getWatcher');
    const runtimeContext = {
      dockerApi: mockDockerApi,
      auth: { from: 'context' },
      newImage: 'nginx:9.9.9',
    };

    await trigger.updateContainerWithCompose('/opt/drydock/test/stack.yml', 'nginx', container, {
      runtimeContext,
    });

    expect(resolveRegistryManagerSpy).not.toHaveBeenCalled();
    expect(getWatcherSpy).not.toHaveBeenCalled();
    expect(pullImageSpy).toHaveBeenCalledWith(
      runtimeContext.dockerApi,
      runtimeContext.auth,
      runtimeContext.newImage,
      expect.anything(),
    );
  });

  test('updateContainerWithCompose should fetch auth when runtime context provides newImage without auth', async () => {
    trigger.configuration.dryrun = false;
    const container = makeContainer({ name: 'nginx' });
    const pullImageSpy = vi.spyOn(trigger, 'pullImage').mockResolvedValue();
    const resolveRegistryManagerSpy = vi.spyOn(trigger, 'resolveRegistryManager');
    const getNewImageFullNameSpy = vi.spyOn(trigger, 'getNewImageFullName');
    const registryGetAuthPull = vi.fn().mockResolvedValue({ from: 'registry-auth' });
    const runtimeContext = {
      dockerApi: mockDockerApi,
      newImage: 'nginx:9.9.9',
      registry: {
        getAuthPull: registryGetAuthPull,
      },
    };

    await trigger.updateContainerWithCompose('/opt/drydock/test/stack.yml', 'nginx', container, {
      runtimeContext,
    });

    expect(resolveRegistryManagerSpy).not.toHaveBeenCalled();
    expect(getNewImageFullNameSpy).not.toHaveBeenCalled();
    expect(registryGetAuthPull).toHaveBeenCalledTimes(1);
    expect(pullImageSpy).toHaveBeenCalledWith(
      runtimeContext.dockerApi,
      { from: 'registry-auth' },
      runtimeContext.newImage,
      expect.anything(),
    );
  });

  test('updateContainerWithCompose should throw when current container cannot be resolved', async () => {
    trigger.configuration.dryrun = false;
    const container = makeContainer({ name: 'nginx' });
    vi.spyOn(trigger, 'getCurrentContainer').mockResolvedValue(undefined);

    await expect(
      trigger.updateContainerWithCompose('/opt/drydock/test/stack.yml', 'nginx', container),
    ).rejects.toThrow(
      'Unable to refresh compose service nginx from /opt/drydock/test/stack.yml because container nginx no longer exists',
    );
  });

  test('updateContainerWithCompose should surface pullImage failures and stop before recreation', async () => {
    trigger.configuration.dryrun = false;
    const container = makeContainer({ name: 'nginx' });
    vi.spyOn(trigger, 'pullImage').mockRejectedValue(new Error('pull failed'));
    const stopContainerSpy = vi.spyOn(trigger, 'stopContainer').mockResolvedValue();
    const createContainerSpy = vi.spyOn(trigger, 'createContainer').mockResolvedValue({
      start: vi.fn().mockResolvedValue(undefined),
    } as any);

    await expect(
      trigger.updateContainerWithCompose('/opt/drydock/test/stack.yml', 'nginx', container),
    ).rejects.toThrow('pull failed');

    expect(stopContainerSpy).not.toHaveBeenCalled();
    expect(createContainerSpy).not.toHaveBeenCalled();
  });

  test('updateContainerWithCompose should surface stopAndRemoveContainer failures and skip recreation', async () => {
    trigger.configuration.dryrun = false;
    const container = makeContainer({ name: 'nginx' });
    vi.spyOn(trigger, 'pullImage').mockResolvedValue();
    vi.spyOn(trigger, 'stopContainer').mockRejectedValue(new Error('stop failed'));
    const createContainerSpy = vi.spyOn(trigger, 'createContainer').mockResolvedValue({
      start: vi.fn().mockResolvedValue(undefined),
    } as any);

    await expect(
      trigger.updateContainerWithCompose('/opt/drydock/test/stack.yml', 'nginx', container),
    ).rejects.toThrow('stop failed');

    expect(createContainerSpy).not.toHaveBeenCalled();
  });

  test('updateContainerWithCompose should surface recreateContainer failures', async () => {
    trigger.configuration.dryrun = false;
    const container = makeContainer({ name: 'nginx' });
    vi.spyOn(trigger, 'pullImage').mockResolvedValue();
    vi.spyOn(trigger, 'stopContainer').mockResolvedValue();
    vi.spyOn(trigger, 'removeContainer').mockResolvedValue();
    vi.spyOn(trigger, 'createContainer').mockRejectedValue(new Error('create failed'));

    await expect(
      trigger.updateContainerWithCompose('/opt/drydock/test/stack.yml', 'nginx', container),
    ).rejects.toThrow('create failed');
  });

  test('updateContainerWithCompose should throw when inspectContainer returns malformed runtime state', async () => {
    trigger.configuration.dryrun = false;
    const container = makeContainer({ name: 'nginx' });
    vi.spyOn(trigger, 'inspectContainer').mockResolvedValue({
      Config: { Image: 'nginx:1.0.0' },
    } as any);

    await expect(
      trigger.updateContainerWithCompose('/opt/drydock/test/stack.yml', 'nginx', container),
    ).rejects.toThrow(
      'Unable to refresh compose service nginx from /opt/drydock/test/stack.yml because Docker inspection data is missing runtime state',
    );
  });

  test('stopAndRemoveContainer should be a no-op with compose lifecycle log', async () => {
    await trigger.stopAndRemoveContainer({}, {}, { name: 'nginx' }, mockLog);

    expect(mockLog.info).toHaveBeenCalledWith(
      'Skip direct stop/remove for compose-managed container nginx; using compose lifecycle',
    );
  });

  test('recreateContainer should rewrite compose service image without routing through updateContainerWithCompose', async () => {
    const container = makeContainer({
      name: 'nginx',
      labels: {
        'dd.compose.file': '/opt/drydock/test/stack.yml',
        'com.docker.compose.service': 'nginx',
      },
    });
    const composeFileContent = [
      'services:',
      '  nginx:',
      '    # existing comment',
      '    image: nginx:1.1.0 # old image',
      '',
    ].join('\n');
    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(Buffer.from(composeFileContent));
    const writeComposeFileSpy = vi.spyOn(trigger, 'writeComposeFile').mockResolvedValue();
    const composeUpdateSpy = vi.spyOn(trigger, 'updateContainerWithCompose');
    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.1.0' } }),
    );

    await trigger.recreateContainer(
      mockDockerApi,
      {
        State: { Running: false },
        Config: { Image: 'nginx:1.1.0' },
      },
      'nginx:1.0.0',
      container,
      mockLog,
    );

    expect(writeComposeFileSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/stack.yml',
      expect.stringContaining('nginx:1.0.0'),
    );
    expect(writeComposeFileSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/stack.yml',
      expect.stringContaining('# existing comment'),
    );
    expect(composeUpdateSpy).not.toHaveBeenCalled();
  });

  test('recreateContainer should fallback to registry-derived image when current spec image is missing', async () => {
    const container = makeContainer({
      name: 'nginx',
      labels: {
        'dd.compose.file': '/opt/drydock/test/stack.yml',
        'com.docker.compose.service': 'nginx',
      },
    });
    const composeFileContent = ['services:', '  nginx:', '    image: nginx:1.1.0', ''].join('\n');
    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(Buffer.from(composeFileContent));
    vi.spyOn(trigger, 'writeComposeFile').mockResolvedValue();
    const resolveContextSpy = vi.spyOn(trigger, 'resolveComposeServiceContext');
    vi.spyOn(trigger, 'updateContainerWithCompose').mockResolvedValue();
    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.1.0' } }),
    );

    await trigger.recreateContainer(
      mockDockerApi,
      {
        State: { Running: true },
        Config: {},
      },
      'nginx:1.0.0',
      container,
      mockLog,
    );

    expect(resolveContextSpy).toHaveBeenCalledWith(container, 'nginx:1.0.0');
  });

  test('recreateContainer integration should update compose image and recreate via Docker API without pull', async () => {
    trigger.configuration.dryrun = false;
    const container = makeContainer({
      name: 'nginx',
      labels: {
        'dd.compose.file': '/opt/drydock/test/stack.yml',
        'com.docker.compose.service': 'nginx',
      },
    });
    const composeFileContent = ['services:', '  nginx:', '    image: nginx:1.1.0', ''].join('\n');
    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(Buffer.from(composeFileContent));
    const writeComposeFileSpy = vi.spyOn(trigger, 'writeComposeFile').mockResolvedValue();
    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.1.0' } }),
    );
    const pullImageSpy = vi.spyOn(trigger, 'pullImage').mockResolvedValue();
    const createContainerSpy = vi.spyOn(trigger, 'createContainer').mockResolvedValue({
      start: vi.fn().mockResolvedValue(undefined),
    } as any);

    await trigger.recreateContainer(
      mockDockerApi,
      {
        State: { Running: true },
        Config: { Image: 'nginx:1.1.0' },
      },
      'nginx:1.0.0',
      container,
      mockLog,
    );

    expect(writeComposeFileSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/stack.yml',
      expect.stringContaining('nginx:1.0.0'),
    );
    expect(pullImageSpy).not.toHaveBeenCalled();
    expect(createContainerSpy).toHaveBeenCalledTimes(1);
  });

  test('executeSelfUpdate should delegate to parent self-update transition with hydrated runtime context', async () => {
    trigger.configuration.dryrun = false;
    const container = makeContainer({
      name: 'drydock',
      imageName: 'codeswhat/drydock',
      labels: {
        'dd.compose.file': '/opt/drydock/test/stack.yml',
        'com.docker.compose.service': 'drydock',
      },
    });
    const composeContext = {
      composeFile: '/opt/drydock/test/stack.yml',
      service: 'drydock',
      serviceDefinition: {},
    };
    const currentContainer = makeDockerContainerHandle();
    const currentContainerSpec = {
      Id: 'current-id',
      Name: '/drydock',
      State: { Running: true },
      HostConfig: {
        Binds: ['/var/run/docker.sock:/var/run/docker.sock'],
      },
    };

    const getCurrentContainerSpy = vi
      .spyOn(trigger, 'getCurrentContainer')
      .mockResolvedValue(currentContainer);
    const inspectContainerSpy = vi
      .spyOn(trigger, 'inspectContainer')
      .mockResolvedValue(currentContainerSpec as any);
    const orchestratorExecuteSpy = vi
      .spyOn(trigger.selfUpdateOrchestrator, 'execute')
      .mockResolvedValue(true);
    const composeUpdateSpy = vi.spyOn(trigger, 'updateContainerWithCompose').mockResolvedValue();
    const hooksSpy = vi.spyOn(trigger, 'runServicePostStartHooks').mockResolvedValue();

    const updated = await trigger.executeSelfUpdate(
      {
        dockerApi: mockDockerApi,
        registry: getState().registry.hub,
        auth: {},
        newImage: 'codeswhat/drydock:1.1.0',
        currentContainer: null,
        currentContainerSpec: null,
      },
      container,
      mockLog,
      undefined,
      composeContext,
    );

    expect(updated).toBe(true);
    expect(getCurrentContainerSpy).toHaveBeenCalledWith(mockDockerApi, container);
    expect(inspectContainerSpy).toHaveBeenCalledWith(currentContainer, mockLog);
    expect(orchestratorExecuteSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        currentContainer,
        currentContainerSpec,
      }),
      container,
      mockLog,
      undefined,
    );
    expect(composeUpdateSpy).not.toHaveBeenCalled();
    expect(hooksSpy).not.toHaveBeenCalled();
  });

  test('executeSelfUpdate should reuse current container and inspection from context when available', async () => {
    trigger.configuration.dryrun = false;
    const container = makeContainer({
      name: 'drydock',
      imageName: 'codeswhat/drydock',
      labels: {
        'dd.compose.file': '/opt/drydock/test/stack.yml',
        'com.docker.compose.service': 'drydock',
      },
    });
    const composeContext = {
      composeFile: '/opt/drydock/test/stack.yml',
      service: 'drydock',
      serviceDefinition: {},
    };
    const currentContainer = makeDockerContainerHandle({ id: 'context-container-id' });
    const currentContainerSpec = {
      Id: 'context-id',
      Name: '/drydock',
      State: { Running: true },
      HostConfig: {
        Binds: ['/var/run/docker.sock:/var/run/docker.sock'],
      },
    };

    const getCurrentContainerSpy = vi
      .spyOn(trigger, 'getCurrentContainer')
      .mockResolvedValue(makeDockerContainerHandle({ id: 'fetched-id' }));
    const inspectContainerSpy = vi.spyOn(trigger, 'inspectContainer').mockResolvedValue({
      Id: 'fetched-id',
      State: { Running: true },
    } as any);
    const orchestratorExecuteSpy = vi
      .spyOn(trigger.selfUpdateOrchestrator, 'execute')
      .mockResolvedValue(true);

    const updated = await trigger.executeSelfUpdate(
      {
        dockerApi: mockDockerApi,
        registry: getState().registry.hub,
        auth: {},
        newImage: 'codeswhat/drydock:1.1.0',
        currentContainer,
        currentContainerSpec,
      },
      container,
      mockLog,
      'op-self-update-context',
      composeContext,
    );

    expect(updated).toBe(true);
    expect(getCurrentContainerSpy).not.toHaveBeenCalled();
    expect(inspectContainerSpy).not.toHaveBeenCalled();
    expect(orchestratorExecuteSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        currentContainer,
        currentContainerSpec,
      }),
      container,
      mockLog,
      'op-self-update-context',
    );
  });

  test('executeSelfUpdate should inspect context current container when inspection is missing', async () => {
    trigger.configuration.dryrun = false;
    const container = makeContainer({
      name: 'drydock',
      imageName: 'codeswhat/drydock',
      labels: {
        'dd.compose.file': '/opt/drydock/test/stack.yml',
        'com.docker.compose.service': 'drydock',
      },
    });
    const composeContext = {
      composeFile: '/opt/drydock/test/stack.yml',
      service: 'drydock',
      serviceDefinition: {},
    };
    const currentContainer = makeDockerContainerHandle({ id: 'context-container-id' });
    const currentContainerSpec = {
      Id: 'context-inspected-id',
      Name: '/drydock',
      State: { Running: true },
      HostConfig: {
        Binds: ['/var/run/docker.sock:/var/run/docker.sock'],
      },
    };

    const getCurrentContainerSpy = vi
      .spyOn(trigger, 'getCurrentContainer')
      .mockResolvedValue(makeDockerContainerHandle({ id: 'fetched-id' }));
    const inspectContainerSpy = vi
      .spyOn(trigger, 'inspectContainer')
      .mockResolvedValue(currentContainerSpec as any);
    const orchestratorExecuteSpy = vi
      .spyOn(trigger.selfUpdateOrchestrator, 'execute')
      .mockResolvedValue(true);

    const updated = await trigger.executeSelfUpdate(
      {
        dockerApi: mockDockerApi,
        registry: getState().registry.hub,
        auth: {},
        newImage: 'codeswhat/drydock:1.1.0',
        currentContainer,
        currentContainerSpec: null,
      },
      container,
      mockLog,
      undefined,
      composeContext,
    );

    expect(updated).toBe(true);
    expect(getCurrentContainerSpy).not.toHaveBeenCalled();
    expect(inspectContainerSpy).toHaveBeenCalledWith(currentContainer, mockLog);
    expect(orchestratorExecuteSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        currentContainer,
        currentContainerSpec,
      }),
      container,
      mockLog,
      undefined,
    );
  });

  test('performContainerUpdate should throw when compose context is missing', async () => {
    await expect(
      trigger.performContainerUpdate(
        {},
        {
          name: 'missing-container',
        },
      ),
    ).rejects.toThrow('Missing compose context for container missing-container');
  });

  test('executeSelfUpdate should throw when compose context is missing', async () => {
    await expect(
      trigger.executeSelfUpdate(
        {
          dockerApi: mockDockerApi,
          registry: getState().registry.hub,
          auth: {},
          newImage: 'codeswhat/drydock:1.1.0',
          currentContainer: null,
          currentContainerSpec: null,
        },
        {
          name: 'drydock',
        },
        mockLog,
      ),
    ).rejects.toThrow('Missing compose context for self-update container drydock');
  });

  test('executeSelfUpdate should skip work in dry-run mode', async () => {
    trigger.configuration.dryrun = true;
    const composeContext = {
      composeFile: '/opt/drydock/test/stack.yml',
      service: 'drydock',
      serviceDefinition: {},
    };
    const composeUpdateSpy = vi.spyOn(trigger, 'updateContainerWithCompose').mockResolvedValue();
    const hooksSpy = vi.spyOn(trigger, 'runServicePostStartHooks').mockResolvedValue();
    const getCurrentContainerSpy = vi
      .spyOn(trigger, 'getCurrentContainer')
      .mockResolvedValue(makeDockerContainerHandle());
    const orchestratorExecuteSpy = vi
      .spyOn(trigger.selfUpdateOrchestrator, 'execute')
      .mockResolvedValue(true);

    const updated = await trigger.executeSelfUpdate(
      {
        dockerApi: mockDockerApi,
        registry: getState().registry.hub,
        auth: {},
        newImage: 'codeswhat/drydock:1.1.0',
        currentContainer: null,
        currentContainerSpec: null,
      },
      {
        name: 'drydock',
      },
      mockLog,
      undefined,
      composeContext,
    );

    expect(updated).toBe(false);
    expect(composeUpdateSpy).not.toHaveBeenCalled();
    expect(hooksSpy).not.toHaveBeenCalled();
    expect(getCurrentContainerSpy).not.toHaveBeenCalled();
    expect(orchestratorExecuteSpy).not.toHaveBeenCalled();
    expect(mockLog.info).toHaveBeenCalledWith(
      'Do not replace the existing container because dry-run mode is enabled',
    );
  });

  test('resolveComposeFilePath should allow absolute compose files while blocking relative traversal when boundary is enforced', () => {
    const composeFilePathOutsideWorkingDirectory = path.resolve(
      process.cwd(),
      '..',
      'outside',
      'stack.yml',
    );

    expect(trigger.resolveComposeFilePath(composeFilePathOutsideWorkingDirectory)).toBe(
      composeFilePathOutsideWorkingDirectory,
    );
    expect(
      trigger.resolveComposeFilePath(composeFilePathOutsideWorkingDirectory, {
        enforceWorkingDirectoryBoundary: true,
      }),
    ).toBe(composeFilePathOutsideWorkingDirectory);
    expect(() =>
      trigger.resolveComposeFilePath('../outside/stack.yml', {
        enforceWorkingDirectoryBoundary: true,
      }),
    ).toThrow(/Compose file path must stay inside/);
    expect(() =>
      trigger.resolveComposeFilePath(composeFilePathOutsideWorkingDirectory, {
        enforceWorkingDirectoryBoundary: true,
      }),
    ).not.toThrow();
  });

  test('resolveComposeFilePathFromDirectory should return original path when target is a file', async () => {
    fs.stat.mockResolvedValueOnce({
      isDirectory: () => false,
      mtimeMs: 1_700_000_000_000,
    } as any);

    const resolved = await trigger.resolveComposeFilePathFromDirectory(
      '/opt/drydock/test/stack.yml',
    );

    expect(resolved).toBe('/opt/drydock/test/stack.yml');
  });

  test('resolveComposeFilePathFromDirectory should warn and return null when directory has no compose candidates', async () => {
    fs.stat.mockResolvedValueOnce({
      isDirectory: () => true,
      mtimeMs: 1_700_000_000_000,
    } as any);
    const missingComposeFileError = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    fs.access
      .mockRejectedValueOnce(missingComposeFileError)
      .mockRejectedValueOnce(missingComposeFileError)
      .mockRejectedValueOnce(missingComposeFileError)
      .mockRejectedValueOnce(missingComposeFileError);

    const resolved = await trigger.resolveComposeFilePathFromDirectory('/opt/drydock/test/stack');

    expect(resolved).toBeNull();
    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.stringContaining('does not contain a compose file candidate'),
    );
  });

  test('resolveComposeServiceContext should throw when no compose file is configured', async () => {
    trigger.configuration.file = undefined;

    await expect(
      trigger.resolveComposeServiceContext(
        {
          name: 'nginx',
          watcher: 'local',
        },
        'nginx:1.0.0',
      ),
    ).rejects.toThrow('No compose file configured for nginx');
  });

  test('resolveComposeServiceContext should throw when service cannot be resolved from compose file', async () => {
    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ redis: { image: 'redis:7.0.0' } }),
    );

    await expect(
      trigger.resolveComposeServiceContext(
        {
          name: 'nginx',
          watcher: 'local',
          labels: {
            'dd.compose.file': '/opt/drydock/test/stack.yml',
          },
          image: {
            name: 'nginx',
            registry: { name: 'hub' },
            tag: { value: '1.0.0' },
          },
        },
        'nginx:1.0.0',
      ),
    ).rejects.toThrow(
      'Unable to resolve compose service for nginx from /opt/drydock/test/stack.yml',
    );
  });

  test('resolveComposeServiceContext should return compose file chain and deterministic writable file', async () => {
    vi.spyOn(trigger, 'getComposeFileAsObject')
      .mockResolvedValueOnce(makeCompose({ nginx: { image: 'nginx:1.0.0' } }))
      .mockResolvedValueOnce(makeCompose({ nginx: { image: 'nginx:1.1.0' } }));

    const context = await trigger.resolveComposeServiceContext(
      {
        name: 'nginx',
        watcher: 'local',
        labels: {
          'com.docker.compose.project.config_files':
            '/opt/drydock/test/stack.yml,/opt/drydock/test/stack.override.yml',
          'com.docker.compose.service': 'nginx',
        },
        image: {
          name: 'nginx',
          registry: { name: 'hub' },
          tag: { value: '1.0.0' },
        },
      },
      'nginx:1.0.0',
    );

    expect(context.composeFiles).toEqual([
      '/opt/drydock/test/stack.yml',
      '/opt/drydock/test/stack.override.yml',
    ]);
    expect(context.composeFile).toBe('/opt/drydock/test/stack.override.yml');
  });

  // -----------------------------------------------------------------------
  // runServicePostStartHooks
  // -----------------------------------------------------------------------

  test('runServicePostStartHooks should execute configured hooks on recreated container', async () => {
    trigger.configuration.dryrun = false;
    const container = { name: 'netbox', watcher: 'local' };
    const { recreatedContainer, mockExec } = makeExecMocks();
    mockDockerApi.getContainer.mockReturnValue(recreatedContainer);

    await trigger.runServicePostStartHooks(container, 'netbox', {
      post_start: [
        {
          command: 'echo hello',
          user: 'root',
          working_dir: '/tmp',
          privileged: true,
          environment: { TEST: '1' },
        },
      ],
    });

    expect(recreatedContainer.exec).toHaveBeenCalledWith(
      expect.objectContaining({
        Cmd: ['sh', '-c', 'echo hello'],
        User: 'root',
        WorkingDir: '/tmp',
        Privileged: true,
        Env: ['TEST=1'],
      }),
    );
    expect(mockExec.inspect).toHaveBeenCalledTimes(1);
  });

  test('runServicePostStartHooks should support string hook syntax', async () => {
    trigger.configuration.dryrun = false;
    const container = { name: 'netbox', watcher: 'local' };
    const { recreatedContainer } = makeExecMocks();
    mockDockerApi.getContainer.mockReturnValue(recreatedContainer);

    await trigger.runServicePostStartHooks(container, 'netbox', {
      post_start: ['echo hello'],
    });

    expect(recreatedContainer.exec).toHaveBeenCalledWith(
      expect.objectContaining({
        Cmd: ['sh', '-c', 'echo hello'],
      }),
    );
  });

  test('runServicePostStartHooks should skip when dryrun is true', async () => {
    trigger.configuration.dryrun = true;
    const container = { name: 'netbox', watcher: 'local' };

    await trigger.runServicePostStartHooks(container, 'netbox', {
      post_start: ['echo hello'],
    });

    expect(mockDockerApi.getContainer).not.toHaveBeenCalled();
  });

  test('runServicePostStartHooks should skip when service has no post_start', async () => {
    trigger.configuration.dryrun = false;
    const container = { name: 'netbox', watcher: 'local' };

    await trigger.runServicePostStartHooks(container, 'netbox', {});

    expect(mockDockerApi.getContainer).not.toHaveBeenCalled();
  });

  test('runServicePostStartHooks should warn when watcher dockerApi is unavailable', async () => {
    trigger.configuration.dryrun = false;

    await trigger.runServicePostStartHooks(
      {
        name: 'ghost',
        watcher: 'missing',
      },
      'ghost',
      { post_start: ['echo hello'] },
    );

    expect(mockLog.warn).toHaveBeenCalledWith(
      'Skip compose post_start hooks for ghost (ghost) because watcher Docker API is unavailable',
    );
  });

  test('runServicePostStartHooks should skip when container is not running', async () => {
    trigger.configuration.dryrun = false;
    const container = { name: 'netbox', watcher: 'local' };
    const recreatedContainer = {
      inspect: vi.fn().mockResolvedValue({
        State: { Running: false },
      }),
    };
    mockDockerApi.getContainer.mockReturnValue(recreatedContainer);

    await trigger.runServicePostStartHooks(container, 'netbox', {
      post_start: ['echo hello'],
    });

    expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('not running'));
  });

  test('runServicePostStartHooks should skip hook with no command', async () => {
    trigger.configuration.dryrun = false;
    const container = { name: 'netbox', watcher: 'local' };
    const recreatedContainer = {
      inspect: vi.fn().mockResolvedValue({
        State: { Running: true },
      }),
      exec: vi.fn(),
    };
    mockDockerApi.getContainer.mockReturnValue(recreatedContainer);

    await trigger.runServicePostStartHooks(container, 'netbox', {
      post_start: [{ user: 'root' }],
    });

    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('command is missing'));
    expect(recreatedContainer.exec).not.toHaveBeenCalled();
  });

  test('runServicePostStartHooks should throw on non-zero exit code', async () => {
    trigger.configuration.dryrun = false;
    const container = { name: 'netbox', watcher: 'local' };
    const { recreatedContainer } = makeExecMocks({ exitCode: 1, streamEvent: 'end' });
    mockDockerApi.getContainer.mockReturnValue(recreatedContainer);

    await expect(
      trigger.runServicePostStartHooks(container, 'netbox', {
        post_start: ['failing-command'],
      }),
    ).rejects.toThrow('exit code 1');
  });

  test('runServicePostStartHooks should handle exec stream error', async () => {
    trigger.configuration.dryrun = false;
    const container = { name: 'netbox', watcher: 'local' };
    const { recreatedContainer } = makeExecMocks({
      streamError: new Error('stream failure'),
    });
    mockDockerApi.getContainer.mockReturnValue(recreatedContainer);

    await expect(
      trigger.runServicePostStartHooks(container, 'netbox', {
        post_start: ['echo hello'],
      }),
    ).rejects.toThrow('stream failure');
  });

  test('runServicePostStartHooks should handle stream without resume', async () => {
    trigger.configuration.dryrun = false;
    const container = { name: 'netbox', watcher: 'local' };
    const { recreatedContainer, mockExec } = makeExecMocks({ hasResume: false });
    mockDockerApi.getContainer.mockReturnValue(recreatedContainer);

    await trigger.runServicePostStartHooks(container, 'netbox', {
      post_start: ['echo hello'],
    });

    expect(mockExec.inspect).toHaveBeenCalled();
  });

  test('runServicePostStartHooks should handle stream without once', async () => {
    trigger.configuration.dryrun = false;
    const container = { name: 'netbox', watcher: 'local' };
    const { recreatedContainer, mockExec } = makeExecMocks({ hasOnce: false });
    mockDockerApi.getContainer.mockReturnValue(recreatedContainer);

    await trigger.runServicePostStartHooks(container, 'netbox', {
      post_start: ['echo hello'],
    });

    expect(mockExec.inspect).toHaveBeenCalled();
  });

  test('runServicePostStartHooks should support array command form', async () => {
    trigger.configuration.dryrun = false;
    const container = { name: 'netbox', watcher: 'local' };
    const { recreatedContainer } = makeExecMocks();
    mockDockerApi.getContainer.mockReturnValue(recreatedContainer);

    await trigger.runServicePostStartHooks(container, 'netbox', {
      post_start: [{ command: ['echo', 'hello'] }],
    });

    expect(recreatedContainer.exec).toHaveBeenCalledWith(
      expect.objectContaining({
        Cmd: ['echo', 'hello'],
      }),
    );
  });

  test('runServicePostStartHooks should support environment as array', async () => {
    trigger.configuration.dryrun = false;
    const container = { name: 'netbox', watcher: 'local' };
    const { recreatedContainer } = makeExecMocks();
    mockDockerApi.getContainer.mockReturnValue(recreatedContainer);

    await trigger.runServicePostStartHooks(container, 'netbox', {
      post_start: [{ command: 'echo hello', environment: ['FOO=bar', 'BAZ=1'] }],
    });

    expect(recreatedContainer.exec).toHaveBeenCalledWith(
      expect.objectContaining({
        Env: ['FOO=bar', 'BAZ=1'],
      }),
    );
  });

  test('runServicePostStartHooks should support environment array entries without equals sign', async () => {
    trigger.configuration.dryrun = false;
    const container = { name: 'netbox', watcher: 'local' };
    const { recreatedContainer } = makeExecMocks();
    mockDockerApi.getContainer.mockReturnValue(recreatedContainer);

    await trigger.runServicePostStartHooks(container, 'netbox', {
      post_start: [{ command: 'echo hello', environment: ['FOO', 'BAR=1'] }],
    });

    expect(recreatedContainer.exec).toHaveBeenCalledWith(
      expect.objectContaining({
        Env: ['FOO', 'BAR=1'],
      }),
    );
  });

  test('runServicePostStartHooks should reject object environment with invalid key', async () => {
    trigger.configuration.dryrun = false;
    const container = { name: 'netbox', watcher: 'local' };
    const { recreatedContainer } = makeExecMocks();
    mockDockerApi.getContainer.mockReturnValue(recreatedContainer);

    await expect(
      trigger.runServicePostStartHooks(container, 'netbox', {
        post_start: [{ command: 'echo hello', environment: { 'INVALID-KEY': '1' } }],
      }),
    ).rejects.toThrow('Invalid compose post_start environment variable key "INVALID-KEY"');

    expect(recreatedContainer.exec).not.toHaveBeenCalled();
  });

  test('runServicePostStartHooks should reject array environment with invalid key', async () => {
    trigger.configuration.dryrun = false;
    const container = { name: 'netbox', watcher: 'local' };
    const { recreatedContainer } = makeExecMocks();
    mockDockerApi.getContainer.mockReturnValue(recreatedContainer);

    await expect(
      trigger.runServicePostStartHooks(container, 'netbox', {
        post_start: [{ command: 'echo hello', environment: ['INVALID-KEY=1'] }],
      }),
    ).rejects.toThrow('Invalid compose post_start environment variable key "INVALID-KEY"');

    expect(recreatedContainer.exec).not.toHaveBeenCalled();
  });

  test('runServicePostStartHooks should normalize single post_start hook (not array)', async () => {
    trigger.configuration.dryrun = false;
    const container = { name: 'netbox', watcher: 'local' };
    const { recreatedContainer } = makeExecMocks();
    mockDockerApi.getContainer.mockReturnValue(recreatedContainer);

    await trigger.runServicePostStartHooks(container, 'netbox', {
      post_start: { command: 'echo hello' },
    });

    expect(recreatedContainer.exec).toHaveBeenCalledWith(
      expect.objectContaining({
        Cmd: ['sh', '-c', 'echo hello'],
      }),
    );
  });

  test('runServicePostStartHooks should return early when normalized hooks array is empty', async () => {
    trigger.configuration.dryrun = false;
    const container = { name: 'netbox', watcher: 'local' };

    await trigger.runServicePostStartHooks(container, 'netbox', {
      post_start: [],
    });

    expect(mockDockerApi.getContainer).not.toHaveBeenCalled();
  });

  test('runServicePostStartHooks should handle environment with null values', async () => {
    trigger.configuration.dryrun = false;
    const container = { name: 'netbox', watcher: 'local' };
    const { recreatedContainer } = makeExecMocks();
    mockDockerApi.getContainer.mockReturnValue(recreatedContainer);

    await trigger.runServicePostStartHooks(container, 'netbox', {
      post_start: [{ command: 'echo hello', environment: { KEY: null } }],
    });

    expect(recreatedContainer.exec).toHaveBeenCalledWith(
      expect.objectContaining({
        Env: ['KEY='],
      }),
    );
  });

  test('runServicePostStartHooks should JSON-stringify object environment values', async () => {
    trigger.configuration.dryrun = false;
    const container = { name: 'netbox', watcher: 'local' };
    const { recreatedContainer } = makeExecMocks();
    mockDockerApi.getContainer.mockReturnValue(recreatedContainer);

    await trigger.runServicePostStartHooks(container, 'netbox', {
      post_start: [{ command: 'echo hello', environment: { KEY: { nested: 'value' } } }],
    });

    expect(recreatedContainer.exec).toHaveBeenCalledWith(
      expect.objectContaining({
        Env: ['KEY={"nested":"value"}'],
      }),
    );
  });

  // -----------------------------------------------------------------------
});
