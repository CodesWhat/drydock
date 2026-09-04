import { watch } from 'node:fs';
import fs from 'node:fs/promises';
import { getState } from '../../../registry/index.js';
import * as updateOperationStore from '../../../store/update-operation.js';
import { getRequestedOperationId } from '../docker/update-runtime-context.js';
import Dockercompose from './Dockercompose.js';
import {
  invokeComposeRefreshPostPullHook,
  makeCompose,
  makeContainer,
  makeDockerContainerHandle,
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
  getBackupsForContainer: vi.fn().mockReturnValue([]),
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
  getContainers: vi.fn().mockReturnValue([]),
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

  test('buildUpdatedComposeFileObjectForValidation should normalize non-object service sections and entries', () => {
    const updatedFromInvalidServices = trigger.buildUpdatedComposeFileObjectForValidation(
      { version: '3.9', services: 'invalid' },
      new Map([['nginx', 'nginx:1.1.0']]),
    ) as any;
    const updatedFromScalarService = trigger.buildUpdatedComposeFileObjectForValidation(
      { services: { nginx: 'legacy' } },
      new Map([['nginx', 'nginx:1.1.0']]),
    ) as any;

    expect(updatedFromInvalidServices.services).toEqual({
      nginx: { image: 'nginx:1.1.0' },
    });
    expect(updatedFromScalarService.services.nginx).toEqual({
      image: 'nginx:1.1.0',
    });
  });

  test('reconcileComposeMappings should no-op when reconciliation mode is off', () => {
    trigger.configuration.reconciliationMode = 'off';

    expect(() =>
      trigger.reconcileComposeMappings('stack.yml', [
        {
          service: 'nginx',
          runtimeNormalized: 'nginx:1.1.0',
          currentNormalized: 'nginx:1.0.0',
          runtimeImage: 'nginx:1.1.0',
          current: 'nginx:1.0.0',
        },
      ]),
    ).not.toThrow();
    expect(mockLog.warn).not.toHaveBeenCalled();
  });

  test('getComposeFileChainAsObject should skip compose documents without service maps', async () => {
    const composeFiles = ['/opt/drydock/test/base.yml', '/opt/drydock/test/override.yml'];
    const composeByFile = new Map<string, any>([
      ['/opt/drydock/test/base.yml', { volumes: { data: {} } }],
      ['/opt/drydock/test/override.yml', { services: { nginx: { image: 'nginx:1.1.0' } } }],
    ]);

    const compose = await trigger.getComposeFileChainAsObject(composeFiles, composeByFile);

    expect(compose).toEqual({
      services: {
        nginx: { image: 'nginx:1.1.0' },
      },
    });
  });

  test('getComposeFileChainAsObject should load compose files when composeByFile cache is not provided', async () => {
    vi.spyOn(trigger, 'getComposeFileAsObject')
      .mockResolvedValueOnce({ services: { nginx: { image: 'nginx:1.0.0' } } })
      .mockResolvedValueOnce({ services: { redis: { image: 'redis:7.0.0' } } });

    const compose = await trigger.getComposeFileChainAsObject([
      '/opt/drydock/test/stack.yml',
      '/opt/drydock/test/stack.override.yml',
    ]);

    expect(compose).toEqual({
      services: {
        nginx: { image: 'nginx:1.0.0' },
        redis: { image: 'redis:7.0.0' },
      },
    });
  });

  test('getComposeFileChainAsObject should continue when loaded compose file has no services section', async () => {
    vi.spyOn(trigger, 'getComposeFileAsObject')
      .mockResolvedValueOnce({ version: '3.9' })
      .mockResolvedValueOnce({ services: { nginx: { image: 'nginx:1.0.0' } } });

    const compose = await trigger.getComposeFileChainAsObject([
      '/opt/drydock/test/stack.yml',
      '/opt/drydock/test/stack.override.yml',
    ]);

    expect(compose.services).toEqual({
      nginx: { image: 'nginx:1.0.0' },
    });
  });

  test('getWritableComposeFileForService should throw the last write-access error', async () => {
    const accessError = new Error('permission denied');
    fs.access.mockRejectedValueOnce(accessError).mockRejectedValueOnce(accessError);

    await expect(
      trigger.getWritableComposeFileForService(
        ['/opt/drydock/test/base.yml', '/opt/drydock/test/override.yml'],
        'nginx',
        new Map<string, unknown>([
          ['/opt/drydock/test/base.yml', { services: { nginx: { image: 'nginx:1.0.0' } } }],
          ['/opt/drydock/test/override.yml', { services: { nginx: { image: 'nginx:1.1.0' } } }],
        ]),
      ),
    ).rejects.toBe(accessError);
  });

  test('getWritableComposeFileForService should load compose files when compose cache is not provided', async () => {
    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue({
      services: { nginx: { image: 'nginx:1.0.0' } },
    } as any);

    const composeFile = await trigger.getWritableComposeFileForService(
      ['/opt/drydock/test/stack.yml'],
      'nginx',
    );

    expect(composeFile).toBe('/opt/drydock/test/stack.yml');
  });

  test('getWritableComposeFileForService should fall back to the first compose file when service is absent', async () => {
    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue({
      services: { redis: { image: 'redis:7.0.0' } },
    } as any);

    const composeFile = await trigger.getWritableComposeFileForService(
      ['/opt/drydock/test/stack.yml'],
      'nginx',
    );

    expect(composeFile).toBe('/opt/drydock/test/stack.yml');
  });

  test('getWritableComposeFileForService should tolerate undefined compose documents when resolving service ownership', async () => {
    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(undefined as any);

    const composeFile = await trigger.getWritableComposeFileForService(
      ['/opt/drydock/test/stack.yml'],
      'nginx',
    );

    expect(composeFile).toBe('/opt/drydock/test/stack.yml');
  });

  test('validateComposeConfiguration should throw when the updated compose text is invalid YAML', async () => {
    await expect(
      trigger.validateComposeConfiguration(
        '/opt/drydock/test/compose.yml',
        'services:\n  nginx: [\n',
      ),
    ).rejects.toThrow('Error when validating compose configuration');
  });

  test('mutateComposeFile should validate compose chain when multiple compose files are provided', async () => {
    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(
      Buffer.from('services:\n  nginx:\n    image: nginx:1.0.0\n'),
    );
    fs.stat.mockResolvedValueOnce({ mtimeMs: 1_700_000_000_000 } as any);
    const validateSpy = vi
      .spyOn(trigger, 'validateComposeConfiguration')
      .mockResolvedValue(undefined);
    vi.spyOn(trigger, 'writeComposeFile').mockResolvedValue();

    const changed = await trigger.mutateComposeFile(
      '/opt/drydock/test/stack.override.yml',
      (text) => text.replace('1.0.0', '1.1.0'),
      {
        composeFiles: ['/opt/drydock/test/stack.yml', '/opt/drydock/test/stack.override.yml'],
      },
    );

    expect(changed).toBe(true);
    expect(validateSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/stack.override.yml',
      expect.stringContaining('1.1.0'),
      {
        composeFiles: ['/opt/drydock/test/stack.yml', '/opt/drydock/test/stack.override.yml'],
      },
    );
  });

  test('buildPerformContainerUpdateOptions should compose options without duplicate spread logic', () => {
    const runtimeContext = {
      dockerApi: mockDockerApi,
      auth: { from: 'context' },
      newImage: 'nginx:9.9.9',
      registry: getState().registry.hub,
    };

    const options = (trigger as any).buildPerformContainerUpdateOptions(
      {
        composeFiles: ['/opt/drydock/test/stack.yml', '/opt/drydock/test/stack.override.yml'],
        skipPull: true,
      },
      runtimeContext,
    );

    expect(options).toEqual({
      composeFiles: ['/opt/drydock/test/stack.yml', '/opt/drydock/test/stack.override.yml'],
      skipPull: true,
      runtimeContext,
    });
  });

  test('buildPerformContainerUpdateOptions should omit runtime context and compose chain when not needed', () => {
    const options = (trigger as any).buildPerformContainerUpdateOptions(
      {
        composeFiles: ['/opt/drydock/test/stack.yml'],
      },
      {},
    );

    expect(options).toEqual({});
  });

  test('performContainerUpdate should pass compose chain to per-service update', async () => {
    trigger.configuration.dryrun = false;
    const container = makeContainer({
      name: 'nginx',
    });
    const updateContainerWithComposeSpy = vi
      .spyOn(trigger, 'updateContainerWithCompose')
      .mockResolvedValue();
    vi.spyOn(trigger, 'runServicePostStartHooks').mockResolvedValue();

    const updated = await trigger.performContainerUpdate({} as any, container as any, mockLog, {
      composeFile: '/opt/drydock/test/stack.override.yml',
      composeFiles: ['/opt/drydock/test/stack.yml', '/opt/drydock/test/stack.override.yml'],
      service: 'nginx',
      serviceDefinition: {},
      composeFileOnceApplied: false,
    } as any);

    expect(updated).toBe(true);
    expect(updateContainerWithComposeSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/stack.override.yml',
      'nginx',
      container,
      {
        composeFiles: ['/opt/drydock/test/stack.yml', '/opt/drydock/test/stack.override.yml'],
      },
    );
  });

  test('performContainerUpdate should pass runtime context to per-service update when available', async () => {
    trigger.configuration.dryrun = false;
    const container = makeContainer({
      name: 'nginx',
    });
    const updateContainerWithComposeSpy = vi
      .spyOn(trigger, 'updateContainerWithCompose')
      .mockResolvedValue();
    vi.spyOn(trigger, 'runServicePostStartHooks').mockResolvedValue();
    const runtimeContext = {
      dockerApi: mockDockerApi,
      auth: { from: 'context' },
      newImage: 'nginx:9.9.9',
      registry: getState().registry.hub,
    };

    const updated = await trigger.performContainerUpdate(
      runtimeContext as any,
      container as any,
      mockLog,
      {
        composeFile: '/opt/drydock/test/stack.override.yml',
        composeFiles: ['/opt/drydock/test/stack.yml', '/opt/drydock/test/stack.override.yml'],
        service: 'nginx',
        serviceDefinition: {},
        composeFileOnceApplied: false,
      } as any,
    );

    expect(updated).toBe(true);
    expect(updateContainerWithComposeSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/stack.override.yml',
      'nginx',
      container,
      {
        composeFiles: ['/opt/drydock/test/stack.yml', '/opt/drydock/test/stack.override.yml'],
        runtimeContext,
      },
    );
  });

  test('performContainerUpdate should pass skipPull in multi-file compose context', async () => {
    trigger.configuration.dryrun = false;
    const container = makeContainer({
      name: 'nginx',
    });
    const updateContainerWithComposeSpy = vi
      .spyOn(trigger, 'updateContainerWithCompose')
      .mockResolvedValue();
    vi.spyOn(trigger, 'runServicePostStartHooks').mockResolvedValue();

    const updated = await trigger.performContainerUpdate({} as any, container as any, mockLog, {
      composeFile: '/opt/drydock/test/stack.override.yml',
      composeFiles: ['/opt/drydock/test/stack.yml', '/opt/drydock/test/stack.override.yml'],
      service: 'nginx',
      serviceDefinition: {},
      composeFileOnceApplied: false,
      skipPull: true,
    } as any);

    expect(updated).toBe(true);
    expect(updateContainerWithComposeSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/stack.override.yml',
      'nginx',
      container,
      {
        composeFiles: ['/opt/drydock/test/stack.yml', '/opt/drydock/test/stack.override.yml'],
        skipPull: true,
      },
    );
  });

  test('performContainerUpdate should avoid passing runtime context when none is available in single-file path', async () => {
    trigger.configuration.dryrun = false;
    const container = makeContainer({
      name: 'nginx',
    });
    const updateContainerWithComposeSpy = vi
      .spyOn(trigger, 'updateContainerWithCompose')
      .mockResolvedValue();
    vi.spyOn(trigger, 'runServicePostStartHooks').mockResolvedValue();

    const updated = await trigger.performContainerUpdate({} as any, container as any, mockLog, {
      composeFile: '/opt/drydock/test/stack.yml',
      service: 'nginx',
      serviceDefinition: {},
      composeFileOnceApplied: false,
    } as any);

    expect(updated).toBe(true);
    expect(updateContainerWithComposeSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/stack.yml',
      'nginx',
      container,
      {},
    );
  });

  test('performContainerUpdate should recreate a later replica when compose-file-once is already applied', async () => {
    trigger.configuration.dryrun = false;
    const container = makeContainer({
      name: 'nginx',
    });
    const updateContainerWithComposeSpy = vi
      .spyOn(trigger, 'updateContainerWithCompose')
      .mockResolvedValue();
    const hooksSpy = vi.spyOn(trigger, 'runServicePostStartHooks').mockResolvedValue();

    const updated = await trigger.performContainerUpdate({} as any, container as any, mockLog, {
      composeFile: '/opt/drydock/test/stack.yml',
      service: 'nginx',
      serviceDefinition: {},
      composeFileOnceApplied: true,
    } as any);

    expect(updated).toBe(true);
    expect(updateContainerWithComposeSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/stack.yml',
      'nginx',
      container,
      {},
    );
    expect(hooksSpy).toHaveBeenCalledWith(container, 'nginx', {});
    expect(mockLog.info).toHaveBeenCalledWith(
      expect.stringContaining('Recreate nginx for compose-file-once service nginx'),
    );
  });

  test('executeSelfUpdate should forward operation id to parent self-update transition', async () => {
    trigger.configuration.dryrun = false;
    const container = makeContainer({
      name: 'drydock',
      imageName: 'codeswhat/drydock',
    });
    const currentContainer = makeDockerContainerHandle();
    const currentContainerSpec = {
      Id: 'current-id',
      Name: '/drydock',
      State: { Running: true },
      HostConfig: {
        Binds: ['/var/run/docker.sock:/var/run/docker.sock'],
      },
    };
    vi.spyOn(trigger, 'getCurrentContainer').mockResolvedValue(currentContainer);
    vi.spyOn(trigger, 'inspectContainer').mockResolvedValue(currentContainerSpec as any);
    const executeSpy = vi.spyOn(trigger.selfUpdateOrchestrator, 'execute').mockResolvedValue(true);
    const updateContainerWithComposeSpy = vi
      .spyOn(trigger, 'updateContainerWithCompose')
      .mockResolvedValue();

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
      'op-self-update-123',
      {
        composeFile: '/opt/drydock/test/stack.override.yml',
        composeFiles: ['/opt/drydock/test/stack.yml', '/opt/drydock/test/stack.override.yml'],
        service: 'drydock',
        serviceDefinition: {},
      } as any,
    );

    expect(updated).toBe(true);
    expect(executeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        currentContainer,
        currentContainerSpec,
      }),
      container,
      mockLog,
      'op-self-update-123',
    );
    expect(updateContainerWithComposeSpy).not.toHaveBeenCalled();
  });

  test('processComposeFile should mark repeated compose services as already refreshed in compose-file-once mode', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.composeFileOnce = true;
    const firstContainer = makeContainer({
      name: 'nginx-a',
      labels: { 'com.docker.compose.service': 'nginx' },
    });
    const secondContainer = makeContainer({
      name: 'nginx-b',
      labels: { 'com.docker.compose.service': 'nginx' },
    });

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({
        nginx: { image: 'nginx:1.0.0' },
      }),
    );
    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(
      Buffer.from(['services:', '  nginx:', '    image: nginx:1.0.0', ''].join('\n')),
    );
    vi.spyOn(trigger, 'writeComposeFile').mockResolvedValue();
    const runContainerUpdateLifecycleSpy = vi
      .spyOn(trigger, 'runContainerUpdateLifecycle')
      .mockResolvedValue();

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [
      firstContainer,
      secondContainer,
    ]);

    expect(runContainerUpdateLifecycleSpy).toHaveBeenCalledTimes(2);
    expect(runContainerUpdateLifecycleSpy).toHaveBeenNthCalledWith(
      1,
      firstContainer,
      expect.objectContaining({
        service: 'nginx',
        composeFileOnceApplied: false,
      }),
      expect.objectContaining({ lifecycleAlreadyAcquired: true }),
    );
    expect(runContainerUpdateLifecycleSpy).toHaveBeenNthCalledWith(
      2,
      secondContainer,
      expect.objectContaining({
        service: 'nginx',
        composeFileOnceApplied: true,
      }),
      expect.objectContaining({ lifecycleAlreadyAcquired: true }),
    );
  });

  test('applyComposeFileMutationsByWritableFile should reject a repository changed after resolution before mutation', async () => {
    const container = makeContainer({
      name: 'nginx',
      labels: { 'com.docker.compose.service': 'nginx' },
    });
    const changedComposeFileContent = ['services:', '  nginx:', '    image: postgres:16', ''].join(
      '\n',
    );
    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(Buffer.from(changedComposeFileContent));
    const writeComposeFileSpy = vi.spyOn(trigger, 'writeComposeFile').mockResolvedValue();

    await expect(
      trigger.applyComposeFileMutationsByWritableFile(
        '/opt/drydock/test/stack.yml',
        [
          {
            container,
            service: 'nginx',
            runtimeImage: 'nginx:1.1.0',
            current: 'nginx:1.1.0',
            update: 'nginx:1.2.0',
            currentNormalized: 'nginx:1.1.0',
            composeUpdate: 'nginx:1.2.0',
            composeUpdateNormalized: 'nginx:1.2.0',
          },
        ],
        ['/opt/drydock/test/stack.yml'],
        new Map([
          ['/opt/drydock/test/stack.yml', { services: { nginx: { image: 'nginx:1.1.0' } } }],
        ]),
      ),
    ).rejects.toThrow('refusing to rewrite a different repository');

    expect(writeComposeFileSpy).not.toHaveBeenCalled();
  });

  test('applyComposeFileMutationsByWritableFile should reject a fresh non-object service before mutation', async () => {
    const composeFile = '/opt/drydock/test/stack.yml';
    const container = makeContainer({ name: 'nginx' });
    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(
      Buffer.from(['services:', '  nginx: []', ''].join('\n')),
    );
    const writeComposeFileSpy = vi.spyOn(trigger, 'writeComposeFile').mockResolvedValue();

    await expect(
      trigger.applyComposeFileMutationsByWritableFile(
        composeFile,
        [
          {
            container,
            service: 'nginx',
            runtimeImage: 'nginx:1.1.0',
            current: 'nginx:1.1.0',
            update: 'nginx:1.2.0',
            currentNormalized: 'nginx:1.1.0',
            composeUpdate: 'nginx:1.2.0',
            composeUpdateNormalized: 'nginx:1.2.0',
          },
        ],
        [composeFile],
        new Map([[composeFile, { services: { nginx: { image: 'nginx:1.1.0' } } }]]),
      ),
    ).rejects.toThrow('refusing to rewrite a different repository');

    expect(writeComposeFileSpy).not.toHaveBeenCalled();
  });

  test('applyComposeFileMutationsByWritableFile should preserve inherited service fields while adding an image', async () => {
    const composeFile = '/opt/drydock/test/stack.override.yml';
    const baseFile = '/opt/drydock/test/stack.yml';
    const container = makeContainer({ name: 'nginx' });
    vi.spyOn(trigger, 'getComposeFile').mockImplementation(async (filePath) =>
      Buffer.from(
        filePath === composeFile
          ? ['services:', '  nginx:', '    environment:', '      FOO: bar', ''].join('\n')
          : ['services:', '  nginx:', '    image: nginx:1.1.0', ''].join('\n'),
      ),
    );
    const writeComposeFileSpy = vi.spyOn(trigger, 'writeComposeFile').mockResolvedValue();

    await expect(
      trigger.applyComposeFileMutationsByWritableFile(
        composeFile,
        [
          {
            container,
            service: 'nginx',
            runtimeImage: 'nginx:1.1.0',
            current: 'nginx:1.1.0',
            update: 'nginx:1.2.0',
            currentNormalized: 'nginx:1.1.0',
            composeUpdate: 'nginx:1.2.0',
            composeUpdateNormalized: 'nginx:1.2.0',
          },
        ],
        [baseFile, composeFile],
        new Map([
          [baseFile, { services: { nginx: { image: 'nginx:1.1.0' } } }],
          [composeFile, { services: { nginx: { environment: { FOO: 'bar' } } } }],
        ]),
      ),
    ).resolves.toEqual(expect.objectContaining({ filePath: composeFile }));

    expect(writeComposeFileSpy).toHaveBeenCalledWith(
      composeFile,
      expect.stringContaining('image: nginx:1.2.0'),
    );
    expect(writeComposeFileSpy).toHaveBeenCalledWith(
      composeFile,
      expect.stringContaining('FOO: bar'),
    );
  });

  test('applyComposeFileMutationsByWritableFile should reject a fresh non-target base repository before mutation', async () => {
    trigger.configuration.backup = true;
    const composeFile = '/opt/drydock/test/stack.override.yml';
    const baseFile = '/opt/drydock/test/stack.yml';
    const container = makeContainer({ name: 'nginx' });
    vi.spyOn(trigger, 'getComposeFile').mockImplementation(async (filePath) =>
      Buffer.from(
        filePath === composeFile
          ? ['services:', '  nginx:', '    environment:', '      FOO: bar', ''].join('\n')
          : ['services:', '  nginx:', '    image: postgres:16', ''].join('\n'),
      ),
    );
    const backupSpy = vi.spyOn(trigger, 'backup').mockResolvedValue();
    const writeComposeFileSpy = vi.spyOn(trigger, 'writeComposeFile').mockResolvedValue();

    await expect(
      trigger.applyComposeFileMutationsByWritableFile(
        composeFile,
        [
          {
            container,
            service: 'nginx',
            runtimeImage: 'nginx:1.1.0',
            current: 'nginx:1.1.0',
            update: 'nginx:1.2.0',
            currentNormalized: 'nginx:1.1.0',
            composeUpdate: 'nginx:1.2.0',
            composeUpdateNormalized: 'nginx:1.2.0',
          },
        ],
        [baseFile, composeFile],
        new Map([
          [baseFile, { services: { nginx: { image: 'nginx:1.1.0' } } }],
          [composeFile, { services: { nginx: { environment: { FOO: 'bar' } } } }],
        ]),
      ),
    ).rejects.toThrow('refusing to rewrite a different repository');

    expect(backupSpy).not.toHaveBeenCalled();
    expect(writeComposeFileSpy).not.toHaveBeenCalled();
  });

  test('processComposeFile should pre-pull once for repeated compose services in compose-file-once mode', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.prune = false;
    trigger.configuration.composeFileOnce = true;
    const firstContainer = makeContainer({
      name: 'nginx-a',
      labels: { 'com.docker.compose.service': 'nginx' },
    });
    const secondContainer = makeContainer({
      name: 'nginx-b',
      labels: { 'com.docker.compose.service': 'nginx' },
    });

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({
        nginx: { image: 'nginx:1.0.0' },
      }),
    );
    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(
      Buffer.from(['services:', '  nginx:', '    image: nginx:1.0.0', ''].join('\n')),
    );
    vi.spyOn(trigger, 'writeComposeFile').mockResolvedValue();
    const pullImageSpy = vi.spyOn(trigger, 'pullImage').mockResolvedValue();
    const updateContainerWithComposeSpy = vi
      .spyOn(trigger, 'updateContainerWithCompose')
      .mockImplementation(async (_composeFile, _service, container, options = {}) => {
        const operationId = getRequestedOperationId(container, options.runtimeContext) ?? '';
        const imageIdentity = options.runtimeContext?.imageIdentity;
        if (imageIdentity) {
          await options.postPullHook?.(operationId, imageIdentity);
        } else {
          await options.postPullHook?.(operationId);
        }
      });
    vi.spyOn(trigger, 'runServicePostStartHooks').mockResolvedValue();
    vi.spyOn(trigger, 'maybeScanAndGateUpdate').mockResolvedValue();
    vi.spyOn(trigger, 'runPreUpdateHook').mockResolvedValue();
    vi.spyOn(trigger, 'runPostUpdateHook').mockResolvedValue();
    vi.spyOn(trigger, 'cleanupOldImages').mockResolvedValue();
    vi.spyOn(trigger, 'maybeStartAutoRollbackMonitor').mockResolvedValue();
    const scanAndGatePostPullSpy = vi.spyOn(trigger, 'scanAndGatePostPull').mockResolvedValue();

    await trigger.processComposeFile(
      '/opt/drydock/test/stack.yml',
      [firstContainer, secondContainer],
      undefined,
      {
        operationIds: new Map([
          ['nginx-a', 'op-compose-a'],
          ['nginx-b', 'op-compose-b'],
        ]),
      },
    );

    expect(pullImageSpy).toHaveBeenCalledTimes(1);
    expect(updateContainerWithComposeSpy).toHaveBeenCalledTimes(2);
    expect(updateContainerWithComposeSpy).toHaveBeenNthCalledWith(
      1,
      '/opt/drydock/test/stack.yml',
      'nginx',
      firstContainer,
      expect.objectContaining({
        skipPull: true,
      }),
    );
    expect(updateContainerWithComposeSpy).toHaveBeenNthCalledWith(
      2,
      '/opt/drydock/test/stack.yml',
      'nginx',
      secondContainer,
      expect.objectContaining({
        skipPull: true,
      }),
    );
    expect(scanAndGatePostPullSpy).toHaveBeenCalledTimes(2);
  });

  test('processComposeFile should refuse divergent replica targets for one compose-file-once service', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.prune = false;
    trigger.configuration.composeFileOnce = true;
    // The compose file already names the first replica's target, so only the
    // second replica reaches the compose-update list and the existing
    // conflicting-update guard never fires. The service is still divergent:
    // one replica wants 1.1.0 and the other wants 1.2.0.
    const firstContainer = makeContainer({
      name: 'nginx-a',
      remoteValue: '1.1.0',
      updateAvailable: true,
      labels: { 'com.docker.compose.service': 'nginx' },
    });
    const secondContainer = makeContainer({
      name: 'nginx-b',
      remoteValue: '1.2.0',
      labels: { 'com.docker.compose.service': 'nginx' },
    });

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.1.0' } }),
    );
    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(
      Buffer.from(['services:', '  nginx:', '    image: nginx:1.1.0', ''].join('\n')),
    );
    vi.spyOn(trigger, 'writeComposeFile').mockResolvedValue();
    const pullImageSpy = vi.spyOn(trigger, 'pullImage').mockResolvedValue();
    const lifecycleSpy = vi.spyOn(trigger, 'runContainerUpdateLifecycle').mockResolvedValue();

    await expect(
      trigger.processComposeFile('/opt/drydock/test/stack.yml', [firstContainer, secondContainer]),
    ).rejects.toThrow(
      'Compose service nginx resolves to different update targets for its containers ' +
        '(nginx-a wants nginx:1.1.0, nginx-b wants nginx:1.2.0)',
    );

    expect(pullImageSpy).not.toHaveBeenCalled();
    expect(lifecycleSpy).not.toHaveBeenCalled();
  });

  test('processComposeFile should refuse a divergent replica even when it is already up to date', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.prune = false;
    trigger.configuration.composeFileOnce = true;
    // The first replica already matches the compose file's target (1.1.0) and
    // needs no runtime update at all, so it is excluded from
    // mappingsNeedingRuntimeUpdate. The second replica's filter resolves a
    // different target (1.2.0). Preflight must still see the first replica's
    // target when validating divergence, or it silently pulls, gates and
    // writes 1.2.0 into the shared service definition -- changing the image
    // out from under the replica whose filter wanted 1.1.0.
    const firstContainer = makeContainer({
      name: 'nginx-a',
      tagValue: '1.1.0',
      remoteValue: '1.1.0',
      labels: { 'com.docker.compose.service': 'nginx' },
    });
    const secondContainer = makeContainer({
      name: 'nginx-b',
      tagValue: '1.0.0',
      remoteValue: '1.2.0',
      labels: { 'com.docker.compose.service': 'nginx' },
    });

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.1.0' } }),
    );
    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(
      Buffer.from(['services:', '  nginx:', '    image: nginx:1.1.0', ''].join('\n')),
    );
    const writeComposeFileSpy = vi.spyOn(trigger, 'writeComposeFile').mockResolvedValue();
    const pullImageSpy = vi.spyOn(trigger, 'pullImage').mockResolvedValue();
    const lifecycleSpy = vi.spyOn(trigger, 'runContainerUpdateLifecycle').mockResolvedValue();

    await expect(
      trigger.processComposeFile('/opt/drydock/test/stack.yml', [firstContainer, secondContainer]),
    ).rejects.toThrow(
      'Compose service nginx resolves to different update targets for its containers ' +
        '(nginx-a wants nginx:1.1.0, nginx-b wants nginx:1.2.0)',
    );

    expect(pullImageSpy).not.toHaveBeenCalled();
    expect(lifecycleSpy).not.toHaveBeenCalled();
    expect(writeComposeFileSpy).not.toHaveBeenCalled();
  });

  test('processComposeFile should gate every replica before any compose-file-once runtime mutation', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.prune = false;
    trigger.configuration.composeFileOnce = true;
    const firstContainer = makeContainer({
      id: 'nginx-a',
      name: 'nginx-a',
      labels: { 'com.docker.compose.service': 'nginx' },
    });
    const secondContainer = makeContainer({
      id: 'nginx-b',
      name: 'nginx-b',
      labels: { 'com.docker.compose.service': 'nginx' },
    });
    const composeFile = '/opt/drydock/test/stack.yml';
    const originalCompose = ['services:', '  nginx:', '    image: nginx:1.0.0', ''].join('\n');
    const callOrder: string[] = [];
    const pinnedIdentity = 'nginx:1.1.0@sha256:abcdef123456';
    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
    );
    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(Buffer.from(originalCompose));
    const writeComposeFileSpy = vi.spyOn(trigger, 'writeComposeFile').mockResolvedValue();
    vi.spyOn(trigger, 'pullImage').mockImplementation(async () => {
      callOrder.push('pull');
    });
    mockDockerApi.getImage.mockReturnValue({
      inspect: vi.fn().mockResolvedValue({
        Id: 'sha256:compose-file-once-id',
        RepoDigests: ['nginx@sha256:abcdef123456'],
      }),
    });
    vi.spyOn(trigger, 'verifySignaturePreUpdate').mockResolvedValue();
    vi.spyOn(trigger, 'runPreUpdateHook').mockResolvedValue();
    const scanAndGatePostPullSpy = vi
      .spyOn(trigger, 'scanAndGatePostPull')
      .mockImplementation(async (context, container) => {
        callOrder.push(`gate:${container.name}`);
        expect(context.newImage).toBe(pinnedIdentity);
        if (container === secondContainer) {
          throw new Error('second replica blocked');
        }
      });
    vi.spyOn(trigger, 'stopContainer').mockImplementation(async () => {
      callOrder.push('stop');
    });
    vi.spyOn(trigger, 'removeContainer').mockImplementation(async () => {
      callOrder.push('remove');
    });
    vi.spyOn(trigger, 'createContainer').mockImplementation(async () => {
      callOrder.push('create');
      return { start: vi.fn().mockResolvedValue(undefined) } as any;
    });
    vi.spyOn(trigger, 'startContainer').mockImplementation(async () => {
      callOrder.push('start');
    });
    vi.spyOn(trigger, 'runServicePostStartHooks').mockResolvedValue();
    vi.spyOn(trigger, 'runPostUpdateHook').mockResolvedValue();
    vi.spyOn(trigger, 'cleanupOldImages').mockResolvedValue();
    vi.spyOn(trigger, 'maybeStartAutoRollbackMonitor').mockResolvedValue();

    await expect(
      trigger.processComposeFile(composeFile, [firstContainer, secondContainer]),
    ).rejects.toThrow('second replica blocked');

    expect(callOrder).toEqual(['pull', 'gate:nginx-a', 'gate:nginx-b']);
    expect(scanAndGatePostPullSpy).toHaveBeenCalledTimes(2);
    expect(callOrder.some((entry) => ['stop', 'remove', 'create', 'start'].includes(entry))).toBe(
      false,
    );
    expect(writeComposeFileSpy).not.toHaveBeenCalled();
  });

  test('compose-file-once should record one skipped-scan audit per replica, not one extra for the refreshed service', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.prune = false;
    trigger.configuration.composeFileOnce = true;
    // The pulled image cannot be bound to a manifest digest and availability
    // policy `warn` allows the update to proceed without a scan.
    vi.spyOn(trigger as any, 'capturePulledImageIdentity').mockResolvedValue({
      unboundWarn: true,
      reason: 'manifest digest unavailable',
    });
    const firstContainer = makeContainer({
      id: 'nginx-a',
      name: 'nginx-a',
      labels: { 'com.docker.compose.service': 'nginx' },
    });
    const secondContainer = makeContainer({
      id: 'nginx-b',
      name: 'nginx-b',
      labels: { 'com.docker.compose.service': 'nginx' },
    });
    const recordUnboundWarningSpy = vi.spyOn(trigger, 'recordUnboundSecurityWarning');
    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
    );
    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(
      Buffer.from(['services:', '  nginx:', '    image: nginx:1.0.0', ''].join('\n')),
    );
    vi.spyOn(trigger, 'writeComposeFile').mockResolvedValue();
    vi.spyOn(trigger, 'pullImage').mockResolvedValue();
    vi.spyOn(trigger, 'runPreUpdateHook').mockResolvedValue();
    vi.spyOn(trigger, 'stopContainer').mockResolvedValue();
    vi.spyOn(trigger, 'removeContainer').mockResolvedValue();
    vi.spyOn(trigger.runtimeConfigManager, 'getCloneRuntimeConfigOptions').mockResolvedValue({});
    vi.spyOn(trigger as any, 'recreateReplacementContainerWithCleanup').mockResolvedValue();
    vi.spyOn(trigger, 'runServicePostStartHooks').mockResolvedValue();
    vi.spyOn(trigger, 'runPostUpdateHook').mockResolvedValue();
    vi.spyOn(trigger, 'cleanupOldImages').mockResolvedValue();
    vi.spyOn(trigger, 'maybeStartAutoRollbackMonitor').mockResolvedValue();

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [
      firstContainer,
      secondContainer,
    ]);

    expect(recordUnboundWarningSpy.mock.calls.map(([container]) => container.name)).toEqual([
      'nginx-a',
      'nginx-b',
    ]);
  });

  test('compose-file-once should recreate every replica of a scaled service and report each operation succeeded (DR-54)', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.prune = false;
    trigger.configuration.composeFileOnce = true;
    const operationStatuses = new Map([
      ['op-nginx-a', 'in-progress'],
      ['op-nginx-b', 'in-progress'],
    ]);
    vi.spyOn(updateOperationStore, 'getOperationById').mockImplementation((id) => {
      const status = operationStatuses.get(id as string);
      return status ? ({ id, status, kind: 'update' } as any) : undefined;
    });
    const markOperationTerminalSpy = vi
      .spyOn(updateOperationStore, 'markOperationTerminal')
      .mockImplementation((id, patch) => {
        operationStatuses.set(id as string, (patch as { status: string }).status);
        return { id, ...patch } as any;
      });
    const firstContainer = makeContainer({
      id: 'container-nginx-a',
      name: 'nginx-a',
      labels: { 'com.docker.compose.service': 'nginx' },
    });
    const secondContainer = makeContainer({
      id: 'container-nginx-b',
      name: 'nginx-b',
      labels: { 'com.docker.compose.service': 'nginx' },
    });
    const composeFile = '/opt/drydock/test/stack.yml';
    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
    );
    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(
      Buffer.from(['services:', '  nginx:', '    image: nginx:1.0.0', ''].join('\n')),
    );
    vi.spyOn(trigger, 'writeComposeFile').mockResolvedValue();
    vi.spyOn(trigger, 'pullImage').mockResolvedValue();
    mockDockerApi.getImage.mockReturnValue({
      inspect: vi.fn().mockResolvedValue({
        Id: 'sha256:nginx-once-id',
        RepoDigests: ['nginx@sha256:abcdef123456'],
        Architecture: process.arch === 'x64' ? 'amd64' : process.arch,
        Os: 'linux',
      }),
    });
    vi.spyOn(trigger, 'verifySignaturePreUpdate').mockResolvedValue();
    vi.spyOn(trigger, 'scanAndGatePostPull').mockResolvedValue();
    vi.spyOn(trigger, 'runPreUpdateHook').mockResolvedValue();
    vi.spyOn(trigger, 'runPostUpdateHook').mockResolvedValue();
    vi.spyOn(trigger, 'stopContainer').mockResolvedValue();
    vi.spyOn(trigger, 'removeContainer').mockResolvedValue();
    const createContainerSpy = vi
      .spyOn(trigger, 'createContainer')
      .mockImplementation(async (_dockerApi, containerToCreate) => ({
        start: vi.fn().mockResolvedValue(undefined),
        image: (containerToCreate as { Image?: string }).Image,
      }));
    vi.spyOn(trigger, 'startContainer').mockResolvedValue();
    vi.spyOn(trigger, 'runServicePostStartHooks').mockResolvedValue();
    vi.spyOn(trigger, 'cleanupOldImages').mockResolvedValue();
    vi.spyOn(trigger, 'maybeStartAutoRollbackMonitor').mockResolvedValue();

    await trigger.processComposeFile(composeFile, [firstContainer, secondContainer], undefined, {
      operationIds: new Map([
        ['container-nginx-a', 'op-nginx-a'],
        ['container-nginx-b', 'op-nginx-b'],
      ]),
    });

    // Both replicas were actually recreated against the digest-pinned
    // identity the preflight bound and gated once for the service, not just
    // the first one to reach the runtime-update loop.
    expect(createContainerSpy).toHaveBeenCalledTimes(2);
    for (const call of createContainerSpy.mock.calls) {
      expect((call[1] as { Image?: string }).Image).toBe('nginx:1.1.0@sha256:abcdef123456');
    }
    // The security gate ran once per replica during preflight; recreating the
    // replica afterward must not gate it a second time.
    expect(trigger.scanAndGatePostPull).toHaveBeenCalledTimes(2);
    expect(markOperationTerminalSpy).toHaveBeenCalledTimes(2);
    expect(markOperationTerminalSpy).toHaveBeenCalledWith(
      'op-nginx-a',
      expect.objectContaining({ status: 'succeeded', phase: 'succeeded' }),
    );
    expect(markOperationTerminalSpy).toHaveBeenCalledWith(
      'op-nginx-b',
      expect.objectContaining({ status: 'succeeded', phase: 'succeeded' }),
    );
  });

  test('compose-file-once should mutate the compose file exactly once for a scaled service with multiple replicas (DR-54)', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.prune = false;
    trigger.configuration.composeFileOnce = true;
    const firstContainer = makeContainer({
      id: 'container-nginx-a',
      name: 'nginx-a',
      labels: { 'com.docker.compose.service': 'nginx' },
    });
    const secondContainer = makeContainer({
      id: 'container-nginx-b',
      name: 'nginx-b',
      labels: { 'com.docker.compose.service': 'nginx' },
    });
    const composeFile = '/opt/drydock/test/stack.yml';
    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
    );
    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(
      Buffer.from(['services:', '  nginx:', '    image: nginx:1.0.0', ''].join('\n')),
    );
    const writeComposeFileSpy = vi.spyOn(trigger, 'writeComposeFile').mockResolvedValue();
    vi.spyOn(trigger, 'pullImage').mockResolvedValue();
    vi.spyOn(trigger, 'verifySignaturePreUpdate').mockResolvedValue();
    vi.spyOn(trigger, 'scanAndGatePostPull').mockResolvedValue();
    vi.spyOn(trigger, 'runPreUpdateHook').mockResolvedValue();
    vi.spyOn(trigger, 'runPostUpdateHook').mockResolvedValue();
    vi.spyOn(trigger, 'stopContainer').mockResolvedValue();
    vi.spyOn(trigger, 'removeContainer').mockResolvedValue();
    const createContainerSpy = vi.spyOn(trigger, 'createContainer').mockResolvedValue({
      start: vi.fn().mockResolvedValue(undefined),
    } as any);
    vi.spyOn(trigger, 'startContainer').mockResolvedValue();
    vi.spyOn(trigger, 'runServicePostStartHooks').mockResolvedValue();
    vi.spyOn(trigger, 'cleanupOldImages').mockResolvedValue();
    vi.spyOn(trigger, 'maybeStartAutoRollbackMonitor').mockResolvedValue();

    await trigger.processComposeFile(composeFile, [firstContainer, secondContainer]);

    // Two replicas of the same service still produce exactly one write: the
    // per-container recreate path never touches the compose file itself.
    expect(writeComposeFileSpy).toHaveBeenCalledTimes(1);
    expect(writeComposeFileSpy).toHaveBeenCalledWith(
      composeFile,
      expect.stringContaining('image: nginx:1.1.0'),
    );
    expect(createContainerSpy).toHaveBeenCalledTimes(2);
  });

  test('compose-file-once should recreate every replica from the compose reference and check it against the pulled image (DR-54)', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.prune = false;
    trigger.configuration.composeFileOnce = true;
    // Availability policy warn plus an image the daemon cannot bind to a
    // manifest digest. Replace the accessor on this trigger's own gate rather
    // than spying it: the property holds the shared module mock, and vi.spyOn
    // would reconfigure that mock for every later test in the file.
    trigger.getSecurityGate().securityConfig.getSecurityConfiguration = vi.fn().mockReturnValue({
      enabled: true,
      availabilityPolicy: 'warn',
      signature: { verify: false },
      gate: { mode: 'on' },
    });
    const firstContainer = makeContainer({
      id: 'container-nginx-a',
      name: 'nginx-a',
      labels: { 'com.docker.compose.service': 'nginx' },
    });
    const secondContainer = makeContainer({
      id: 'container-nginx-b',
      name: 'nginx-b',
      labels: { 'com.docker.compose.service': 'nginx' },
    });
    const composeFile = '/opt/drydock/test/stack.yml';
    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
    );
    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(
      Buffer.from(['services:', '  nginx:', '    image: nginx:1.0.0', ''].join('\n')),
    );
    const writeComposeFileSpy = vi.spyOn(trigger, 'writeComposeFile').mockResolvedValue();
    const pullImageSpy = vi.spyOn(trigger, 'pullImage').mockResolvedValue();
    // The image carries two tags and no usable RepoDigests, which is the case
    // that makes creating from the bare image ID unsafe: the watcher would
    // read the tag back off Config.Image and could land on nginx:latest.
    mockDockerApi.getImage.mockReturnValue({
      inspect: vi.fn().mockResolvedValue({
        Id: 'sha256:nginx-local-id',
        RepoDigests: [],
        RepoTags: ['nginx:latest', 'nginx:1.1.0'],
        Architecture: process.arch === 'x64' ? 'amd64' : process.arch,
        Os: 'linux',
      }),
    });
    const recordUnboundWarningSpy = vi
      .spyOn(trigger, 'recordUnboundSecurityWarning')
      .mockImplementation(() => {});
    vi.spyOn(trigger, 'verifySignaturePreUpdate').mockResolvedValue();
    const scanAndGatePostPullSpy = vi.spyOn(trigger, 'scanAndGatePostPull').mockResolvedValue();
    vi.spyOn(trigger, 'runPreUpdateHook').mockResolvedValue();
    vi.spyOn(trigger, 'runPostUpdateHook').mockResolvedValue();
    vi.spyOn(trigger, 'stopContainer').mockResolvedValue();
    vi.spyOn(trigger, 'removeContainer').mockResolvedValue();
    const removeCreated = vi.fn().mockResolvedValue(undefined);
    const createContainerSpy = vi.spyOn(trigger, 'createContainer').mockResolvedValue({
      start: vi.fn().mockResolvedValue(undefined),
      remove: removeCreated,
      inspect: vi.fn().mockResolvedValue({ Image: 'sha256:nginx-local-id' }),
    } as any);
    vi.spyOn(trigger, 'startContainer').mockResolvedValue();
    vi.spyOn(trigger, 'runServicePostStartHooks').mockResolvedValue();
    vi.spyOn(trigger, 'cleanupOldImages').mockResolvedValue();
    vi.spyOn(trigger, 'maybeStartAutoRollbackMonitor').mockResolvedValue();

    await trigger.processComposeFile(composeFile, [firstContainer, secondContainer]);

    // One pull for the service, and both replicas created from the operator's
    // reference, never from the bare image ID: Config.Image is what the
    // watcher reads the container's tag back from.
    expect(pullImageSpy).toHaveBeenCalledTimes(1);
    expect(createContainerSpy).toHaveBeenCalledTimes(2);
    for (const call of createContainerSpy.mock.calls) {
      expect((call[1] as { Image?: string }).Image).toBe('nginx:1.1.0');
    }
    // Both replicas matched the image the preflight pulled, so neither
    // candidate was torn down.
    expect(removeCreated).not.toHaveBeenCalled();
    expect(writeComposeFileSpy).toHaveBeenCalledTimes(1);
    expect(writeComposeFileSpy).toHaveBeenCalledWith(
      composeFile,
      expect.stringContaining('image: nginx:1.1.0'),
    );
    // Warn policy skips the gate rather than running it against a mutable
    // tag, and records the skip once per replica.
    expect(scanAndGatePostPullSpy).not.toHaveBeenCalled();
    expect(recordUnboundWarningSpy).toHaveBeenCalledTimes(2);
  });

  test('compose-file-once should resolve the pulled image once for every replica (DR-54)', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.prune = false;
    trigger.configuration.composeFileOnce = true;
    const firstContainer = makeContainer({
      id: 'container-nginx-a',
      name: 'nginx-a',
      labels: { 'com.docker.compose.service': 'nginx' },
    });
    const secondContainer = makeContainer({
      id: 'container-nginx-b',
      name: 'nginx-b',
      labels: { 'com.docker.compose.service': 'nginx' },
    });
    const composeFile = '/opt/drydock/test/stack.yml';
    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
    );
    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(
      Buffer.from(['services:', '  nginx:', '    image: nginx:1.0.0', ''].join('\n')),
    );
    vi.spyOn(trigger, 'writeComposeFile').mockResolvedValue();
    vi.spyOn(trigger, 'pullImage').mockResolvedValue();
    // Security disabled is the default posture and reaches the same unbound
    // outcome without the warn flag.
    mockDockerApi.getImage.mockReturnValue({
      inspect: vi.fn().mockResolvedValue({
        Id: 'sha256:nginx-local-id',
        RepoDigests: [],
        Architecture: process.arch === 'x64' ? 'amd64' : process.arch,
        Os: 'linux',
      }),
    });
    const capturePulledImageIdentitySpy = vi.spyOn(trigger, 'capturePulledImageIdentity');
    vi.spyOn(trigger, 'verifySignaturePreUpdate').mockResolvedValue();
    vi.spyOn(trigger, 'scanAndGatePostPull').mockResolvedValue();
    vi.spyOn(trigger, 'runPreUpdateHook').mockResolvedValue();
    vi.spyOn(trigger, 'runPostUpdateHook').mockResolvedValue();
    vi.spyOn(trigger, 'stopContainer').mockResolvedValue();
    vi.spyOn(trigger, 'removeContainer').mockResolvedValue();
    const containerInspect = vi.fn().mockResolvedValue({ Image: 'sha256:nginx-local-id' });
    const createContainerSpy = vi.spyOn(trigger, 'createContainer').mockResolvedValue({
      start: vi.fn().mockResolvedValue(undefined),
      inspect: containerInspect,
    } as any);
    vi.spyOn(trigger, 'startContainer').mockResolvedValue();
    vi.spyOn(trigger, 'runServicePostStartHooks').mockResolvedValue();
    vi.spyOn(trigger, 'cleanupOldImages').mockResolvedValue();
    vi.spyOn(trigger, 'maybeStartAutoRollbackMonitor').mockResolvedValue();

    await trigger.processComposeFile(composeFile, [firstContainer, secondContainer]);

    // The preflight resolves the image once and every replica is checked
    // against that one answer, rather than each replica resolving the tag
    // again and potentially getting a different one.
    expect(capturePulledImageIdentitySpy).toHaveBeenCalledTimes(1);
    expect(createContainerSpy).toHaveBeenCalledTimes(2);
    expect(containerInspect).toHaveBeenCalledTimes(2);
    for (const call of createContainerSpy.mock.calls) {
      expect((call[1] as { Image?: string }).Image).toBe('nginx:1.1.0');
    }
  });

  test('a recreate that lands on a different image than the preflight pulled should be removed and fail (DR-54)', async () => {
    trigger.configuration.dryrun = false;
    // The default posture, spelled out rather than left to the file-level
    // configuration mock: no scanner and the fail-closed availability policy.
    // The runtime context below is what a compose-file-once preflight produces
    // under it, an image ID and no unbound-scan warning, because with scanning
    // off the identity binding policy is `disabled` and never warns.
    trigger.getSecurityGate().securityConfig.getSecurityConfiguration = vi.fn().mockReturnValue({
      enabled: false,
      availabilityPolicy: 'block',
      signature: { verify: false },
      gate: { mode: 'on' },
    });
    const container = makeContainer({ name: 'nginx-a' });
    mockDockerApi.getImage.mockReturnValue({
      inspect: vi.fn().mockResolvedValue({
        Id: 'sha256:pulled-image',
        RepoDigests: [],
        Architecture: process.arch === 'x64' ? 'amd64' : process.arch,
        Os: 'linux',
      }),
    });
    vi.spyOn(trigger, 'pullImage').mockResolvedValue();
    vi.spyOn(trigger, 'stopContainer').mockResolvedValue();
    vi.spyOn(trigger, 'removeContainer').mockResolvedValue();
    const rollbackSpy = vi
      .spyOn(trigger as any, 'attemptRollbackRestoreOldContainer')
      .mockResolvedValue({ status: 'rolled-back' });
    const removeCreated = vi.fn().mockResolvedValue(undefined);
    const startContainerSpy = vi.spyOn(trigger, 'startContainer').mockResolvedValue();
    // The tag moved locally between the pull and the create, so the container
    // that came back runs an image the pull never resolved.
    vi.spyOn(trigger, 'createContainer').mockResolvedValue({
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      remove: removeCreated,
      inspect: vi.fn().mockResolvedValue({ Image: 'sha256:retagged-image' }),
    } as any);

    await expect(
      trigger.updateContainerWithCompose('/opt/drydock/test/stack.yml', 'nginx', container, {
        skipPull: true,
        runtimeContext: {
          dockerApi: mockDockerApi,
          newImage: 'nginx:1.1.0',
          pulledImageId: 'sha256:pulled-image',
        },
      }),
    ).rejects.toThrow(
      'Recreated container nginx-a runs image sha256:retagged-image but nginx:1.1.0 was pulled as sha256:pulled-image',
    );

    expect(removeCreated).toHaveBeenCalledWith({ force: true });
    expect(startContainerSpy).not.toHaveBeenCalled();
    expect(rollbackSpy).toHaveBeenCalled();
  });

  test('a moved tag on an update with no preflighted identity should be kept under availability policy warn (DR-67)', async () => {
    trigger.configuration.dryrun = false;
    // Scanning off with the policy set to warn: the operator has said they
    // would rather the update land than have it refused for want of a certain
    // answer. The runtime context carries no preflight identity, so this
    // container resolved its own image and nothing else was created against a
    // shared decision this one could split.
    trigger.getSecurityGate().securityConfig.getSecurityConfiguration = vi.fn().mockReturnValue({
      enabled: false,
      availabilityPolicy: 'warn',
      signature: { verify: false },
      gate: { mode: 'on' },
    });
    const container = makeContainer({ name: 'nginx-a' });
    mockDockerApi.getImage.mockReturnValue({
      inspect: vi.fn().mockResolvedValue({
        Id: 'sha256:pulled-image',
        RepoDigests: [],
        Architecture: process.arch === 'x64' ? 'amd64' : process.arch,
        Os: 'linux',
      }),
    });
    vi.spyOn(trigger, 'pullImage').mockResolvedValue();
    vi.spyOn(trigger, 'stopContainer').mockResolvedValue();
    vi.spyOn(trigger, 'removeContainer').mockResolvedValue();
    const rollbackSpy = vi
      .spyOn(trigger as any, 'attemptRollbackRestoreOldContainer')
      .mockResolvedValue({ status: 'rolled-back' });
    const removeCreated = vi.fn().mockResolvedValue(undefined);
    const startContainerSpy = vi.spyOn(trigger, 'startContainer').mockResolvedValue();
    const securityAuditSpy = vi.spyOn(trigger, 'recordSecurityAudit');
    // A concurrent docker pull moved nginx:1.1.0 between the pull and the
    // create, so the container that came back runs a different image.
    vi.spyOn(trigger, 'createContainer').mockResolvedValue({
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      remove: removeCreated,
      inspect: vi.fn().mockResolvedValue({ Image: 'sha256:retagged-image' }),
    } as any);

    await trigger.updateContainerWithCompose('/opt/drydock/test/stack.yml', 'nginx', container, {
      skipPull: true,
      runtimeContext: { dockerApi: mockDockerApi, newImage: 'nginx:1.1.0' },
    });

    // The container stands, and the warning names both image IDs so the
    // operator can see which one is actually running.
    expect(startContainerSpy).toHaveBeenCalled();
    expect(removeCreated).not.toHaveBeenCalled();
    expect(rollbackSpy).not.toHaveBeenCalled();
    expect(mockLog.warn).toHaveBeenCalledWith(
      'Recreated container nginx-a runs image sha256:retagged-image but nginx:1.1.0 was pulled as sha256:pulled-image; ' +
        'the local tag moved between the pull and the recreate. ' +
        'Keeping the container because DD_SECURITY_AVAILABILITY_POLICY=warn',
    );
    // With no scanner the identity binding policy is `disabled` and records
    // nothing, so this is the only audit row the container gets.
    expect(securityAuditSpy).toHaveBeenCalledTimes(1);
    expect(securityAuditSpy).toHaveBeenCalledWith(
      'security-scan-skipped',
      container,
      'error',
      'Security scan skipped because the local tag moved between the pull and the recreate: ' +
        'nginx-a runs image sha256:retagged-image but nginx:1.1.0 was pulled as sha256:pulled-image; ' +
        'container kept by DD_SECURITY_AVAILABILITY_POLICY=warn',
    );
  });

  test('a moved tag on a compose-file-once update reached with no preflighted identity should be kept under availability policy warn (DR-67)', async () => {
    trigger.configuration.dryrun = false;
    // The config flag alone is not the marker: compose-file-once is enabled,
    // but this call carries no preflight identity in its runtime context, so
    // the refresh reached the check without a shared decision to protect and
    // the availability policy decides exactly as it would with the flag off.
    trigger.configuration.composeFileOnce = true;
    trigger.getSecurityGate().securityConfig.getSecurityConfiguration = vi.fn().mockReturnValue({
      enabled: false,
      availabilityPolicy: 'warn',
      signature: { verify: false },
      gate: { mode: 'on' },
    });
    const container = makeContainer({ name: 'nginx-a' });
    mockDockerApi.getImage.mockReturnValue({
      inspect: vi.fn().mockResolvedValue({
        Id: 'sha256:pulled-image',
        RepoDigests: [],
        Architecture: process.arch === 'x64' ? 'amd64' : process.arch,
        Os: 'linux',
      }),
    });
    vi.spyOn(trigger, 'pullImage').mockResolvedValue();
    vi.spyOn(trigger, 'stopContainer').mockResolvedValue();
    vi.spyOn(trigger, 'removeContainer').mockResolvedValue();
    const rollbackSpy = vi
      .spyOn(trigger as any, 'attemptRollbackRestoreOldContainer')
      .mockResolvedValue({ status: 'rolled-back' });
    const removeCreated = vi.fn().mockResolvedValue(undefined);
    const startContainerSpy = vi.spyOn(trigger, 'startContainer').mockResolvedValue();
    const securityAuditSpy = vi.spyOn(trigger, 'recordSecurityAudit');
    // A concurrent docker pull moved nginx:1.1.0 between the pull and the
    // create, so the container that came back runs a different image.
    vi.spyOn(trigger, 'createContainer').mockResolvedValue({
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      remove: removeCreated,
      inspect: vi.fn().mockResolvedValue({ Image: 'sha256:retagged-image' }),
    } as any);

    await trigger.updateContainerWithCompose('/opt/drydock/test/stack.yml', 'nginx', container, {
      skipPull: true,
      runtimeContext: { dockerApi: mockDockerApi, newImage: 'nginx:1.1.0' },
    });

    // The container stands: compose-file-once being on is not, by itself,
    // enough to force a refusal without a preflighted identity behind it.
    expect(startContainerSpy).toHaveBeenCalled();
    expect(removeCreated).not.toHaveBeenCalled();
    expect(rollbackSpy).not.toHaveBeenCalled();
    expect(mockLog.warn).toHaveBeenCalledWith(
      'Recreated container nginx-a runs image sha256:retagged-image but nginx:1.1.0 was pulled as sha256:pulled-image; ' +
        'the local tag moved between the pull and the recreate. ' +
        'Keeping the container because DD_SECURITY_AVAILABILITY_POLICY=warn',
    );
    expect(securityAuditSpy).toHaveBeenCalledTimes(1);
    expect(securityAuditSpy).toHaveBeenCalledWith(
      'security-scan-skipped',
      container,
      'error',
      'Security scan skipped because the local tag moved between the pull and the recreate: ' +
        'nginx-a runs image sha256:retagged-image but nginx:1.1.0 was pulled as sha256:pulled-image; ' +
        'container kept by DD_SECURITY_AVAILABILITY_POLICY=warn',
    );
  });

  test('a moved tag on an update with no preflighted identity should be refused under availability policy block (DR-67)', async () => {
    trigger.configuration.dryrun = false;
    // Same update, same race, default policy: certainty wins and the
    // candidate is torn down rather than left running an unasked-for image.
    trigger.getSecurityGate().securityConfig.getSecurityConfiguration = vi.fn().mockReturnValue({
      enabled: false,
      availabilityPolicy: 'block',
      signature: { verify: false },
      gate: { mode: 'on' },
    });
    const container = makeContainer({ name: 'nginx-a' });
    mockDockerApi.getImage.mockReturnValue({
      inspect: vi.fn().mockResolvedValue({
        Id: 'sha256:pulled-image',
        RepoDigests: [],
        Architecture: process.arch === 'x64' ? 'amd64' : process.arch,
        Os: 'linux',
      }),
    });
    vi.spyOn(trigger, 'pullImage').mockResolvedValue();
    vi.spyOn(trigger, 'stopContainer').mockResolvedValue();
    vi.spyOn(trigger, 'removeContainer').mockResolvedValue();
    const rollbackSpy = vi
      .spyOn(trigger as any, 'attemptRollbackRestoreOldContainer')
      .mockResolvedValue({ status: 'rolled-back' });
    const removeCreated = vi.fn().mockResolvedValue(undefined);
    const startContainerSpy = vi.spyOn(trigger, 'startContainer').mockResolvedValue();
    vi.spyOn(trigger, 'createContainer').mockResolvedValue({
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      remove: removeCreated,
      inspect: vi.fn().mockResolvedValue({ Image: 'sha256:retagged-image' }),
    } as any);

    await expect(
      trigger.updateContainerWithCompose('/opt/drydock/test/stack.yml', 'nginx', container, {
        skipPull: true,
        runtimeContext: { dockerApi: mockDockerApi, newImage: 'nginx:1.1.0' },
      }),
    ).rejects.toThrow(
      'Recreated container nginx-a runs image sha256:retagged-image but nginx:1.1.0 was pulled as sha256:pulled-image',
    );

    expect(removeCreated).toHaveBeenCalledWith({ force: true });
    expect(startContainerSpy).not.toHaveBeenCalled();
    expect(rollbackSpy).toHaveBeenCalled();
  });

  test('a moved tag is refused under availability policy warn when the runtime context carries a pulledImageId (DR-67)', async () => {
    trigger.configuration.dryrun = false;
    // Pins the `pulledImageId` clause of the preflight marker on its own,
    // separately from `imageIdentity` and `onPulledImageIdResolved`: in
    // production the marker's three fields are never all set at once
    // (`imageIdentity` and `pulledImageId` are mutually exclusive outcomes of
    // the same preflight resolution), so this only exercises the field a
    // preflight populates when the pull could not be bound to a digest.
    // Availability policy is `warn`, which would keep an unpreflighted moved
    // tag; a preflighted one is refused regardless.
    trigger.getSecurityGate().securityConfig.getSecurityConfiguration = vi.fn().mockReturnValue({
      enabled: false,
      availabilityPolicy: 'warn',
      signature: { verify: false },
      gate: { mode: 'on' },
    });
    const container = makeContainer({ name: 'nginx-a' });
    vi.spyOn(trigger, 'pullImage').mockResolvedValue();
    vi.spyOn(trigger, 'stopContainer').mockResolvedValue();
    vi.spyOn(trigger, 'removeContainer').mockResolvedValue();
    const rollbackSpy = vi
      .spyOn(trigger as any, 'attemptRollbackRestoreOldContainer')
      .mockResolvedValue({ status: 'rolled-back' });
    const removeCreated = vi.fn().mockResolvedValue(undefined);
    const startContainerSpy = vi.spyOn(trigger, 'startContainer').mockResolvedValue();
    vi.spyOn(trigger, 'createContainer').mockResolvedValue({
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      remove: removeCreated,
      inspect: vi.fn().mockResolvedValue({ Image: 'sha256:retagged-image' }),
    } as any);

    await expect(
      trigger.updateContainerWithCompose('/opt/drydock/test/stack.yml', 'nginx', container, {
        skipPull: true,
        runtimeContext: {
          dockerApi: mockDockerApi,
          newImage: 'nginx:1.1.0',
          pulledImageId: 'sha256:pulled-image',
        },
      }),
    ).rejects.toThrow(
      'Recreated container nginx-a runs image sha256:retagged-image but nginx:1.1.0 was pulled as sha256:pulled-image',
    );

    expect(removeCreated).toHaveBeenCalledWith({ force: true });
    expect(startContainerSpy).not.toHaveBeenCalled();
    expect(rollbackSpy).toHaveBeenCalled();
  });

  test('a moved tag should be refused, not thrown over, when the security gate exposes no configuration (DR-67)', async () => {
    trigger.configuration.dryrun = false;
    // A gate with no securityConfig at all. Reading through it unguarded would
    // raise a TypeError inside the recreate's try, and the rollback net would
    // report that as a failed replacement, so a wiring bug would look exactly
    // like a tag that moved. The policy reads as unset, which is fail-closed.
    trigger.getSecurityGate = vi.fn().mockReturnValue({});
    const container = makeContainer({ name: 'nginx-a' });
    mockDockerApi.getImage.mockReturnValue({
      inspect: vi.fn().mockResolvedValue({
        Id: 'sha256:pulled-image',
        RepoDigests: [],
        Architecture: process.arch === 'x64' ? 'amd64' : process.arch,
        Os: 'linux',
      }),
    });
    vi.spyOn(trigger, 'pullImage').mockResolvedValue();
    vi.spyOn(trigger, 'stopContainer').mockResolvedValue();
    vi.spyOn(trigger, 'removeContainer').mockResolvedValue();
    const rollbackSpy = vi
      .spyOn(trigger as any, 'attemptRollbackRestoreOldContainer')
      .mockResolvedValue({ status: 'rolled-back' });
    const removeCreated = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(trigger, 'startContainer').mockResolvedValue();
    vi.spyOn(trigger, 'createContainer').mockResolvedValue({
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      remove: removeCreated,
      inspect: vi.fn().mockResolvedValue({ Image: 'sha256:retagged-image' }),
    } as any);

    await expect(
      trigger.updateContainerWithCompose('/opt/drydock/test/stack.yml', 'nginx', container, {
        skipPull: true,
        runtimeContext: { dockerApi: mockDockerApi, newImage: 'nginx:1.1.0' },
      }),
    ).rejects.toThrow(
      'Recreated container nginx-a runs image sha256:retagged-image but nginx:1.1.0 was pulled as sha256:pulled-image',
    );

    expect(rollbackSpy).toHaveBeenCalled();
  });

  test('a moved tag should be kept under a configured scanner whose identity binding is optional (DR-67)', async () => {
    trigger.configuration.dryrun = false;
    // The only posture that produces securityGateUnboundWarn in production:
    // scanning on, signature verification off, the gate on, and the
    // availability policy at warn, which makes the post-pull identity binding
    // policy `optional`. The image has no matching manifest digest, so the
    // pull cannot be bound, the gate half of the post-pull hook is suppressed
    // and the local image ID becomes what the recreate is checked against.
    trigger.getSecurityGate().securityConfig.getSecurityConfiguration = vi.fn().mockReturnValue({
      enabled: true,
      availabilityPolicy: 'warn',
      signature: { verify: false },
      gate: { mode: 'on' },
    });
    const container = makeContainer({ name: 'nginx-a' });
    mockDockerApi.getImage.mockReturnValue({
      inspect: vi.fn().mockResolvedValue({
        Id: 'sha256:pulled-image',
        RepoDigests: [],
        Architecture: process.arch === 'x64' ? 'amd64' : process.arch,
        Os: 'linux',
      }),
    });
    vi.spyOn(trigger, 'pullImage').mockResolvedValue();
    vi.spyOn(trigger, 'stopContainer').mockResolvedValue();
    vi.spyOn(trigger, 'removeContainer').mockResolvedValue();
    const rollbackSpy = vi
      .spyOn(trigger as any, 'attemptRollbackRestoreOldContainer')
      .mockResolvedValue({ status: 'rolled-back' });
    const removeCreated = vi.fn().mockResolvedValue(undefined);
    const startContainerSpy = vi.spyOn(trigger, 'startContainer').mockResolvedValue();
    const securityAuditSpy = vi.spyOn(trigger, 'recordSecurityAudit');
    const postPullHook = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(trigger, 'createContainer').mockResolvedValue({
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      remove: removeCreated,
      inspect: vi.fn().mockResolvedValue({ Image: 'sha256:retagged-image' }),
    } as any);

    await trigger.updateContainerWithCompose('/opt/drydock/test/stack.yml', 'nginx', container, {
      skipPull: true,
      runtimeContext: { dockerApi: mockDockerApi, newImage: 'nginx:1.1.0' },
      postPullHook,
    });

    // The unbindable pull suppresses the gate but still runs the rest of the
    // hook, and the moved tag afterwards is kept rather than rolled back.
    expect(postPullHook).toHaveBeenCalledWith('', undefined, { skipSecurityGate: true });
    expect(startContainerSpy).toHaveBeenCalled();
    expect(removeCreated).not.toHaveBeenCalled();
    expect(rollbackSpy).not.toHaveBeenCalled();
    expect(mockLog.warn).toHaveBeenCalledWith(
      'Recreated container nginx-a runs image sha256:retagged-image but nginx:1.1.0 was pulled as sha256:pulled-image; ' +
        'the local tag moved between the pull and the recreate. ' +
        'Keeping the container because DD_SECURITY_AVAILABILITY_POLICY=warn',
    );
    // Two separate skips, and the moved tag gets its own row rather than being
    // folded into the unbound-image one the binding policy already recorded.
    expect(securityAuditSpy).toHaveBeenCalledTimes(2);
    expect(securityAuditSpy).toHaveBeenLastCalledWith(
      'security-scan-skipped',
      container,
      'error',
      'Security scan skipped because the local tag moved between the pull and the recreate: ' +
        'nginx-a runs image sha256:retagged-image but nginx:1.1.0 was pulled as sha256:pulled-image; ' +
        'container kept by DD_SECURITY_AVAILABILITY_POLICY=warn',
    );
  });

  test('a moved tag kept under availability policy warn records no audit row when start then fails (DR-67)', async () => {
    trigger.configuration.dryrun = false;
    // Same race as the plain "kept" case, but the candidate never actually
    // starts: the rollback net tears it down and restores the previous
    // container, so the kept decision must not have already been written as
    // an audit row before start was attempted.
    trigger.getSecurityGate().securityConfig.getSecurityConfiguration = vi.fn().mockReturnValue({
      enabled: false,
      availabilityPolicy: 'warn',
      signature: { verify: false },
      gate: { mode: 'on' },
    });
    const container = makeContainer({ name: 'nginx-a' });
    mockDockerApi.getImage.mockReturnValue({
      inspect: vi.fn().mockResolvedValue({
        Id: 'sha256:pulled-image',
        RepoDigests: [],
        Architecture: process.arch === 'x64' ? 'amd64' : process.arch,
        Os: 'linux',
      }),
    });
    vi.spyOn(trigger, 'pullImage').mockResolvedValue();
    vi.spyOn(trigger, 'stopContainer').mockResolvedValue();
    vi.spyOn(trigger, 'removeContainer').mockResolvedValue();
    const rollbackSpy = vi
      .spyOn(trigger as any, 'attemptRollbackRestoreOldContainer')
      .mockResolvedValue({ status: 'rolled-back' });
    const removeCreated = vi.fn().mockResolvedValue(undefined);
    const startError = new Error('daemon refused to start the recreated container');
    const startContainerSpy = vi.spyOn(trigger, 'startContainer').mockRejectedValue(startError);
    const securityAuditSpy = vi.spyOn(trigger, 'recordSecurityAudit');
    vi.spyOn(trigger, 'createContainer').mockResolvedValue({
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      remove: removeCreated,
      inspect: vi.fn().mockResolvedValue({ Image: 'sha256:retagged-image' }),
    } as any);

    await expect(
      trigger.updateContainerWithCompose('/opt/drydock/test/stack.yml', 'nginx', container, {
        skipPull: true,
        runtimeContext: { dockerApi: mockDockerApi, newImage: 'nginx:1.1.0' },
      }),
    ).rejects.toThrow('daemon refused to start the recreated container');

    // The kept decision was reached and logged, but start failed right after,
    // so the candidate is removed and the previous container restored instead
    // of the update completing.
    expect(mockLog.warn).toHaveBeenCalledWith(
      'Recreated container nginx-a runs image sha256:retagged-image but nginx:1.1.0 was pulled as sha256:pulled-image; ' +
        'the local tag moved between the pull and the recreate. ' +
        'Keeping the container because DD_SECURITY_AVAILABILITY_POLICY=warn',
    );
    expect(startContainerSpy).toHaveBeenCalled();
    expect(removeCreated).toHaveBeenCalledWith({ force: true });
    expect(rollbackSpy).toHaveBeenCalled();
    // No row claims a container was kept under the policy when it never ran.
    expect(securityAuditSpy).not.toHaveBeenCalled();
  });

  test('compose-file-once should refuse a moved tag even under availability policy warn (DR-67)', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.prune = false;
    trigger.configuration.composeFileOnce = true;
    // The permissive policy that would keep the container had this container
    // resolved its own image. The preflight resolved one identity for the
    // whole service instead, so every replica runs on the one gate decision it
    // made and keeping this one would leave it on an image the gate never saw
    // while its siblings run the image it cleared.
    trigger.getSecurityGate().securityConfig.getSecurityConfiguration = vi.fn().mockReturnValue({
      enabled: true,
      availabilityPolicy: 'warn',
      signature: { verify: false },
      gate: { mode: 'on' },
    });
    const container = makeContainer({
      id: 'container-nginx-a',
      name: 'nginx-a',
      labels: { 'com.docker.compose.service': 'nginx' },
    });
    const composeFile = '/opt/drydock/test/stack.yml';
    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
    );
    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(
      Buffer.from(['services:', '  nginx:', '    image: nginx:1.0.0', ''].join('\n')),
    );
    vi.spyOn(trigger, 'writeComposeFile').mockResolvedValue();
    vi.spyOn(trigger, 'pullImage').mockResolvedValue();
    mockDockerApi.getImage.mockReturnValue({
      inspect: vi.fn().mockResolvedValue({
        Id: 'sha256:pulled-image',
        RepoDigests: [],
        Architecture: process.arch === 'x64' ? 'amd64' : process.arch,
        Os: 'linux',
      }),
    });
    vi.spyOn(trigger, 'recordUnboundSecurityWarning').mockImplementation(() => {});
    vi.spyOn(trigger, 'verifySignaturePreUpdate').mockResolvedValue();
    vi.spyOn(trigger, 'scanAndGatePostPull').mockResolvedValue();
    vi.spyOn(trigger, 'runPreUpdateHook').mockResolvedValue();
    vi.spyOn(trigger, 'runPostUpdateHook').mockResolvedValue();
    vi.spyOn(trigger, 'stopContainer').mockResolvedValue();
    vi.spyOn(trigger, 'removeContainer').mockResolvedValue();
    vi.spyOn(trigger as any, 'attemptRollbackRestoreOldContainer').mockResolvedValue({
      status: 'rolled-back',
    });
    const removeCreated = vi.fn().mockResolvedValue(undefined);
    const startContainerSpy = vi.spyOn(trigger, 'startContainer').mockResolvedValue();
    vi.spyOn(trigger, 'createContainer').mockResolvedValue({
      start: vi.fn().mockResolvedValue(undefined),
      remove: removeCreated,
      inspect: vi.fn().mockResolvedValue({ Image: 'sha256:retagged-image' }),
    } as any);
    vi.spyOn(trigger, 'runServicePostStartHooks').mockResolvedValue();
    vi.spyOn(trigger, 'cleanupOldImages').mockResolvedValue();
    vi.spyOn(trigger, 'maybeStartAutoRollbackMonitor').mockResolvedValue();

    await expect(trigger.processComposeFile(composeFile, [container])).rejects.toThrow(
      'Recreated container nginx-a runs image sha256:retagged-image but nginx:1.1.0 was pulled as sha256:pulled-image',
    );

    expect(removeCreated).toHaveBeenCalledWith({ force: true });
    expect(startContainerSpy).not.toHaveBeenCalled();
  });

  test('compose-file-once should refuse a moved tag on the replica that recovered the batch image ID (DR-67)', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.prune = false;
    trigger.configuration.composeFileOnce = true;
    // The posture that used to slip through: no scanner, so the identity
    // binding policy is `disabled` and the preflight's failed inspect records
    // no image ID at all, plus the permissive availability policy. The first
    // replica then arrives with pulledImageId undefined and resolves the ID
    // itself, and keeping it under warn would leave it on the moved image
    // while every replica after it was held to the ID it published and
    // refused. The write-back sink is what marks it as part of the batch.
    trigger.getSecurityGate().securityConfig.getSecurityConfiguration = vi.fn().mockReturnValue({
      enabled: false,
      availabilityPolicy: 'warn',
      signature: { verify: false },
      gate: { mode: 'on' },
    });
    const firstContainer = makeContainer({
      id: 'container-nginx-a',
      name: 'nginx-a',
      labels: { 'com.docker.compose.service': 'nginx' },
    });
    const secondContainer = makeContainer({
      id: 'container-nginx-b',
      name: 'nginx-b',
      labels: { 'com.docker.compose.service': 'nginx' },
    });
    const composeFile = '/opt/drydock/test/stack.yml';
    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
    );
    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(
      Buffer.from(['services:', '  nginx:', '    image: nginx:1.0.0', ''].join('\n')),
    );
    vi.spyOn(trigger, 'writeComposeFile').mockResolvedValue();
    vi.spyOn(trigger, 'pullImage').mockResolvedValue();
    // The preflight's inspect throws, which is the only way a compose-file-once
    // context reaches a replica with no image ID on it. Every inspect after
    // that succeeds, so the first replica recovers one.
    let imageInspectCalls = 0;
    mockDockerApi.getImage.mockReturnValue({
      inspect: vi.fn().mockImplementation(async () => {
        imageInspectCalls += 1;
        if (imageInspectCalls === 1) {
          throw new Error('image inspect unavailable');
        }
        return {
          Id: 'sha256:image-a',
          RepoDigests: [],
          Architecture: process.arch === 'x64' ? 'amd64' : process.arch,
          Os: 'linux',
        };
      }),
    });
    vi.spyOn(trigger, 'verifySignaturePreUpdate').mockResolvedValue();
    vi.spyOn(trigger, 'scanAndGatePostPull').mockResolvedValue();
    vi.spyOn(trigger, 'runPreUpdateHook').mockResolvedValue();
    vi.spyOn(trigger, 'runPostUpdateHook').mockResolvedValue();
    vi.spyOn(trigger, 'stopContainer').mockResolvedValue();
    vi.spyOn(trigger, 'removeContainer').mockResolvedValue();
    vi.spyOn(trigger as any, 'attemptRollbackRestoreOldContainer').mockResolvedValue({
      status: 'rolled-back',
    });
    const removeCreated = vi.fn().mockResolvedValue(undefined);
    const startContainerSpy = vi.spyOn(trigger, 'startContainer').mockResolvedValue();
    // An external pull moves nginx:1.1.0 between the first replica's own
    // resolve and its create, so this replica is the one that diverges.
    const createContainerSpy = vi.spyOn(trigger, 'createContainer').mockResolvedValue({
      start: vi.fn().mockResolvedValue(undefined),
      remove: removeCreated,
      inspect: vi.fn().mockResolvedValue({ Image: 'sha256:image-b' }),
    } as any);
    vi.spyOn(trigger, 'runServicePostStartHooks').mockResolvedValue();
    vi.spyOn(trigger, 'cleanupOldImages').mockResolvedValue();
    vi.spyOn(trigger, 'maybeStartAutoRollbackMonitor').mockResolvedValue();

    await expect(
      trigger.processComposeFile(composeFile, [firstContainer, secondContainer]),
    ).rejects.toThrow(
      'Recreated container nginx-a runs image sha256:image-b but nginx:1.1.0 was pulled as sha256:image-a',
    );

    // Refused rather than kept, and the batch stops here: the second replica
    // is never created, so the service is not left split across two images.
    expect(removeCreated).toHaveBeenCalledWith({ force: true });
    expect(startContainerSpy).not.toHaveBeenCalled();
    expect(createContainerSpy).toHaveBeenCalledTimes(1);
    expect(mockLog.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('Keeping the container because DD_SECURITY_AVAILABILITY_POLICY=warn'),
    );
  });

  test('compose-file-once should carry a recovered image ID to the next replica (DR-54)', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.prune = false;
    trigger.configuration.composeFileOnce = true;
    const firstContainer = makeContainer({
      id: 'container-nginx-a',
      name: 'nginx-a',
      labels: { 'com.docker.compose.service': 'nginx' },
    });
    const secondContainer = makeContainer({
      id: 'container-nginx-b',
      name: 'nginx-b',
      labels: { 'com.docker.compose.service': 'nginx' },
    });
    const composeFile = '/opt/drydock/test/stack.yml';
    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
    );
    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(
      Buffer.from(['services:', '  nginx:', '    image: nginx:1.0.0', ''].join('\n')),
    );
    vi.spyOn(trigger, 'writeComposeFile').mockResolvedValue();
    vi.spyOn(trigger, 'pullImage').mockResolvedValue();
    // The preflight's inspect fails, so the service context starts with no
    // image ID. Whatever the first replica recovers has to reach the second.
    let localTagImageId = 'sha256:image-a';
    let imageInspectCalls = 0;
    mockDockerApi.getImage.mockReturnValue({
      inspect: vi.fn().mockImplementation(async () => {
        imageInspectCalls += 1;
        if (imageInspectCalls === 1) {
          throw new Error('image inspect unavailable');
        }
        return {
          Id: localTagImageId,
          RepoDigests: [],
          Architecture: process.arch === 'x64' ? 'amd64' : process.arch,
          Os: 'linux',
        };
      }),
    });
    const capturePulledImageIdentitySpy = vi.spyOn(trigger, 'capturePulledImageIdentity');
    vi.spyOn(trigger, 'verifySignaturePreUpdate').mockResolvedValue();
    vi.spyOn(trigger, 'scanAndGatePostPull').mockResolvedValue();
    vi.spyOn(trigger, 'runPreUpdateHook').mockResolvedValue();
    vi.spyOn(trigger, 'runPostUpdateHook').mockResolvedValue();
    vi.spyOn(trigger, 'stopContainer').mockResolvedValue();
    vi.spyOn(trigger, 'removeContainer').mockResolvedValue();
    vi.spyOn(trigger as any, 'attemptRollbackRestoreOldContainer').mockResolvedValue({
      status: 'rolled-back',
    });
    const removeCreated = vi.fn().mockResolvedValue(undefined);
    let createCalls = 0;
    const createContainerSpy = vi.spyOn(trigger, 'createContainer').mockImplementation(async () => {
      createCalls += 1;
      const createdImageId = localTagImageId;
      if (createCalls === 1) {
        // An external pull moves nginx:1.1.0 on to a new image between the
        // two replicas, which is the whole hazard: the second replica must
        // not quietly accept it just because it resolves the tag again.
        localTagImageId = 'sha256:image-b';
      }
      return {
        start: vi.fn().mockResolvedValue(undefined),
        remove: removeCreated,
        inspect: vi.fn().mockResolvedValue({ Image: createdImageId }),
      } as any;
    });
    vi.spyOn(trigger, 'startContainer').mockResolvedValue();
    vi.spyOn(trigger, 'runServicePostStartHooks').mockResolvedValue();
    vi.spyOn(trigger, 'cleanupOldImages').mockResolvedValue();
    vi.spyOn(trigger, 'maybeStartAutoRollbackMonitor').mockResolvedValue();

    await expect(
      trigger.processComposeFile(composeFile, [firstContainer, secondContainer]),
    ).rejects.toThrow(
      'Recreated container nginx-b runs image sha256:image-b but nginx:1.1.0 was pulled as sha256:image-a',
    );

    // Twice, not three times: the preflight tried and failed, the first
    // replica recovered the ID, and the second replica read that recovery off
    // the service context instead of resolving the tag for itself.
    expect(capturePulledImageIdentitySpy).toHaveBeenCalledTimes(2);
    expect(createContainerSpy).toHaveBeenCalledTimes(2);
    expect(removeCreated).toHaveBeenCalledWith({ force: true });
  });

  test('compose-file-once should check the recreate against an image ID the preflight failed to resolve (DR-54)', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.prune = false;
    trigger.configuration.composeFileOnce = true;
    const container = makeContainer({
      id: 'container-nginx-a',
      name: 'nginx-a',
      labels: { 'com.docker.compose.service': 'nginx' },
    });
    const composeFile = '/opt/drydock/test/stack.yml';
    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
    );
    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(
      Buffer.from(['services:', '  nginx:', '    image: nginx:1.0.0', ''].join('\n')),
    );
    vi.spyOn(trigger, 'writeComposeFile').mockResolvedValue();
    vi.spyOn(trigger, 'pullImage').mockResolvedValue();
    // The preflight's inspect fails, so it stores a context with no image ID
    // at all. The runtime refresh resolves one and that recovery is what the
    // recreate has to be checked against.
    let imageInspectCalls = 0;
    mockDockerApi.getImage.mockReturnValue({
      inspect: vi.fn().mockImplementation(async () => {
        imageInspectCalls += 1;
        if (imageInspectCalls === 1) {
          throw new Error('image inspect unavailable');
        }
        return {
          Id: 'sha256:recovered-image',
          RepoDigests: [],
          Architecture: process.arch === 'x64' ? 'amd64' : process.arch,
          Os: 'linux',
        };
      }),
    });
    vi.spyOn(trigger, 'verifySignaturePreUpdate').mockResolvedValue();
    vi.spyOn(trigger, 'scanAndGatePostPull').mockResolvedValue();
    vi.spyOn(trigger, 'runPreUpdateHook').mockResolvedValue();
    vi.spyOn(trigger, 'runPostUpdateHook').mockResolvedValue();
    vi.spyOn(trigger, 'stopContainer').mockResolvedValue();
    vi.spyOn(trigger, 'removeContainer').mockResolvedValue();
    vi.spyOn(trigger as any, 'attemptRollbackRestoreOldContainer').mockResolvedValue({
      status: 'rolled-back',
    });
    const removeCreated = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(trigger, 'createContainer').mockResolvedValue({
      start: vi.fn().mockResolvedValue(undefined),
      remove: removeCreated,
      inspect: vi.fn().mockResolvedValue({ Image: 'sha256:moved-image' }),
    } as any);
    vi.spyOn(trigger, 'startContainer').mockResolvedValue();
    vi.spyOn(trigger, 'runServicePostStartHooks').mockResolvedValue();
    vi.spyOn(trigger, 'cleanupOldImages').mockResolvedValue();
    vi.spyOn(trigger, 'maybeStartAutoRollbackMonitor').mockResolvedValue();

    await expect(trigger.processComposeFile(composeFile, [container])).rejects.toThrow(
      'was pulled as sha256:recovered-image',
    );

    expect(removeCreated).toHaveBeenCalledWith({ force: true });
  });

  test('compose-file-once should preflight every service before the compose write and preserve the services it already refreshed', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.prune = false;
    trigger.configuration.composeFileOnce = true;
    const composeFile = '/opt/drydock/test/stack.yml';
    const originalCompose = [
      'services:',
      '  nginx:',
      '    image: nginx:1.0.0',
      '  redis:',
      '    image: redis:7.0.0',
      '',
    ].join('\n');
    const containers = [
      makeContainer({
        name: 'nginx',
        updateAvailable: true,
        labels: { 'com.docker.compose.service': 'nginx' },
      }),
      makeContainer({
        name: 'redis',
        imageName: 'redis',
        tagValue: '7.0.0',
        remoteValue: '7.2.0',
        updateAvailable: true,
        labels: { 'com.docker.compose.service': 'redis' },
      }),
    ];
    const callOrder: string[] = [];
    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({
        nginx: { image: 'nginx:1.0.0' },
        redis: { image: 'redis:7.0.0' },
      }),
    );
    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(Buffer.from(originalCompose));
    const writeComposeFileSpy = vi
      .spyOn(trigger, 'writeComposeFile')
      .mockImplementation(async () => {
        callOrder.push('write');
      });
    vi.spyOn(trigger, 'pullImage').mockImplementation(async () => {
      callOrder.push('pull');
    });
    vi.spyOn(trigger, 'verifySignaturePreUpdate').mockResolvedValue();
    vi.spyOn(trigger, 'scanAndGatePostPull').mockImplementation(async (_context, container) => {
      callOrder.push(`gate:${container.name}`);
    });
    vi.spyOn(trigger, 'runContainerUpdateLifecycle').mockImplementation(
      async (_container, composeContext) => {
        callOrder.push(`refresh:${composeContext.service}`);
        expect(composeContext.skipPull).toBe(true);
        expect(composeContext.postPullGateCompleted).toBe(true);
        if (composeContext.service === 'redis') {
          throw new Error('redis runtime refresh failed');
        }
      },
    );

    await expect(trigger.processComposeFile(composeFile, containers)).rejects.toThrow(
      'redis runtime refresh failed',
    );

    expect(callOrder).toEqual([
      'pull',
      'pull',
      'gate:nginx',
      'gate:redis',
      'write',
      'refresh:nginx',
      'refresh:redis',
      'write',
    ]);
    const partiallyRestoredComposeText = writeComposeFileSpy.mock.calls.at(-1)?.[1] as string;
    expect(partiallyRestoredComposeText).toContain('nginx:1.1.0');
    expect(partiallyRestoredComposeText).toContain('redis:7.0.0');
    expect(partiallyRestoredComposeText).not.toContain('redis:7.2.0');
    expect(trigger.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('preserving completed services (nginx)'),
    );
  });

  // Compose-file-once pulls once per service and recreates every replica, so
  // the steps around that pull run at two different rates and nothing in the
  // lifecycle names either of them. The gate belongs to the container and runs
  // in the preflight, so every replica is gated before the compose file is
  // written and none of them is gated a second time inside its own refresh.
  // The pre-update hook and the prune/backup step sit behind that gate and are
  // per container too, so a replica cannot be recreated without them.
  test('compose-file-once gates every replica in the preflight and runs the pre-update hook and prune/backup once each', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.prune = true;
    trigger.configuration.composeFileOnce = true;
    // The preflight resolves a registry manager for its single pull, which
    // needs normalizeImage once pruning is enabled.
    getState().registry.hub.normalizeImage = (image) => image;
    const composeFile = '/opt/drydock/test/stack.yml';
    const originalCompose = ['services:', '  nginx:', '    image: nginx:1.0.0', ''].join('\n');
    const replicas = ['nginx-1', 'nginx-2'].map((name) =>
      makeContainer({
        id: name,
        name,
        updateAvailable: true,
        labels: { 'com.docker.compose.service': 'nginx' },
      }),
    );
    vi.spyOn(trigger as any, 'capturePulledImageIdentity').mockResolvedValue({
      imageIdentity: `nginx:1.1.0@sha256:${'a'.repeat(64)}`,
      unboundWarn: false,
    });
    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
    );
    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(Buffer.from(originalCompose));
    vi.spyOn(trigger, 'writeComposeFile').mockResolvedValue();
    const pullImageSpy = vi.spyOn(trigger, 'pullImage').mockResolvedValue();
    vi.spyOn(trigger, 'verifySignaturePreUpdate').mockResolvedValue();
    const callOrder: string[] = [];
    vi.spyOn(trigger, 'scanAndGatePostPull').mockImplementation(async (_context, container) => {
      callOrder.push(`gate:${container.name}`);
    });
    const preUpdateHookSpy = vi
      .spyOn(trigger, 'runPreUpdateHook')
      .mockImplementation(async (container) => {
        callOrder.push(`hook:${container.name}`);
      });
    const pruneImagesSpy = vi
      .spyOn(trigger, 'pruneImages')
      .mockImplementation(async (_dockerApi, _registry, container) => {
        callOrder.push(`prune:${container.name}`);
      });
    const backupSpy = vi
      .spyOn(trigger as any, 'insertContainerImageBackup')
      .mockImplementation((_context, container) => {
        callOrder.push(`backup:${container.name}`);
      });
    const composeUpdateSpy = vi
      .spyOn(trigger, 'updateContainerWithCompose')
      .mockImplementation(async (_composeFile, _service, container, options = {}) => {
        // Stand in for the real refresh: it checks the container is still there
        // and that its inspect came back with usable runtime state, then calls
        // the post-pull hook, and only then recreates.
        callOrder.push(`check:${container.name}`);
        await invokeComposeRefreshPostPullHook(container, options);
        callOrder.push(`refresh:${container.name}`);
      });
    vi.spyOn(trigger, 'runServicePostStartHooks').mockResolvedValue();
    vi.spyOn(trigger, 'runPostUpdateHook').mockResolvedValue();
    vi.spyOn(trigger, 'cleanupOldImages').mockResolvedValue();
    vi.spyOn(trigger, 'maybeStartAutoRollbackMonitor').mockResolvedValue();

    await trigger.processComposeFile(composeFile, replicas);

    // One pull for the service, shared by both replicas.
    expect(pullImageSpy).toHaveBeenCalledTimes(1);
    // Every replica is recreated, and the steps the gate protects run once for
    // each of them rather than once for the service.
    expect(composeUpdateSpy).toHaveBeenCalledTimes(2);
    expect(preUpdateHookSpy).toHaveBeenCalledTimes(2);
    expect(pruneImagesSpy).toHaveBeenCalledTimes(2);
    expect(backupSpy).toHaveBeenCalledTimes(2);
    // Both replicas are gated in the preflight, before either is touched, and
    // neither gates again inside its own refresh. Each replica then gets its
    // own hook, prune and backup, in that order, after its refresh has checked
    // the container and before that refresh recreates it, so no replica can be
    // recreated without them and a refresh that aborts on a missing container
    // or an unusable inspect leaves none of them behind (DR-75).
    expect(callOrder).toEqual([
      'gate:nginx-1',
      'gate:nginx-2',
      'check:nginx-1',
      'hook:nginx-1',
      'prune:nginx-1',
      'backup:nginx-1',
      'refresh:nginx-1',
      'check:nginx-2',
      'hook:nginx-2',
      'prune:nginx-2',
      'backup:nginx-2',
      'refresh:nginx-2',
    ]);
  });

  test('compose-file-once preflight failure terminalizes every active mapped operation', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.composeFileOnce = true;
    const operationStatuses = new Map([
      ['op-a', 'queued'],
      ['op-b', 'in-progress'],
      ['op-terminal', 'succeeded'],
    ]);
    const getOperationByIdSpy = vi
      .spyOn(updateOperationStore, 'getOperationById')
      .mockImplementation((id) => {
        const status = operationStatuses.get(id);
        return status ? ({ id, status } as any) : undefined;
      });
    const markOperationTerminalSpy = vi
      .spyOn(updateOperationStore, 'markOperationTerminal')
      .mockImplementation((id) => {
        operationStatuses.set(id, 'failed');
        return { id, status: 'failed' } as any;
      });
    const firstContainer = makeContainer({ id: 'container-a', name: 'nginx-a' });
    const secondContainer = makeContainer({ id: 'container-b', name: 'redis-b' });
    const terminalContainer = makeContainer({ id: 'container-c', name: 'postgres-c' });
    vi.spyOn(trigger, 'pullImage').mockResolvedValue();
    vi.spyOn(trigger, 'scanAndGatePostPull').mockRejectedValue(new Error('preflight blocked'));

    await expect(
      trigger.applyComposeMutationsAndRuntimeUpdates(
        '/opt/drydock/test/stack.yml',
        ['/opt/drydock/test/stack.yml'],
        new Map(),
        '/opt/drydock/test/stack.yml',
        makeCompose({ nginx: {}, redis: {}, postgres: {} }),
        [],
        [
          { service: 'nginx', container: firstContainer },
          { service: 'redis', container: secondContainer },
          { service: 'postgres', container: terminalContainer },
        ],
        {
          operationIds: new Map([
            ['container-a', 'op-a'],
            ['container-b', 'op-b'],
            ['container-c', 'op-terminal'],
          ]),
        },
      ),
    ).rejects.toThrow('preflight blocked');

    expect(getOperationByIdSpy).toHaveBeenCalledWith('op-a');
    expect(getOperationByIdSpy).toHaveBeenCalledWith('op-b');
    expect(getOperationByIdSpy).toHaveBeenCalledWith('op-terminal');
    expect(markOperationTerminalSpy).toHaveBeenCalledTimes(2);
    expect(markOperationTerminalSpy).toHaveBeenNthCalledWith(
      1,
      'op-a',
      expect.objectContaining({
        status: 'failed',
        phase: 'failed',
        lastError: 'preflight blocked',
      }),
    );
    expect(markOperationTerminalSpy).toHaveBeenNthCalledWith(
      2,
      'op-b',
      expect.objectContaining({
        status: 'failed',
        phase: 'failed',
        lastError: 'preflight blocked',
      }),
    );
  });

  test('processComposeFile should leave the compose file and its backup untouched when a post-pull hook rejects', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.prune = false;
    trigger.configuration.composeFileOnce = true;
    trigger.configuration.backup = true;
    const container = makeContainer({
      id: 'nginx-rejected',
      name: 'nginx',
      labels: { 'com.docker.compose.service': 'nginx' },
    });
    const composeFile = '/opt/drydock/test/stack.yml';
    const originalCompose = ['services:', '  nginx:', '    image: nginx:1.0.0', ''].join('\n');
    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
    );
    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(Buffer.from(originalCompose));
    const writeComposeFileSpy = vi.spyOn(trigger, 'writeComposeFile').mockResolvedValue();
    const backupSpy = vi.spyOn(trigger, 'backup').mockResolvedValue();
    const pullImageSpy = vi.spyOn(trigger, 'pullImage').mockResolvedValue();
    const stopContainerSpy = vi.spyOn(trigger, 'stopContainer').mockResolvedValue();
    const removeContainerSpy = vi.spyOn(trigger, 'removeContainer').mockResolvedValue();
    const createContainerSpy = vi.spyOn(trigger, 'createContainer').mockResolvedValue({
      start: vi.fn().mockResolvedValue(undefined),
    } as any);
    const startContainerSpy = vi.spyOn(trigger, 'startContainer').mockResolvedValue();
    vi.spyOn(trigger, 'verifySignaturePreUpdate').mockResolvedValue();
    vi.spyOn(trigger, 'runPreUpdateHook').mockResolvedValue();
    const hookError = new Error('post-pull gate blocked');
    const scanAndGatePostPullSpy = vi
      .spyOn(trigger, 'scanAndGatePostPull')
      .mockRejectedValue(hookError);
    vi.spyOn(trigger, 'runServicePostStartHooks').mockResolvedValue();
    vi.spyOn(trigger, 'runPostUpdateHook').mockResolvedValue();
    vi.spyOn(trigger, 'cleanupOldImages').mockResolvedValue();
    vi.spyOn(trigger, 'maybeStartAutoRollbackMonitor').mockResolvedValue();

    await expect(trigger.processComposeFile(composeFile, [container])).rejects.toThrow(
      'post-pull gate blocked',
    );

    expect(pullImageSpy).toHaveBeenCalledTimes(1);
    expect(scanAndGatePostPullSpy).toHaveBeenCalledTimes(1);
    expect(stopContainerSpy).not.toHaveBeenCalled();
    expect(removeContainerSpy).not.toHaveBeenCalled();
    expect(createContainerSpy).not.toHaveBeenCalled();
    expect(startContainerSpy).not.toHaveBeenCalled();
    expect(writeComposeFileSpy).not.toHaveBeenCalled();
    expect(backupSpy).not.toHaveBeenCalled();
  });

  test('preview should passthrough base preview errors without compose metadata', async () => {
    const basePreviewSpy = vi
      .spyOn(Object.getPrototypeOf(Dockercompose.prototype), 'preview')
      .mockResolvedValue({ error: 'base preview failure' } as any);
    try {
      await expect(trigger.preview(makeContainer() as any)).resolves.toEqual({
        error: 'base preview failure',
      });
    } finally {
      basePreviewSpy.mockRestore();
    }
  });

  test('preview should include compose patch metadata when service image changes', async () => {
    const basePreviewSpy = vi
      .spyOn(Object.getPrototypeOf(Dockercompose.prototype), 'preview')
      .mockResolvedValue({ newImage: 'nginx:1.1.0' } as any);
    vi.spyOn(trigger, 'resolveComposeServiceContext').mockResolvedValue({
      composeFile: '/opt/drydock/test/stack.override.yml',
      composeFiles: ['/opt/drydock/test/stack.yml', '/opt/drydock/test/stack.override.yml'],
      compose: makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
      service: 'nginx',
    } as any);
    vi.spyOn(trigger, 'mapCurrentVersionToUpdateVersion').mockReturnValue({
      service: 'nginx',
      current: 'nginx:1.0.0',
      update: 'nginx:1.1.0',
      currentNormalized: 'nginx:1.0.0',
      updateNormalized: 'nginx:1.1.0',
    } as any);

    try {
      const preview = await trigger.preview(makeContainer() as any);

      expect(preview.compose).toEqual(
        expect.objectContaining({
          files: ['/opt/drydock/test/stack.yml', '/opt/drydock/test/stack.override.yml'],
          service: 'nginx',
          mutation: {
            intent: 'update-compose-service-image',
            dryRun: true,
            willWrite: false,
          },
          patch: expect.objectContaining({
            path: '/opt/drydock/test/stack.override.yml',
            format: 'unified',
          }),
        }),
      );
      expect(preview.compose.patch.diff).toContain('-  image: nginx:1.0.0');
      expect(preview.compose.patch.diff).toContain('+  image: nginx:1.1.0');
    } finally {
      basePreviewSpy.mockRestore();
    }
  });

  test('preview should omit compose patch when target image is unchanged', async () => {
    const basePreviewSpy = vi
      .spyOn(Object.getPrototypeOf(Dockercompose.prototype), 'preview')
      .mockResolvedValue({ newImage: 'nginx:1.0.0' } as any);
    vi.spyOn(trigger, 'resolveComposeServiceContext').mockResolvedValue({
      composeFile: '/opt/drydock/test/stack.yml',
      composeFiles: ['/opt/drydock/test/stack.yml'],
      compose: makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
      service: 'nginx',
    } as any);
    vi.spyOn(trigger, 'mapCurrentVersionToUpdateVersion').mockReturnValue(undefined);

    try {
      const preview = await trigger.preview(makeContainer() as any);

      expect(preview.compose.patch).toBeUndefined();
    } finally {
      basePreviewSpy.mockRestore();
    }
  });

  test('updateContainerWithCompose should use Docker API pull regardless of compose file chain', async () => {
    trigger.configuration.dryrun = false;
    const pullImageSpy = vi.spyOn(trigger, 'pullImage').mockResolvedValue();
    const composeFiles = ['/opt/drydock/test/stack.yml', '/opt/drydock/test/stack.override.yml'];
    const container = makeContainer({
      name: 'nginx',
    });

    await trigger.updateContainerWithCompose('/opt/drydock/test/stack.yml', 'nginx', container, {
      composeFiles,
      shouldStart: true,
      skipPull: false,
    });

    expect(pullImageSpy).toHaveBeenCalledTimes(1);
  });

  test('recreateContainer should include compose file chain when compose service is defined in overrides', async () => {
    const container = makeContainer({
      name: 'nginx',
      labels: {
        'dd.compose.file': '/opt/drydock/test/stack.yml',
        'com.docker.compose.service': 'nginx',
      },
    });
    vi.spyOn(trigger, 'resolveComposeServiceContext').mockResolvedValue({
      composeFile: '/opt/drydock/test/stack.override.yml',
      composeFiles: ['/opt/drydock/test/stack.yml', '/opt/drydock/test/stack.override.yml'],
      service: 'nginx',
    } as any);
    vi.spyOn(trigger, 'mutateComposeFile').mockResolvedValue(true);
    const refreshComposeServiceSpy = vi
      .spyOn(trigger as any, 'refreshComposeServiceWithDockerApi')
      .mockResolvedValue();

    await trigger.recreateContainer(
      mockDockerApi,
      {
        State: { Running: true },
        Config: { Image: 'nginx:1.0.0' },
      },
      'nginx:1.1.0',
      container,
      mockLog,
    );

    expect(refreshComposeServiceSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/stack.override.yml',
      'nginx',
      container,
      {
        shouldStart: true,
        skipPull: true,
        forceRecreate: true,
        composeFiles: ['/opt/drydock/test/stack.yml', '/opt/drydock/test/stack.override.yml'],
        // The image the caller asked for, so the refresh cannot re-derive the
        // container's update candidate instead of it.
        runtimeContext: { newImage: 'nginx:1.1.0', preferredDigest: null },
      },
    );
  });

  test('setComposeCacheEntry should clear caches when max entries is below one', () => {
    const cache = new Map<string, unknown>([
      ['a', { value: 1 }],
      ['b', { value: 2 }],
    ]);
    trigger._composeCacheMaxEntries = 0;

    trigger.setComposeCacheEntry(cache, 'c', { value: 3 });

    expect(cache.size).toBe(0);
  });

  test('validateComposeConfiguration should append target compose file when compose chain omits it', async () => {
    const getComposeFileAsObjectSpy = vi
      .spyOn(trigger, 'getComposeFileAsObject')
      .mockResolvedValue(makeCompose({ base: { image: 'busybox:1.0.0' } }));

    await trigger.validateComposeConfiguration(
      '/opt/drydock/test/stack.override.yml',
      'services:\n  nginx:\n    image: nginx:1.1.0\n',
      {
        composeFiles: ['/opt/drydock/test/stack.yml'],
      },
    );

    expect(getComposeFileAsObjectSpy).toHaveBeenCalledWith('/opt/drydock/test/stack.yml');
  });
});
