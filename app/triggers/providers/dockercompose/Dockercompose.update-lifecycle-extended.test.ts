import { watch } from 'node:fs';
import fs from 'node:fs/promises';
import { getState } from '../../../registry/index.js';
import * as updateOperationStore from '../../../store/update-operation.js';
import { getRequestedOperationId } from '../docker/update-runtime-context.js';
import Dockercompose from './Dockercompose.js';
import {
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

  test('performContainerUpdate should skip per-service refresh when compose-file-once is already applied', async () => {
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
    expect(updateContainerWithComposeSpy).not.toHaveBeenCalled();
    expect(hooksSpy).toHaveBeenCalledWith(container, 'nginx', {});
    expect(mockLog.info).toHaveBeenCalledWith(
      expect.stringContaining('Skip per-service compose refresh for nginx'),
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
    expect(updateContainerWithComposeSpy).toHaveBeenCalledTimes(1);
    expect(updateContainerWithComposeSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/stack.yml',
      'nginx',
      firstContainer,
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
    expect(writeComposeFileSpy).toHaveBeenLastCalledWith(composeFile, originalCompose);
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
      trigger.runRuntimeUpdatesForComposeMappings(
        '/opt/drydock/test/stack.yml',
        ['/opt/drydock/test/stack.yml'],
        makeCompose({ nginx: {}, redis: {}, postgres: {} }),
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

  test('processComposeFile should restore mutations and leave runtime untouched when a post-pull hook rejects', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.prune = false;
    trigger.configuration.composeFileOnce = true;
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
    expect(writeComposeFileSpy).toHaveBeenLastCalledWith(composeFile, originalCompose);
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
