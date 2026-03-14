import { EventEmitter } from 'node:events';
import { watch } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'yaml';
import { emitContainerUpdateApplied, emitContainerUpdateFailed } from '../../../event/index.js';
import { getState } from '../../../registry/index.js';
import * as backupStore from '../../../store/backup.js';
import { sleep } from '../../../util/sleep.js';
import Dockercompose, {
  testable_hasExplicitRegistryHost,
  testable_normalizeImplicitLatest,
  testable_normalizePostStartEnvironmentValue,
  testable_normalizePostStartHooks,
  testable_updateComposeServiceImageInText,
} from './Dockercompose.js';

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

// ---------------------------------------------------------------------------
// Factory helpers to eliminate repeated object literals
// ---------------------------------------------------------------------------

/**
 * Build a container object for tests. Only the fields that vary need to be
 * supplied; sensible defaults cover the rest.
 */
function makeContainer(overrides: Record<string, unknown> = {}) {
  const {
    name = 'nginx',
    imageName = 'nginx',
    registryName = 'hub',
    tagValue = '1.0.0',
    updateKind = 'tag',
    remoteValue = '1.1.0',
    labels,
    watcher = 'local',
    ...rest
  } = overrides as any;

  const container: Record<string, unknown> = {
    name,
    watcher,
    image: {
      name: imageName,
      registry: { name: registryName },
      tag: { value: tagValue },
    },
    updateKind: {
      kind: updateKind,
      remoteValue,
      localValue: tagValue,
    },
    ...rest,
  };

  if (labels !== undefined) container.labels = labels;

  return container;
}

/**
 * Build a compose object with the given services map.
 */
function makeCompose(services: Record<string, unknown>) {
  return { services };
}

/**
 * Create the trio of mock objects needed to simulate Docker exec inside a
 * running container: the EventEmitter stream, the exec handle, and the
 * container itself.
 *
 * @param exitCode  - exit code returned by exec.inspect() (default 0)
 * @param streamEvent - event emitted by the stream to signal completion
 *                      (default 'close')
 * @param streamError - if provided, the stream emits an 'error' with this
 * @param hasResume  - whether the stream has a resume() method (default true)
 * @param hasOnce    - whether the stream is a real EventEmitter (default true)
 */
function makeExecMocks({
  exitCode = 0,
  streamEvent = 'close',
  streamError = undefined as Error | undefined,
  hasResume = true,
  hasOnce = true,
} = {}) {
  let startStream: any;
  if (hasOnce) {
    startStream = new EventEmitter();
    if (hasResume) {
      startStream.resume = vi.fn();
    }
  } else {
    // Plain object without EventEmitter – exercises the "no once" branch
    startStream = {};
  }

  const mockExec = {
    start: vi.fn().mockImplementation(async () => {
      if (hasOnce) {
        setImmediate(() => {
          if (streamError) {
            startStream.emit('error', streamError);
          } else {
            startStream.emit(streamEvent);
          }
        });
      }
      return startStream;
    }),
    inspect: vi.fn().mockResolvedValue({ ExitCode: exitCode }),
  };

  const recreatedContainer = {
    inspect: vi.fn().mockResolvedValue({
      State: { Running: true },
    }),
    exec: vi.fn().mockResolvedValue(mockExec),
  };

  return { startStream, mockExec, recreatedContainer };
}

function makeDockerContainerHandle({
  running = true,
  image = 'nginx:1.0.0',
  id = 'container-id',
  name = 'nginx',
  autoRemove = false,
} = {}) {
  return {
    id,
    inspect: vi.fn().mockResolvedValue({
      Id: id,
      Name: `/${name}`,
      Config: {
        Image: image,
        Env: [],
        Labels: {},
      },
      HostConfig: {
        AutoRemove: autoRemove,
      },
      NetworkSettings: {
        Networks: {},
      },
      State: { Running: running },
    }),
    stop: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    wait: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * Set up the common spies used by processComposeFile tests that exercise
 * the write / trigger / hooks path.
 */
function spyOnProcessComposeHelpers(
  triggerInstance,
  composeFileContent = [
    'services:',
    '  nginx:',
    '    image: nginx:1.0.0',
    '  redis:',
    '    image: redis:7.0.0',
    '  filebrowser:',
    '    image: filebrowser/filebrowser:v2.59.0-s6',
    '  drydock:',
    '    image: codeswhat/drydock:1.0.0',
    '',
  ].join('\n'),
) {
  const getComposeFileSpy = vi
    .spyOn(triggerInstance, 'getComposeFile')
    .mockResolvedValue(Buffer.from(composeFileContent));
  const writeComposeFileSpy = vi.spyOn(triggerInstance, 'writeComposeFile').mockResolvedValue();
  const composeUpdateSpy = vi
    .spyOn(triggerInstance, 'updateContainerWithCompose')
    .mockResolvedValue();
  const hooksSpy = vi.spyOn(triggerInstance, 'runServicePostStartHooks').mockResolvedValue();
  const backupSpy = vi.spyOn(triggerInstance, 'backup').mockResolvedValue();
  // Lifecycle methods inherited from Docker trigger
  const maybeScanSpy = vi.spyOn(triggerInstance, 'maybeScanAndGateUpdate').mockResolvedValue();
  const preHookSpy = vi.spyOn(triggerInstance, 'runPreUpdateHook').mockResolvedValue();
  const postHookSpy = vi.spyOn(triggerInstance, 'runPostUpdateHook').mockResolvedValue();
  const pruneImagesSpy = vi.spyOn(triggerInstance, 'pruneImages').mockResolvedValue();
  const cleanupOldImagesSpy = vi.spyOn(triggerInstance, 'cleanupOldImages').mockResolvedValue();
  const rollbackMonitorSpy = vi
    .spyOn(triggerInstance, 'maybeStartAutoRollbackMonitor')
    .mockResolvedValue();
  return {
    getComposeFileSpy,
    writeComposeFileSpy,
    composeUpdateSpy,
    hooksSpy,
    backupSpy,
    maybeScanSpy,
    preHookSpy,
    postHookSpy,
    pruneImagesSpy,
    cleanupOldImagesSpy,
    rollbackMonitorSpy,
  };
}

describe('Dockercompose Trigger', () => {
  let trigger;
  let mockLog;
  let mockDockerApi;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(watch).mockReset();

    mockLog = {
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };

    trigger = new Dockercompose();
    trigger.log = mockLog;
    trigger.resetHostToContainerBindMountCache();
    trigger.configuration = {
      dryrun: true,
      backup: false,
      composeFileLabel: 'dd.compose.file',
    };

    mockDockerApi = {
      modem: {
        socketPath: '/var/run/docker.sock',
        followProgress: vi.fn((_stream, onDone, onProgress) => {
          onProgress?.({
            status: 'Pulling fs layer',
            id: 'layer-1',
            progressDetail: { current: 1, total: 1 },
          });
          onDone?.(null, [{ status: 'Pull complete', id: 'layer-1' }]);
        }),
      },
      pull: vi.fn().mockResolvedValue({}),
      createContainer: vi.fn().mockResolvedValue({
        start: vi.fn().mockResolvedValue(undefined),
        inspect: vi.fn().mockResolvedValue({ State: { Running: true } }),
      }),
      getContainer: vi.fn().mockReturnValue(makeDockerContainerHandle()),
      getNetwork: vi.fn().mockReturnValue({
        connect: vi.fn().mockResolvedValue(undefined),
      }),
    };

    // getId is called by insertBackup to record which trigger performed the update
    trigger.getId = vi.fn().mockReturnValue('dockercompose.test');

    getState.mockReturnValue({
      registry: {
        hub: {
          getImageFullName: (image, tag) => `${image.name}:${tag}`,
          getAuthPull: vi.fn().mockResolvedValue({}),
        },
      },
      watcher: {
        'docker.local': {
          dockerApi: mockDockerApi,
        },
      },
    });
  });

  // -----------------------------------------------------------------------
  // mapCurrentVersionToUpdateVersion
  // -----------------------------------------------------------------------

  test('mapCurrentVersionToUpdateVersion should ignore services without image', () => {
    const compose = makeCompose({
      dd: { environment: ['DD_TRIGGER_DOCKERCOMPOSE_BASE_AUTO=false'] },
      portainer: { image: 'portainer/portainer-ce:2.27.4' },
    });
    const container = makeContainer({
      name: 'portainer',
      imageName: 'portainer/portainer-ce',
      tagValue: '2.27.4',
      remoteValue: '2.27.5',
    });

    const result = trigger.mapCurrentVersionToUpdateVersion(compose, container);

    expect(result).toEqual({
      service: 'portainer',
      current: 'portainer/portainer-ce:2.27.4',
      update: 'portainer/portainer-ce:2.27.5',
      currentNormalized: 'portainer/portainer-ce:2.27.4',
      updateNormalized: 'portainer/portainer-ce:2.27.5',
    });
  });

  test('mapCurrentVersionToUpdateVersion should prefer compose service label', () => {
    const compose = makeCompose({
      alpha: { image: 'nginx:1.0.0' },
      beta: { image: 'nginx:1.0.0' },
    });
    const container = makeContainer({
      labels: { 'com.docker.compose.service': 'beta' },
    });

    const result = trigger.mapCurrentVersionToUpdateVersion(compose, container);

    expect(result?.service).toBe('beta');
  });

  test('mapCurrentVersionToUpdateVersion should not fall back to image matching when compose service label is unknown', () => {
    const compose = makeCompose({
      nginx: { image: 'nginx:1.0.0' },
    });
    const container = makeContainer({
      labels: {
        'com.docker.compose.project': 'other-stack',
        'com.docker.compose.service': 'unknown-service',
      },
    });

    const result = trigger.mapCurrentVersionToUpdateVersion(compose, container);

    expect(result).toBeUndefined();
    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('Could not find service'));
  });

  test('mapCurrentVersionToUpdateVersion should not fall back to image matching when compose identity labels exist without a service label', () => {
    const compose = makeCompose({
      nginx: { image: 'nginx:1.0.0' },
    });
    const container = makeContainer({
      labels: {
        'com.docker.compose.project': 'other-stack',
      },
    });

    const result = trigger.mapCurrentVersionToUpdateVersion(compose, container);

    expect(result).toBeUndefined();
    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('Could not find service'));
  });

  test('mapCurrentVersionToUpdateVersion should return undefined when service not found', () => {
    const compose = makeCompose({ redis: { image: 'redis:7.0.0' } });
    const container = makeContainer();

    const result = trigger.mapCurrentVersionToUpdateVersion(compose, container);

    expect(result).toBeUndefined();
    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('Could not find service'));
  });

  test('mapCurrentVersionToUpdateVersion should return undefined when service has no image', () => {
    const compose = makeCompose({ nginx: { build: './nginx' } });
    const container = makeContainer({
      labels: { 'com.docker.compose.service': 'nginx' },
    });

    const result = trigger.mapCurrentVersionToUpdateVersion(compose, container);

    expect(result).toBeUndefined();
    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('image is missing'));
  });

  // -----------------------------------------------------------------------
  // processComposeFile
  // -----------------------------------------------------------------------

  test('processComposeFile should not fail when compose has partial services', async () => {
    const container = makeContainer({
      name: 'portainer',
      imageName: 'portainer/portainer-ce',
      tagValue: '2.27.4',
      remoteValue: '2.27.5',
    });

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({
        dd: { environment: ['DD_TRIGGER_DOCKERCOMPOSE_BASE_AUTO=false'] },
        portainer: { image: 'portainer/portainer-ce:2.27.4' },
      }),
    );

    const composeUpdateSpy = vi.spyOn(trigger, 'updateContainerWithCompose').mockResolvedValue();

    await trigger.processComposeFile('/opt/drydock/test/portainer.yml', [container]);

    expect(composeUpdateSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/portainer.yml',
      'portainer',
      container,
      expect.objectContaining({
        runtimeContext: expect.objectContaining({
          dockerApi: mockDockerApi,
        }),
      }),
    );
  });

  test('processComposeFile should trigger both tag and digest updates', async () => {
    const tagContainer = makeContainer({ name: 'nginx' });
    const digestContainer = makeContainer({
      name: 'redis',
      imageName: 'redis',
      tagValue: '7.0.0',
      updateKind: 'digest',
      remoteValue: 'sha256:deadbeef',
    });

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({
        nginx: { image: 'nginx:1.0.0' },
        redis: { image: 'redis:7.0.0' },
      }),
    );

    const composeUpdateSpy = vi.spyOn(trigger, 'updateContainerWithCompose').mockResolvedValue();

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [
      tagContainer,
      digestContainer,
    ]);

    expect(composeUpdateSpy).toHaveBeenCalledTimes(2);
    expect(composeUpdateSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/stack.yml',
      'nginx',
      tagContainer,
      expect.objectContaining({
        runtimeContext: expect.objectContaining({
          dockerApi: mockDockerApi,
        }),
      }),
    );
    expect(composeUpdateSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/stack.yml',
      'redis',
      digestContainer,
      expect.objectContaining({
        runtimeContext: expect.objectContaining({
          dockerApi: mockDockerApi,
        }),
      }),
    );
  });

  test('processComposeFile should trigger digest-only updates even in dryrun mode', async () => {
    const container = makeContainer({
      name: 'redis',
      imageName: 'redis',
      tagValue: '7.0.0',
      updateKind: 'digest',
      remoteValue: 'sha256:deadbeef',
    });

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ redis: { image: 'redis:7.0.0' } }),
    );

    const { getComposeFileSpy, writeComposeFileSpy, composeUpdateSpy } =
      spyOnProcessComposeHelpers(trigger);

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);

    expect(getComposeFileSpy).not.toHaveBeenCalled();
    expect(writeComposeFileSpy).not.toHaveBeenCalled();
    expect(composeUpdateSpy).toHaveBeenCalledTimes(1);
    expect(composeUpdateSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/stack.yml',
      'redis',
      container,
      expect.objectContaining({
        runtimeContext: expect.objectContaining({
          dockerApi: mockDockerApi,
        }),
      }),
    );
  });

  test('processComposeFile should skip compose writes but still trigger digest-only updates', async () => {
    trigger.configuration.dryrun = false;
    const container = makeContainer({
      name: 'redis',
      imageName: 'redis',
      tagValue: '7.0.0',
      updateKind: 'digest',
      remoteValue: 'sha256:deadbeef',
    });

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ redis: { image: 'redis:7.0.0' } }),
    );

    const { getComposeFileSpy, writeComposeFileSpy, composeUpdateSpy } =
      spyOnProcessComposeHelpers(trigger);

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);

    expect(getComposeFileSpy).not.toHaveBeenCalled();
    expect(writeComposeFileSpy).not.toHaveBeenCalled();
    expect(composeUpdateSpy).toHaveBeenCalledTimes(1);
    expect(composeUpdateSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/stack.yml',
      'redis',
      container,
      expect.objectContaining({
        runtimeContext: expect.objectContaining({
          dockerApi: mockDockerApi,
        }),
      }),
    );
  });

  test('processComposeFile should trigger digest update when compose image uses implicit latest', async () => {
    trigger.configuration.dryrun = false;
    const container = makeContainer({
      tagValue: 'latest',
      updateKind: 'digest',
      remoteValue: 'sha256:deadbeef',
    });

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx' } }),
    );

    const { getComposeFileSpy, writeComposeFileSpy, composeUpdateSpy } =
      spyOnProcessComposeHelpers(trigger);

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);

    expect(getComposeFileSpy).not.toHaveBeenCalled();
    expect(writeComposeFileSpy).not.toHaveBeenCalled();
    expect(composeUpdateSpy).toHaveBeenCalledTimes(1);
    expect(composeUpdateSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/stack.yml',
      'nginx',
      container,
      expect.objectContaining({
        runtimeContext: expect.objectContaining({
          dockerApi: mockDockerApi,
        }),
      }),
    );
  });

  test('processComposeFile should write digest-pinned image when digest pinning is enabled', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.backup = false;
    trigger.configuration.digestPinning = true;

    const container = makeContainer({
      tagValue: '1.0.0',
      remoteValue: '1.1.0',
      result: { digest: 'sha256:deadbeef' },
    });

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
    );

    const { writeComposeFileSpy } = spyOnProcessComposeHelpers(trigger);

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);

    expect(writeComposeFileSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/stack.yml',
      expect.stringContaining('image: nginx@sha256:deadbeef'),
    );
    expect(writeComposeFileSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/stack.yml',
      expect.not.stringContaining('image: nginx:1.1.0'),
    );
  });

  test('processComposeFile should trigger runtime update when update kind is unknown but update is available', async () => {
    trigger.configuration.dryrun = false;
    const container = makeContainer({
      name: 'filebrowser',
      imageName: 'filebrowser/filebrowser',
      tagValue: 'v2.59.0-s6',
      updateKind: 'unknown',
      remoteValue: null,
      updateAvailable: true,
    });

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ filebrowser: { image: 'filebrowser/filebrowser:v2.59.0-s6' } }),
    );

    const { getComposeFileSpy, writeComposeFileSpy, composeUpdateSpy } =
      spyOnProcessComposeHelpers(trigger);

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);

    expect(getComposeFileSpy).not.toHaveBeenCalled();
    expect(writeComposeFileSpy).not.toHaveBeenCalled();
    expect(composeUpdateSpy).toHaveBeenCalledTimes(1);
    expect(composeUpdateSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/stack.yml',
      'filebrowser',
      container,
      expect.objectContaining({
        runtimeContext: expect.objectContaining({
          dockerApi: mockDockerApi,
        }),
      }),
    );
  });

  test('processComposeFile should report when all mapped containers are already up to date', async () => {
    trigger.configuration.dryrun = false;
    const container = makeContainer({
      tagValue: '1.0.0',
      remoteValue: '1.0.0',
      updateAvailable: false,
    });

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
    );

    const { writeComposeFileSpy, composeUpdateSpy } = spyOnProcessComposeHelpers(trigger);

    const updated = await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);

    expect(updated).toBe(false);
    expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('already up to date'));
    expect(writeComposeFileSpy).not.toHaveBeenCalled();
    expect(composeUpdateSpy).not.toHaveBeenCalled();
  });

  test('processComposeFile should warn when no containers belong to compose', async () => {
    const container = makeContainer({
      name: 'unknown',
      imageName: 'unknown-image',
    });

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
    );

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);

    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('No containers found'));
    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('not found in compose file'));
  });

  test('processComposeFile should warn and continue on compose/runtime reconciliation mismatch by default', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.backup = false;

    const container = makeContainer({
      tagValue: '1.0.0',
      remoteValue: '1.1.0',
      labels: { 'com.docker.compose.service': 'nginx' },
    });

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:2.0.0' } }),
    );

    const { composeUpdateSpy } = spyOnProcessComposeHelpers(trigger);

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);

    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.stringContaining('Compose reconciliation mismatch'),
    );
    expect(composeUpdateSpy).toHaveBeenCalledTimes(1);
  });

  test('processComposeFile should block updates on compose/runtime reconciliation mismatch when configured', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.backup = false;
    trigger.configuration.reconciliationMode = 'block';

    const container = makeContainer({
      tagValue: '1.0.0',
      remoteValue: '1.1.0',
      labels: { 'com.docker.compose.service': 'nginx' },
    });

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:2.0.0' } }),
    );

    const { writeComposeFileSpy, composeUpdateSpy } = spyOnProcessComposeHelpers(trigger);

    await expect(
      trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]),
    ).rejects.toThrow('Compose reconciliation mismatch');

    expect(writeComposeFileSpy).not.toHaveBeenCalled();
    expect(composeUpdateSpy).not.toHaveBeenCalled();
  });

  test('processComposeFile should backup and write when not in dryrun mode', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.backup = true;

    const container = makeContainer();

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
    );

    const { backupSpy, writeComposeFileSpy } = spyOnProcessComposeHelpers(trigger);

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);

    expect(backupSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/stack.yml',
      '/opt/drydock/test/stack.yml.back',
    );
    expect(writeComposeFileSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/stack.yml',
      expect.stringContaining('image: nginx:1.1.0'),
    );
    expect(writeComposeFileSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/stack.yml',
      expect.not.stringContaining('image: nginx:1.0.0'),
    );
  });

  test('processComposeFile should only patch target image field and keep other matching strings unchanged', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.backup = false;

    const container = makeContainer();

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
    );

    const composeWithOtherImageStrings = [
      'services:',
      '  nginx:',
      '    image: nginx:1.0.0',
      '    environment:',
      '      - MIRROR_IMAGE=nginx:1.0.0',
      '',
    ].join('\n');
    const { writeComposeFileSpy } = spyOnProcessComposeHelpers(
      trigger,
      composeWithOtherImageStrings,
    );

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);

    const [, updatedCompose] = writeComposeFileSpy.mock.calls[0];
    expect(updatedCompose).toContain('    image: nginx:1.1.0');
    expect(updatedCompose).toContain('MIRROR_IMAGE=nginx:1.0.0');
  });

  test('processComposeFile should not rewrite matching image strings in comments or env vars', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.backup = false;

    const container = makeContainer();

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
    );

    const composeWithCommentsAndEnv = [
      'services:',
      '  nginx:',
      '    image: nginx:1.0.0',
      '    # do not touch: nginx:1.0.0',
      '    environment:',
      '      - MIRROR_IMAGE=nginx:1.0.0',
      '      - COMMENT_IMAGE=nginx:1.0.0 # note',
      '',
    ].join('\n');
    const { writeComposeFileSpy } = spyOnProcessComposeHelpers(trigger, composeWithCommentsAndEnv);

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);

    const [, updatedCompose] = writeComposeFileSpy.mock.calls[0];
    expect(updatedCompose).toContain('    image: nginx:1.1.0');
    expect(updatedCompose).toContain('# do not touch: nginx:1.0.0');
    expect(updatedCompose).toContain('MIRROR_IMAGE=nginx:1.0.0');
    expect(updatedCompose).toContain('COMMENT_IMAGE=nginx:1.0.0 # note');
  });

  test('processComposeFile should preserve commented-out fields in compose file', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.backup = false;

    const container = makeContainer();

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
    );

    const composeWithComments = [
      '# My production stack',
      'services:',
      '  nginx:',
      '    image: nginx:1.0.0',
      '    # ports:',
      '    #   - "8080:80"',
      '    # volumes:',
      '    #   - ./html:/usr/share/nginx/html',
      '    environment:',
      '      - NGINX_PORT=80',
      '  redis:',
      '    image: redis:7.0.0',
      '',
    ].join('\n');
    const { writeComposeFileSpy } = spyOnProcessComposeHelpers(trigger, composeWithComments);

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);

    const [, updatedCompose] = writeComposeFileSpy.mock.calls[0];
    expect(updatedCompose).toContain('# My production stack');
    expect(updatedCompose).toContain('    image: nginx:1.1.0');
    expect(updatedCompose).toContain('    # ports:');
    expect(updatedCompose).toContain('    #   - "8080:80"');
    expect(updatedCompose).toContain('    # volumes:');
    expect(updatedCompose).toContain('    #   - ./html:/usr/share/nginx/html');
    expect(updatedCompose).toContain('    environment:');
    expect(updatedCompose).toContain('    image: redis:7.0.0');
  });

  test('processComposeFile should fail when the same service resolves to conflicting image updates', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.backup = false;

    const containerA = makeContainer({
      name: 'nginx-a',
      remoteValue: '1.1.0',
      labels: { 'com.docker.compose.service': 'nginx' },
    });
    const containerB = makeContainer({
      name: 'nginx-b',
      remoteValue: '1.2.0',
      labels: { 'com.docker.compose.service': 'nginx' },
    });

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
    );

    const { writeComposeFileSpy, composeUpdateSpy } = spyOnProcessComposeHelpers(trigger);

    await expect(
      trigger.processComposeFile('/opt/drydock/test/stack.yml', [containerA, containerB]),
    ).rejects.toThrow('Conflicting compose image updates for service nginx');

    expect(writeComposeFileSpy).not.toHaveBeenCalled();
    expect(composeUpdateSpy).not.toHaveBeenCalled();
  });

  test('processComposeFile should return original compose text when computed service updates map is empty', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.backup = false;

    const container = makeContainer();
    const composeFileText = ['services:', '  nginx:', '    image: nginx:1.0.0', ''].join('\n');

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
    );
    vi.spyOn(trigger, 'buildComposeServiceImageUpdates').mockReturnValue(new Map());
    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(Buffer.from(composeFileText));
    const writeComposeFileSpy = vi.spyOn(trigger, 'writeComposeFile').mockResolvedValue();
    const runLifecycleSpy = vi
      .spyOn(trigger, 'runContainerUpdateLifecycle')
      .mockResolvedValue(undefined);

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);

    expect(writeComposeFileSpy).not.toHaveBeenCalled();
    expect(runLifecycleSpy).toHaveBeenCalledTimes(1);
  });

  test('processComposeFile should parse compose text when cached compose document is unavailable', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.backup = false;

    const container = makeContainer();
    const composeFileText = ['services:', '  nginx:', '    image: nginx:1.0.0', ''].join('\n');

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
    );
    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(Buffer.from(composeFileText));
    vi.spyOn(trigger, 'getCachedComposeDocument').mockReturnValue(null);
    const writeComposeFileSpy = vi.spyOn(trigger, 'writeComposeFile').mockResolvedValue();
    const runLifecycleSpy = vi
      .spyOn(trigger, 'runContainerUpdateLifecycle')
      .mockResolvedValue(undefined);

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);

    expect(writeComposeFileSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/stack.yml',
      expect.stringContaining('image: nginx:1.1.0'),
    );
    expect(runLifecycleSpy).toHaveBeenCalledTimes(1);
  });

  test('processComposeFile should fail when computed compose edits overlap', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.backup = false;

    const nginxContainer = makeContainer();
    const redisContainer = makeContainer({
      name: 'redis',
      imageName: 'redis',
      tagValue: '7.0.0',
      remoteValue: '7.1.0',
    });
    const composeFileText = [
      'services:',
      '  nginx:',
      '    image: nginx:1.0.0',
      '  redis:',
      '    image: redis:7.0.0',
      '',
    ].join('\n');

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({
        nginx: { image: 'nginx:1.0.0' },
        redis: { image: 'redis:7.0.0' },
      }),
    );
    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(Buffer.from(composeFileText));

    const overlappingDoc = yaml.parseDocument(composeFileText, {
      keepSourceTokens: true,
      maxAliasCount: 10_000,
    });
    const servicesNode: any = overlappingDoc.get('services', true);
    const findImageValueNode = (serviceName: string) => {
      const servicePair = servicesNode.items.find((pair: any) => pair.key?.value === serviceName);
      return servicePair.value.items.find((pair: any) => pair.key?.value === 'image').value;
    };
    const nginxImageValueNode: any = findImageValueNode('nginx');
    const redisImageValueNode: any = findImageValueNode('redis');

    // Force equal start offsets with different end offsets to create deterministic overlap.
    nginxImageValueNode.range[0] = redisImageValueNode.range[0];
    nginxImageValueNode.range[1] = redisImageValueNode.range[0] + 1;

    vi.spyOn(trigger, 'getCachedComposeDocument').mockReturnValue(overlappingDoc);
    const writeComposeFileSpy = vi.spyOn(trigger, 'writeComposeFile').mockResolvedValue();
    const runLifecycleSpy = vi
      .spyOn(trigger, 'runContainerUpdateLifecycle')
      .mockResolvedValue(undefined);

    await expect(
      trigger.processComposeFile('/opt/drydock/test/stack.yml', [nginxContainer, redisContainer]),
    ).rejects.toThrow('Unable to apply overlapping compose edits');

    expect(writeComposeFileSpy).not.toHaveBeenCalled();
    expect(runLifecycleSpy).not.toHaveBeenCalled();
  });

  test('processComposeFile should not backup when backup is false', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.backup = false;

    const container = makeContainer();

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
    );

    const { backupSpy } = spyOnProcessComposeHelpers(trigger);

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);

    expect(backupSpy).not.toHaveBeenCalled();
  });

  test('processComposeFile should run post-start hooks for updated services', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.backup = false;

    const container = makeContainer();
    const serviceDefinition = {
      image: 'nginx:1.0.0',
      post_start: ['echo done'],
    };

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: serviceDefinition }),
    );

    const { hooksSpy } = spyOnProcessComposeHelpers(trigger);

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);

    expect(hooksSpy).toHaveBeenCalledWith(container, 'nginx', serviceDefinition);
  });

  test('processComposeFile should pass compose context through update lifecycle', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.backup = false;

    const container = makeContainer();

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
    );
    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(
      Buffer.from(['services:', '  nginx:', '    image: nginx:1.0.0', ''].join('\n')),
    );
    vi.spyOn(trigger, 'writeComposeFile').mockResolvedValue();
    const runLifecycleSpy = vi
      .spyOn(trigger, 'runContainerUpdateLifecycle')
      .mockResolvedValue(undefined);

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);

    expect(runLifecycleSpy).toHaveBeenCalledWith(
      container,
      expect.objectContaining({
        composeFile: '/opt/drydock/test/stack.yml',
        service: 'nginx',
        serviceDefinition: expect.objectContaining({ image: 'nginx:1.0.0' }),
      }),
    );
  });

  test('processComposeFile should filter out containers where mapCurrentVersionToUpdateVersion returns undefined', async () => {
    trigger.configuration.dryrun = false;

    const container1 = makeContainer();
    const container2 = makeContainer({
      name: 'unknown-container',
      imageName: 'unknown',
    });

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
    );

    const { composeUpdateSpy } = spyOnProcessComposeHelpers(trigger);

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container1, container2]);

    expect(composeUpdateSpy).toHaveBeenCalledTimes(1);
    expect(composeUpdateSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/stack.yml',
      'nginx',
      container1,
      expect.objectContaining({
        runtimeContext: expect.objectContaining({
          dockerApi: mockDockerApi,
        }),
      }),
    );
  });

  test('processComposeFile should ignore containers with unknown compose service labels even when image matches', async () => {
    trigger.configuration.dryrun = false;

    const containerInProject = makeContainer({
      name: 'nginx-main',
      labels: {
        'com.docker.compose.project': 'main-stack',
        'com.docker.compose.service': 'nginx',
      },
    });
    const containerFromOtherProject = makeContainer({
      name: 'nginx-other',
      labels: {
        'com.docker.compose.project': 'other-stack',
        'com.docker.compose.service': 'unknown-service',
      },
    });

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
    );

    const { composeUpdateSpy } = spyOnProcessComposeHelpers(trigger);

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [
      containerInProject,
      containerFromOtherProject,
    ]);

    expect(composeUpdateSpy).toHaveBeenCalledTimes(1);
    expect(composeUpdateSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/stack.yml',
      'nginx',
      containerInProject,
      expect.objectContaining({
        runtimeContext: expect.objectContaining({
          dockerApi: mockDockerApi,
        }),
      }),
    );
  });

  test('processComposeFile should handle digest images with @ in compose file', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.backup = false;

    const container = makeContainer({ tagValue: 'latest' });

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx@sha256:abc123' } }),
    );

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);

    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('No containers found'));
  });

  test('processComposeFile should handle null image in mapCurrentVersionToUpdateVersion', async () => {
    trigger.configuration.dryrun = false;

    const container = makeContainer({
      labels: { 'com.docker.compose.service': 'nginx' },
    });

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { build: './nginx' } }),
    );

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);

    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('image is missing'));
  });

  test('processComposeFile should treat image with digest reference as up to date', async () => {
    trigger.configuration.dryrun = false;
    const container = makeContainer({
      tagValue: 'latest',
      updateKind: 'digest',
      remoteValue: 'sha256:deadbeef',
    });

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx@sha256:abc123' } }),
    );

    const composeUpdateSpy = vi.spyOn(trigger, 'updateContainerWithCompose').mockResolvedValue();

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);

    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('No containers found'));
    expect(composeUpdateSpy).not.toHaveBeenCalled();
  });

  test('processComposeFile should not trigger container updates when compose file write fails', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.backup = false;

    const container = makeContainer();

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
    );

    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(
      Buffer.from(['services:', '  nginx:', '    image: nginx:1.0.0', ''].join('\n')),
    );
    vi.spyOn(trigger, 'writeComposeFile').mockRejectedValue(new Error('disk full'));
    const composeUpdateSpy = vi.spyOn(trigger, 'updateContainerWithCompose').mockResolvedValue();
    const hooksSpy = vi.spyOn(trigger, 'runServicePostStartHooks').mockResolvedValue();

    await expect(
      trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]),
    ).rejects.toThrow('disk full');

    expect(composeUpdateSpy).not.toHaveBeenCalled();
    expect(hooksSpy).not.toHaveBeenCalled();
  });

  test('processComposeFile should handle mapCurrentVersionToUpdateVersion returning undefined', async () => {
    trigger.configuration.dryrun = false;

    const container1 = makeContainer({
      labels: { 'com.docker.compose.service': 'nginx' },
    });
    const container2 = makeContainer({
      name: 'redis',
      imageName: 'redis',
      tagValue: '7.0.0',
      remoteValue: '7.1.0',
      labels: { 'com.docker.compose.service': 'redis' },
    });

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({
        nginx: { image: 'nginx:1.0.0' },
        redis: { build: './redis' },
      }),
    );

    const { composeUpdateSpy } = spyOnProcessComposeHelpers(trigger);

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container1, container2]);

    expect(composeUpdateSpy).toHaveBeenCalledTimes(1);
    expect(composeUpdateSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/stack.yml',
      'nginx',
      container1,
      expect.objectContaining({
        runtimeContext: expect.objectContaining({
          dockerApi: mockDockerApi,
        }),
      }),
    );
  });

  // -----------------------------------------------------------------------
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
  // File operations & misc
  // -----------------------------------------------------------------------

  test('backup should log warning on error', async () => {
    fs.copyFile.mockRejectedValueOnce(new Error('copy failed'));

    await trigger.backup('/opt/drydock/test/compose.yml', '/opt/drydock/test/compose.yml.back');

    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('copy failed'));
  });

  test('writeComposeFile should log error and throw on write failure', async () => {
    fs.writeFile.mockRejectedValueOnce(new Error('write failed'));

    await expect(trigger.writeComposeFile('/opt/drydock/test/compose.yml', 'data')).rejects.toThrow(
      'write failed',
    );

    expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining('write failed'));
  });

  test('writeComposeFile should write atomically through temp file + rename under lock', async () => {
    await trigger.writeComposeFile('/opt/drydock/test/compose.yml', 'data');

    expect(fs.writeFile).toHaveBeenCalledWith(
      '/opt/drydock/test/compose.yml.drydock.lock',
      expect.any(String),
      { flag: 'wx' },
    );
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('/opt/drydock/test/.compose.yml.tmp-'),
      'data',
    );
    expect(fs.rename).toHaveBeenCalledWith(
      expect.stringContaining('/opt/drydock/test/.compose.yml.tmp-'),
      '/opt/drydock/test/compose.yml',
    );
    expect(fs.unlink).toHaveBeenCalledWith('/opt/drydock/test/compose.yml.drydock.lock');
  });

  test('writeComposeFileAtomic should remove temp file and rethrow when rename fails', async () => {
    const renameError = new Error('rename failed');
    fs.rename.mockRejectedValueOnce(renameError);

    await expect(
      trigger.writeComposeFileAtomic('/opt/drydock/test/compose.yml', 'data'),
    ).rejects.toThrow('rename failed');

    const temporaryFilePath = fs.writeFile.mock.calls[0][0];
    expect(temporaryFilePath).toEqual(
      expect.stringContaining('/opt/drydock/test/.compose.yml.tmp-'),
    );
    expect(fs.rename).toHaveBeenCalledWith(temporaryFilePath, '/opt/drydock/test/compose.yml');
    expect(fs.unlink).toHaveBeenCalledWith(temporaryFilePath);
  });

  test('writeComposeFileAtomic should retry on EBUSY and succeed', async () => {
    const ebusyError: any = new Error('EBUSY: resource busy or locked');
    ebusyError.code = 'EBUSY';
    fs.rename
      .mockRejectedValueOnce(ebusyError)
      .mockRejectedValueOnce(ebusyError)
      .mockResolvedValueOnce(undefined);

    await trigger.writeComposeFileAtomic('/opt/drydock/test/compose.yml', 'data');

    expect(fs.rename).toHaveBeenCalledTimes(3);
    expect(fs.unlink).not.toHaveBeenCalled();
  });

  test('writeComposeFileAtomic should fall back to direct write after EBUSY retries exhausted', async () => {
    const ebusyError: any = new Error('EBUSY: resource busy or locked');
    ebusyError.code = 'EBUSY';
    for (let i = 0; i < 6; i++) {
      fs.rename.mockRejectedValueOnce(ebusyError);
    }

    await trigger.writeComposeFileAtomic('/opt/drydock/test/compose.yml', 'data');

    // 1 initial attempt + 5 retries = 6 rename attempts
    expect(fs.rename).toHaveBeenCalledTimes(6);
    // Falls back to direct write to the target file
    expect(fs.writeFile).toHaveBeenCalledWith('/opt/drydock/test/compose.yml', 'data');
    // Temp file cleaned up
    const temporaryFilePath = fs.writeFile.mock.calls[0][0];
    expect(fs.unlink).toHaveBeenCalledWith(temporaryFilePath);
  });

  test('writeComposeFileAtomic should not retry on non-EBUSY errors', async () => {
    const permError: any = new Error('EACCES: permission denied');
    permError.code = 'EACCES';
    fs.rename.mockRejectedValueOnce(permError);

    await expect(
      trigger.writeComposeFileAtomic('/opt/drydock/test/compose.yml', 'data'),
    ).rejects.toThrow('EACCES');

    expect(fs.rename).toHaveBeenCalledTimes(1);
  });

  test('withComposeFileLock should wait and retry when lock exists but is not stale', async () => {
    const lockBusyError: any = new Error('lock exists');
    lockBusyError.code = 'EEXIST';
    fs.writeFile.mockRejectedValueOnce(lockBusyError).mockResolvedValueOnce(undefined);
    fs.stat.mockResolvedValueOnce({
      mtimeMs: Date.now(),
    });
    const waitForLockChangeSpy = vi
      .spyOn(trigger._composeFileLockManager, 'waitForComposeFileLockChange')
      .mockResolvedValueOnce(true);
    const operation = vi.fn().mockResolvedValue('ok');

    const result = await trigger.withComposeFileLock('/opt/drydock/test/compose.yml', operation);

    expect(result).toBe('ok');
    expect(operation).toHaveBeenCalledWith('/opt/drydock/test/compose.yml');
    expect(waitForLockChangeSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/compose.yml.drydock.lock',
      expect.any(Number),
    );
    expect(sleep).not.toHaveBeenCalled();
  });

  test('withComposeFileLock should time out while waiting for a busy lock', async () => {
    const lockBusyError: any = new Error('lock exists');
    lockBusyError.code = 'EEXIST';
    fs.writeFile.mockRejectedValueOnce(lockBusyError);
    fs.stat.mockResolvedValueOnce({
      mtimeMs: 0,
    });
    const dateNowSpy = vi
      .spyOn(Date, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(10_001);

    try {
      await expect(
        trigger.withComposeFileLock('/opt/drydock/test/compose.yml', async () => 'never'),
      ).rejects.toThrow('Timed out waiting for compose file lock');
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  test('withComposeFileLock should warn when lock removal fails with a non-ENOENT error', async () => {
    const lockRemovalError: any = new Error('permission denied');
    lockRemovalError.code = 'EPERM';
    fs.unlink.mockRejectedValueOnce(lockRemovalError);

    await trigger.withComposeFileLock('/opt/drydock/test/compose.yml', async () => undefined);

    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.stringContaining('Could not remove compose file lock'),
    );
  });

  test('withComposeFileLock should ignore ENOENT when lock removal races', async () => {
    const lockRemovalError: any = new Error('gone');
    lockRemovalError.code = 'ENOENT';
    fs.unlink.mockRejectedValueOnce(lockRemovalError);

    await trigger.withComposeFileLock('/opt/drydock/test/compose.yml', async () => undefined);

    expect(
      mockLog.warn.mock.calls.some(([message]) =>
        String(message).includes('Could not remove compose file lock'),
      ),
    ).toBe(false);
  });

  test('withComposeFileLock should execute immediately when lock is already held by this process', async () => {
    const filePath = '/opt/drydock/test/compose.yml';
    trigger._composeFileLocksHeld.add(filePath);
    const operation = vi.fn().mockResolvedValue('ok');

    try {
      const result = await trigger.withComposeFileLock(filePath, operation);
      expect(result).toBe('ok');
      expect(operation).toHaveBeenCalledWith(filePath);
      expect(fs.writeFile).not.toHaveBeenCalledWith(
        `${filePath}.drydock.lock`,
        expect.any(String),
        { flag: 'wx' },
      );
    } finally {
      trigger._composeFileLocksHeld.delete(filePath);
    }
  });

  test('waitForComposeFileLockChange should return false when timeout is not positive', async () => {
    await expect(
      trigger.waitForComposeFileLockChange('/opt/drydock/test/compose.yml.drydock.lock', 0),
    ).resolves.toBe(false);
  });

  test('waitForComposeFileLockChange should return false when timeout elapses without lock changes', async () => {
    vi.useFakeTimers();
    const watcher: any = new EventEmitter();
    watcher.close = vi.fn();
    const watchMock = vi.mocked(watch);
    watchMock.mockImplementation(() => watcher);

    try {
      const waitForLockChange = trigger.waitForComposeFileLockChange(
        '/opt/drydock/test/compose.yml.drydock.lock',
        1_000,
      );

      await vi.advanceTimersByTimeAsync(1_000);

      await expect(waitForLockChange).resolves.toBe(false);
      expect(watcher.close).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test('waitForComposeFileLockChange should settle when changed path is unavailable', async () => {
    const watcher: any = new EventEmitter();
    watcher.close = vi.fn();
    const watchMock = vi.mocked(watch);
    watchMock.mockImplementation((_directoryPath, onChange: any) => {
      setImmediate(() => onChange('rename', null as any));
      return watcher;
    });

    await expect(
      trigger.waitForComposeFileLockChange('/opt/drydock/test/compose.yml.drydock.lock', 1_000),
    ).resolves.toBe(true);
    expect(watcher.close).toHaveBeenCalledTimes(1);
  });

  test('waitForComposeFileLockChange should settle when target lock file changes', async () => {
    const watcher: any = new EventEmitter();
    watcher.close = vi.fn();
    const watchMock = vi.mocked(watch);
    watchMock.mockImplementation((_directoryPath, onChange: any) => {
      setImmediate(() => onChange('change', Buffer.from('compose.yml.drydock.lock')));
      return watcher;
    });

    await expect(
      trigger.waitForComposeFileLockChange('/opt/drydock/test/compose.yml.drydock.lock', 1_000),
    ).resolves.toBe(true);
    expect(watcher.close).toHaveBeenCalledTimes(1);
  });

  test('waitForComposeFileLockChange should ignore duplicate settle attempts after it resolves', async () => {
    const watcher: any = new EventEmitter();
    watcher.close = vi.fn();
    const watchMock = vi.mocked(watch);
    watchMock.mockImplementation((_directoryPath, onChange: any) => {
      setImmediate(() => {
        onChange('rename', null as any);
        onChange('change', 'compose.yml.drydock.lock');
      });
      return watcher;
    });

    await expect(
      trigger.waitForComposeFileLockChange('/opt/drydock/test/compose.yml.drydock.lock', 1_000),
    ).resolves.toBe(true);
    expect(watcher.close).toHaveBeenCalledTimes(1);
  });

  test('waitForComposeFileLockChange should settle when watcher emits an error', async () => {
    const watcher: any = new EventEmitter();
    watcher.close = vi.fn();
    const watchMock = vi.mocked(watch);
    watchMock.mockImplementation(() => {
      setImmediate(() => watcher.emit('error', new Error('watch failed')));
      return watcher;
    });

    await expect(
      trigger.waitForComposeFileLockChange('/opt/drydock/test/compose.yml.drydock.lock', 1_000),
    ).resolves.toBe(true);
    expect(watcher.close).toHaveBeenCalledTimes(1);
  });

  test('maybeReleaseStaleComposeFileLock should treat missing lock file as released', async () => {
    const missingLockError: any = new Error('missing lock');
    missingLockError.code = 'ENOENT';
    fs.stat.mockRejectedValueOnce(missingLockError);

    await expect(
      trigger.maybeReleaseStaleComposeFileLock('/opt/drydock/test/compose.yml.drydock.lock'),
    ).resolves.toBe(true);
  });

  test('maybeReleaseStaleComposeFileLock should warn and return false on unexpected stat errors', async () => {
    const statError: any = new Error('permission denied');
    statError.code = 'EPERM';
    fs.stat.mockRejectedValueOnce(statError);

    await expect(
      trigger.maybeReleaseStaleComposeFileLock('/opt/drydock/test/compose.yml.drydock.lock'),
    ).resolves.toBe(false);

    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.stringContaining('Could not inspect compose file lock'),
    );
  });

  test('writeComposeFile should preserve rename error when temp cleanup also fails', async () => {
    const renameError = new Error('rename failed');
    fs.rename.mockRejectedValueOnce(renameError);
    fs.unlink.mockRejectedValueOnce(new Error('cleanup failed'));

    await expect(trigger.writeComposeFile('/opt/drydock/test/compose.yml', 'data')).rejects.toThrow(
      'rename failed',
    );
  });

  test('mutateComposeFile should return false when no text changes are applied', async () => {
    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(
      Buffer.from('services:\n  nginx:\n    image: nginx:1.0.0\n'),
    );
    const writeSpy = vi.spyOn(trigger, 'writeComposeFile').mockResolvedValue();

    const changed = await trigger.mutateComposeFile(
      '/opt/drydock/test/compose.yml',
      (text) => text,
    );

    expect(changed).toBe(false);
    expect(writeSpy).not.toHaveBeenCalled();
  });

  test('mutateComposeFile should validate candidate compose config before writing', async () => {
    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(
      Buffer.from('services:\n  nginx:\n    image: nginx:1.0.0\n'),
    );
    const validateSpy = vi
      .spyOn(trigger, 'validateComposeConfiguration')
      .mockResolvedValue(undefined);
    const writeSpy = vi.spyOn(trigger, 'writeComposeFile').mockResolvedValue();

    const changed = await trigger.mutateComposeFile('/opt/drydock/test/compose.yml', (text) =>
      text.replace('nginx:1.0.0', 'nginx:1.1.0'),
    );

    expect(changed).toBe(true);
    expect(validateSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/compose.yml',
      expect.stringContaining('nginx:1.1.0'),
    );
    expect(writeSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/compose.yml',
      expect.stringContaining('nginx:1.1.0'),
    );
  });

  test('mutateComposeFile should block writes when compose validation fails', async () => {
    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(
      Buffer.from('services:\n  nginx:\n    image: nginx:1.0.0\n'),
    );
    vi.spyOn(trigger, 'validateComposeConfiguration').mockRejectedValue(
      new Error('compose config is invalid'),
    );
    const writeSpy = vi.spyOn(trigger, 'writeComposeFile').mockResolvedValue();

    await expect(
      trigger.mutateComposeFile('/opt/drydock/test/compose.yml', (text) =>
        text.replace('nginx:1.0.0', 'nginx:1.1.0'),
      ),
    ).rejects.toThrow('compose config is invalid');

    expect(writeSpy).not.toHaveBeenCalled();
  });

  test('mutateComposeFile should forward a pre-parsed compose object to validation', async () => {
    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(
      Buffer.from('services:\n  nginx:\n    image: nginx:1.0.0\n'),
    );
    const validateSpy = vi
      .spyOn(trigger, 'validateComposeConfiguration')
      .mockResolvedValue(undefined);
    vi.spyOn(trigger, 'writeComposeFile').mockResolvedValue();
    const parsedComposeFileObject = makeCompose({ nginx: { image: 'nginx:1.1.0' } });

    const changed = await trigger.mutateComposeFile(
      '/opt/drydock/test/compose.yml',
      (text) => text.replace('nginx:1.0.0', 'nginx:1.1.0'),
      {
        parsedComposeFileObject,
      },
    );

    expect(changed).toBe(true);
    expect(validateSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/compose.yml',
      expect.stringContaining('nginx:1.1.0'),
      {
        parsedComposeFileObject,
      },
    );
  });

  test('validateComposeConfiguration should validate compose text in-process without shell commands', async () => {
    await trigger.validateComposeConfiguration(
      '/opt/drydock/test/compose.yml',
      'services:\n  nginx:\n    image: nginx:1.1.0\n',
    );
  });

  test('validateComposeConfiguration should validate updated file against full compose file chain', async () => {
    const getComposeFileAsObjectSpy = vi
      .spyOn(trigger, 'getComposeFileAsObject')
      .mockResolvedValue(makeCompose({ base: { image: 'busybox:1.0.0' } }));

    await trigger.validateComposeConfiguration(
      '/opt/drydock/test/stack.override.yml',
      'services:\n  nginx:\n    image: nginx:1.1.0\n',
      {
        composeFiles: ['/opt/drydock/test/stack.yml', '/opt/drydock/test/stack.override.yml'],
      },
    );

    expect(getComposeFileAsObjectSpy).toHaveBeenCalledWith('/opt/drydock/test/stack.yml');
  });

  test('validateComposeConfiguration should reuse a pre-parsed compose object when provided', async () => {
    const parseSpy = vi.spyOn(yaml, 'parse');
    const getComposeFileAsObjectSpy = vi
      .spyOn(trigger, 'getComposeFileAsObject')
      .mockResolvedValue(makeCompose({ base: { image: 'busybox:1.0.0' } }));

    await trigger.validateComposeConfiguration(
      '/opt/drydock/test/stack.override.yml',
      'services:\n  nginx:\n    image: nginx:1.1.0\n',
      {
        composeFiles: ['/opt/drydock/test/stack.yml', '/opt/drydock/test/stack.override.yml'],
        parsedComposeFileObject: makeCompose({ nginx: { image: 'nginx:1.1.0' } }),
      },
    );

    expect(parseSpy).not.toHaveBeenCalled();
    expect(getComposeFileAsObjectSpy).toHaveBeenCalledWith('/opt/drydock/test/stack.yml');
  });

  test('updateComposeServiceImageInText should throw when compose document has parse errors', () => {
    expect(() =>
      testable_updateComposeServiceImageInText('services:\n  nginx: [\n', 'nginx', 'nginx:2.0.0'),
    ).toThrow();
  });

  test('updateComposeServiceImageInText should throw when service definition is not a map', () => {
    expect(() =>
      testable_updateComposeServiceImageInText(
        ['services:', '  nginx: "literal-service"', ''].join('\n'),
        'nginx',
        'nginx:2.0.0',
      ),
    ).toThrow('Unable to patch compose service nginx because it is not a map');
  });

  test('updateComposeServiceImageInText should append image line when service key has no trailing newline', () => {
    const updated = testable_updateComposeServiceImageInText(
      'services:\n  nginx:',
      'nginx',
      'nginx:2.0.0',
    );

    expect(updated).toBe('services:\n  nginx:\n    image: nginx:2.0.0');
  });

  test('writeComposeFile should remove stale lock and continue', async () => {
    const lockBusyError: any = new Error('lock exists');
    lockBusyError.code = 'EEXIST';
    fs.writeFile
      .mockRejectedValueOnce(lockBusyError)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    fs.stat.mockResolvedValueOnce({
      mtimeMs: Date.now() - 200_000,
    });

    await trigger.writeComposeFile('/opt/drydock/test/compose.yml', 'data');

    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.stringContaining('Removed stale compose file lock'),
    );
    expect(fs.rename).toHaveBeenCalledWith(
      expect.stringContaining('/opt/drydock/test/.compose.yml.tmp-'),
      '/opt/drydock/test/compose.yml',
    );
  });

  test('getComposeFileAsObject should throw on yaml parse error', async () => {
    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(Buffer.from('invalid: yaml: [[['));

    await expect(trigger.getComposeFileAsObject('/opt/drydock/test/compose.yml')).rejects.toThrow();

    expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining('Error when parsing'));
  });

  test('getComposeFileAsObject should reuse cached parse when file mtime is unchanged', async () => {
    const composeFilePath = '/opt/drydock/test/compose.yml';
    const composeText = ['services:', '  nginx:', '    image: nginx:1.0.0', ''].join('\n');
    const getComposeFileSpy = vi
      .spyOn(trigger, 'getComposeFile')
      .mockResolvedValue(Buffer.from(composeText));
    const parseSpy = vi.spyOn(yaml, 'parse');
    fs.stat.mockResolvedValue({
      mtimeMs: 1700000000000,
    } as any);

    const first = await trigger.getComposeFileAsObject(composeFilePath);
    const second = await trigger.getComposeFileAsObject(composeFilePath);

    expect(first).toEqual(second);
    expect(getComposeFileSpy).toHaveBeenCalledTimes(1);
    expect(parseSpy).toHaveBeenCalledTimes(1);
  });

  test('getComposeFileAsObject should evict least recently used cache entries when max size is reached', async () => {
    const composeFilePathA = '/opt/drydock/test/a.yml';
    const composeFilePathB = '/opt/drydock/test/b.yml';
    const composeFilePathC = '/opt/drydock/test/c.yml';
    trigger._composeCacheMaxEntries = 2;
    expect(trigger._composeCacheMaxEntries).toBe(2);

    const getComposeFileSpy = vi
      .spyOn(trigger, 'getComposeFile')
      .mockImplementation(async (filePath) =>
        Buffer.from(
          ['services:', '  nginx:', `    image: ${path.basename(filePath, '.yml')}:1.0.0`, ''].join(
            '\n',
          ),
        ),
      );
    const parseSpy = vi.spyOn(yaml, 'parse');
    fs.stat.mockResolvedValue({
      mtimeMs: 1700000000000,
    } as any);

    await trigger.getComposeFileAsObject(composeFilePathA);
    await trigger.getComposeFileAsObject(composeFilePathB);
    await trigger.getComposeFileAsObject(composeFilePathA);
    await trigger.getComposeFileAsObject(composeFilePathC);

    expect(trigger._composeObjectCache.has(composeFilePathA)).toBe(true);
    expect(trigger._composeObjectCache.has(composeFilePathB)).toBe(false);
    expect(trigger._composeObjectCache.has(composeFilePathC)).toBe(true);

    await trigger.getComposeFileAsObject(composeFilePathB);

    expect(getComposeFileSpy).toHaveBeenCalledTimes(4);
    expect(parseSpy).toHaveBeenCalledTimes(4);
    expect(trigger._composeObjectCache.has(composeFilePathA)).toBe(false);
    expect(trigger._composeObjectCache.has(composeFilePathB)).toBe(true);
    expect(trigger._composeObjectCache.has(composeFilePathC)).toBe(true);
  });

  test('getCachedComposeDocument should reuse cached parse when file mtime is unchanged', () => {
    const composeFilePath = '/opt/drydock/test/compose.yml';
    const parseDocumentSpy = vi.spyOn(yaml, 'parseDocument');
    const firstText = ['services:', '  nginx:', '    image: nginx:1.0.0', ''].join('\n');
    const secondText = ['services:', '  nginx:', '    image: nginx:2.0.0', ''].join('\n');

    const firstDocument = trigger.getCachedComposeDocument(
      composeFilePath,
      1700000000000,
      firstText,
    );
    const secondDocument = trigger.getCachedComposeDocument(
      composeFilePath,
      1700000000000,
      secondText,
    );

    expect(secondDocument).toBe(firstDocument);
    expect(parseDocumentSpy).toHaveBeenCalledTimes(1);
  });

  test('getCachedComposeDocument should evict least recently used cache entries when max size is reached', () => {
    const composeFilePathA = '/opt/drydock/test/a.yml';
    const composeFilePathB = '/opt/drydock/test/b.yml';
    const composeFilePathC = '/opt/drydock/test/c.yml';
    trigger._composeCacheMaxEntries = 2;
    const parseDocumentSpy = vi.spyOn(yaml, 'parseDocument');

    const firstDocumentA = trigger.getCachedComposeDocument(
      composeFilePathA,
      1700000000000,
      ['services:', '  app-a:', '    image: app-a:1.0.0', ''].join('\n'),
    );
    const firstDocumentB = trigger.getCachedComposeDocument(
      composeFilePathB,
      1700000000000,
      ['services:', '  app-b:', '    image: app-b:1.0.0', ''].join('\n'),
    );
    const secondDocumentA = trigger.getCachedComposeDocument(
      composeFilePathA,
      1700000000000,
      ['services:', '  app-a:', '    image: app-a:2.0.0', ''].join('\n'),
    );
    trigger.getCachedComposeDocument(
      composeFilePathC,
      1700000000000,
      ['services:', '  app-c:', '    image: app-c:1.0.0', ''].join('\n'),
    );

    expect(secondDocumentA).toBe(firstDocumentA);
    expect(trigger._composeDocumentCache.has(composeFilePathA)).toBe(true);
    expect(trigger._composeDocumentCache.has(composeFilePathB)).toBe(false);
    expect(trigger._composeDocumentCache.has(composeFilePathC)).toBe(true);

    const secondDocumentB = trigger.getCachedComposeDocument(
      composeFilePathB,
      1700000000000,
      ['services:', '  app-b:', '    image: app-b:2.0.0', ''].join('\n'),
    );

    expect(secondDocumentB).not.toBe(firstDocumentB);
    expect(parseDocumentSpy).toHaveBeenCalledTimes(4);
    expect(trigger._composeDocumentCache.has(composeFilePathA)).toBe(false);
    expect(trigger._composeDocumentCache.has(composeFilePathB)).toBe(true);
    expect(trigger._composeDocumentCache.has(composeFilePathC)).toBe(true);
  });

  test('getComposeFileAsObject should refresh cached parse when file mtime changes', async () => {
    const composeFilePath = '/opt/drydock/test/compose.yml';
    const getComposeFileSpy = vi
      .spyOn(trigger, 'getComposeFile')
      .mockResolvedValueOnce(
        Buffer.from(['services:', '  nginx:', '    image: nginx:1.0.0', ''].join('\n')),
      )
      .mockResolvedValueOnce(
        Buffer.from(['services:', '  nginx:', '    image: nginx:1.1.0', ''].join('\n')),
      );
    const parseSpy = vi.spyOn(yaml, 'parse');
    fs.stat
      .mockResolvedValueOnce({
        mtimeMs: 1700000000000,
      } as any)
      .mockResolvedValueOnce({
        mtimeMs: 1700000001000,
      } as any);

    const first = await trigger.getComposeFileAsObject(composeFilePath);
    const second = await trigger.getComposeFileAsObject(composeFilePath);

    expect(first).not.toEqual(second);
    expect(getComposeFileSpy).toHaveBeenCalledTimes(2);
    expect(parseSpy).toHaveBeenCalledTimes(2);
  });

  test('getComposeFileAsObject should log default file path when called without explicit file argument', async () => {
    trigger.configuration.file = '/opt/drydock/test/default-compose.yml';
    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(Buffer.from('invalid: yaml: [[['));

    await expect(trigger.getComposeFileAsObject()).rejects.toThrow();

    expect(mockLog.error).toHaveBeenCalledWith(
      expect.stringContaining('/opt/drydock/test/default-compose.yml'),
    );
  });

  test('getComposeFile should use default configuration file when no argument', () => {
    trigger.configuration.file = '/opt/drydock/test/default-compose.yml';

    trigger.getComposeFile();

    expect(fs.readFile).toHaveBeenCalledWith('/opt/drydock/test/default-compose.yml');
  });

  test('getComposeFile should log error and throw when fs.readFile throws synchronously', () => {
    const readFileMock = fs.readFile;
    readFileMock.mockImplementationOnce(() => {
      throw new Error('sync read error');
    });
    trigger.configuration.file = '/opt/drydock/test/compose.yml';

    expect(() => trigger.getComposeFile('/opt/drydock/test/compose.yml')).toThrow(
      'sync read error',
    );
    expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining('sync read error'));
  });

  // -----------------------------------------------------------------------
  // triggerBatch
  // -----------------------------------------------------------------------

  test('triggerBatch should skip containers not on local host', async () => {
    const container = { name: 'remote-container', watcher: 'remote' };

    getState.mockReturnValue({
      registry: {
        hub: { getImageFullName: (image, tag) => `${image.name}:${tag}` },
      },
      watcher: {
        'docker.remote': {
          dockerApi: {
            modem: { socketPath: '' },
          },
        },
      },
    });

    await trigger.triggerBatch([container]);

    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('not running on local host'));
  });

  test('triggerBatch should skip containers with no compose file', async () => {
    trigger.configuration.file = undefined;
    const container = { name: 'no-compose', watcher: 'local' };

    await trigger.triggerBatch([container]);

    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('No compose file found'));
  });

  test('triggerBatch should skip containers when compose file does not exist', async () => {
    trigger.configuration.file = '/nonexistent/compose.yml';
    const err = new Error('ENOENT');
    err.code = 'ENOENT';
    fs.access.mockRejectedValueOnce(err);

    const container = { name: 'test-container', watcher: 'local' };

    await trigger.triggerBatch([container]);

    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('does not exist'));
  });

  test('triggerBatch should log permission denied when compose file has EACCES', async () => {
    trigger.configuration.file = '/restricted/compose.yml';
    const err = new Error('EACCES');
    err.code = 'EACCES';
    fs.access.mockRejectedValueOnce(err);

    const container = { name: 'test-container', watcher: 'local' };

    await trigger.triggerBatch([container]);

    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('permission denied'));
  });

  test('triggerBatch should warn when container compose file does not match configured file', async () => {
    trigger.configuration.file = '/opt/drydock/configured.yml';
    fs.access.mockResolvedValue(undefined);

    const container = {
      name: 'mismatched',
      watcher: 'local',
      labels: { 'dd.compose.file': '/opt/drydock/other.yml' },
    };

    await trigger.triggerBatch([container]);

    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.stringContaining('do not match configured file'),
    );
  });

  test('triggerBatch should warn when no containers matched any compose file', async () => {
    trigger.configuration.file = undefined;

    const container = { name: 'orphan', watcher: 'local' };

    await trigger.triggerBatch([container]);

    expect(mockLog.warn).toHaveBeenCalledWith(
      'No containers matched any compose file for this trigger',
    );
  });

  test('triggerBatch should group containers by compose file and process each', async () => {
    trigger.configuration.file = undefined;
    fs.access.mockResolvedValue(undefined);

    const container1 = {
      name: 'app1',
      watcher: 'local',
      labels: { 'dd.compose.file': '/opt/drydock/test/a.yml' },
    };
    const container2 = {
      name: 'app2',
      watcher: 'local',
      labels: { 'dd.compose.file': '/opt/drydock/test/b.yml' },
    };

    const processComposeFileSpy = vi.spyOn(trigger, 'processComposeFile').mockResolvedValue();

    await trigger.triggerBatch([container1, container2]);

    expect(processComposeFileSpy).toHaveBeenCalledTimes(2);
    expect(processComposeFileSpy).toHaveBeenCalledWith('/opt/drydock/test/a.yml', [container1]);
    expect(processComposeFileSpy).toHaveBeenCalledWith('/opt/drydock/test/b.yml', [container2]);
  });

  test('triggerBatch should group multiple containers under the same compose file', async () => {
    trigger.configuration.file = undefined;
    fs.access.mockResolvedValue(undefined);

    const container1 = {
      name: 'app1',
      watcher: 'local',
      labels: { 'dd.compose.file': '/opt/drydock/test/shared.yml' },
    };
    const container2 = {
      name: 'app2',
      watcher: 'local',
      labels: { 'dd.compose.file': '/opt/drydock/test/shared.yml' },
    };

    const processComposeFileSpy = vi.spyOn(trigger, 'processComposeFile').mockResolvedValue();

    await trigger.triggerBatch([container1, container2]);

    expect(processComposeFileSpy).toHaveBeenCalledTimes(1);
    expect(processComposeFileSpy).toHaveBeenCalledWith('/opt/drydock/test/shared.yml', [
      container1,
      container2,
    ]);
  });

  test('triggerBatch should only access each compose file once across containers sharing the same compose chain', async () => {
    trigger.configuration.file = undefined;
    fs.access.mockResolvedValue(undefined);

    const sharedComposeLabels = {
      'com.docker.compose.project.config_files':
        '/opt/drydock/test/stack.yml,/opt/drydock/test/stack.override.yml',
    };
    const container1 = {
      name: 'app1',
      watcher: 'local',
      labels: sharedComposeLabels,
    };
    const container2 = {
      name: 'app2',
      watcher: 'local',
      labels: sharedComposeLabels,
    };

    const processComposeFileSpy = vi.spyOn(trigger, 'processComposeFile').mockResolvedValue();

    await trigger.triggerBatch([container1, container2]);

    expect(processComposeFileSpy).toHaveBeenCalledTimes(1);
    expect(fs.access).toHaveBeenCalledTimes(2);
    expect(fs.access).toHaveBeenCalledWith('/opt/drydock/test/stack.yml');
    expect(fs.access).toHaveBeenCalledWith('/opt/drydock/test/stack.override.yml');
  });

  test('triggerBatch should only process containers matching configured compose file affinity', async () => {
    trigger.configuration.file = '/opt/drydock/test/monitoring.yml';
    fs.access.mockImplementation(async (composeFilePath) => {
      if (`${composeFilePath}`.includes('/opt/drydock/test/mysql.yml')) {
        const missingComposeError = new Error('ENOENT');
        missingComposeError.code = 'ENOENT';
        throw missingComposeError;
      }
      return undefined;
    });

    const monitoringContainer = {
      name: 'monitoring-app',
      watcher: 'local',
      labels: { 'dd.compose.file': '/opt/drydock/test/monitoring.yml' },
    };
    const mysqlContainer = {
      name: 'mysql-app',
      watcher: 'local',
      labels: { 'dd.compose.file': '/opt/drydock/test/mysql.yml' },
    };

    const processComposeFileSpy = vi.spyOn(trigger, 'processComposeFile').mockResolvedValue();

    await trigger.triggerBatch([monitoringContainer, mysqlContainer]);

    expect(processComposeFileSpy).toHaveBeenCalledTimes(1);
    expect(processComposeFileSpy).toHaveBeenCalledWith('/opt/drydock/test/monitoring.yml', [
      monitoringContainer,
    ]);
    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.stringContaining('do not match configured file'),
    );
  });

  test('triggerBatch should resolve a configured compose directory to compose.yaml for affinity matching', async () => {
    trigger.configuration.file = '/opt/drydock/stacks/filebrowser';
    fs.stat.mockImplementation(async (candidatePath: string) => {
      if (candidatePath === '/opt/drydock/stacks/filebrowser') {
        return {
          isDirectory: () => true,
          mtimeMs: 1_700_000_000_000,
        } as any;
      }
      return {
        isDirectory: () => false,
        mtimeMs: 1_700_000_000_000,
      } as any;
    });
    fs.access.mockResolvedValue(undefined);

    const container = {
      name: 'filebrowser',
      watcher: 'local',
      labels: { 'dd.compose.file': '/opt/drydock/stacks/filebrowser/compose.yaml' },
    };
    const processComposeFileSpy = vi.spyOn(trigger, 'processComposeFile').mockResolvedValue(true);

    await trigger.triggerBatch([container]);

    expect(processComposeFileSpy).toHaveBeenCalledTimes(1);
    expect(processComposeFileSpy).toHaveBeenCalledWith(
      '/opt/drydock/stacks/filebrowser/compose.yaml',
      [container],
    );
    expect(mockLog.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('do not match configured file'),
    );
  });

  // -----------------------------------------------------------------------
  // getComposeFileForContainer
  // -----------------------------------------------------------------------

  test('getComposeFileForContainer should use label from container', () => {
    const container = {
      labels: { 'dd.compose.file': '/opt/compose.yml' },
    };

    const result = trigger.getComposeFileForContainer(container);

    expect(result).toBe('/opt/compose.yml');
  });

  test('getComposeFileForContainer should use wud fallback label', () => {
    const container = {
      labels: { 'wud.compose.file': '/opt/wud-compose.yml' },
    };

    const result = trigger.getComposeFileForContainer(container);

    expect(result).toBe('/opt/wud-compose.yml');
  });

  test('getComposeFileForContainer should use the first compose config file from compose labels', () => {
    const container = {
      labels: {
        'com.docker.compose.project.config_files':
          '/opt/drydock/test/stack.yml,/opt/drydock/test/stack.override.yml',
      },
    };

    const result = trigger.getComposeFileForContainer(container);

    expect(result).toBe('/opt/drydock/test/stack.yml');
  });

  test('getComposeFileForContainer should resolve relative label paths', () => {
    const container = {
      labels: { 'dd.compose.file': 'relative/compose.yml' },
    };

    const result = trigger.getComposeFileForContainer(container);

    expect(result).toMatch(/\/.*relative\/compose\.yml$/);
    expect(result).not.toBe('relative/compose.yml');
  });

  test('getComposeFileForContainer should return null when no label and no default file', () => {
    trigger.configuration.file = undefined;
    const container = { labels: {} };

    const result = trigger.getComposeFileForContainer(container);

    expect(result).toBeNull();
  });

  test('getComposeFileForContainer should fall back to default config file', () => {
    trigger.configuration.file = '/default/compose.yml';
    const container = { labels: {} };

    const result = trigger.getComposeFileForContainer(container);

    expect(result).toBe('/default/compose.yml');
  });

  test('getComposeFileForContainer should return null and warn when label value is invalid', () => {
    const container = {
      name: 'broken',
      labels: { 'dd.compose.file': '\0bad' },
    };

    const result = trigger.getComposeFileForContainer(container);

    expect(result).toBeNull();
    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('is invalid'));
  });

  test('getComposeFileForContainer should return null and warn when default path is invalid', () => {
    trigger.configuration.file = '\0broken';
    const container = { labels: {} };

    const result = trigger.getComposeFileForContainer(container);

    expect(result).toBeNull();
    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.stringContaining('Default compose file path is invalid'),
    );
  });

  test('getComposeFilesForContainer should prefer legacy label over compose project labels', () => {
    const container = {
      name: 'with-both-labels',
      labels: {
        'dd.compose.file': '/opt/drydock/test/legacy.yml',
        'com.docker.compose.project.config_files':
          '/opt/drydock/test/stack.yml,/opt/drydock/test/stack.override.yml',
      },
    };

    const result = trigger.getComposeFilesForContainer(container);

    expect(result).toEqual(['/opt/drydock/test/legacy.yml']);
  });

  test('getWritableComposeFileForService should throw when compose file chain is empty', async () => {
    await expect(trigger.getWritableComposeFileForService([], 'nginx')).rejects.toThrow(
      'Cannot resolve writable compose file for service nginx because compose file chain is empty',
    );
    expect(fs.access).not.toHaveBeenCalled();
  });

  test('triggerBatch should fallback to inspect labels for compose config files when cached labels do not include them', async () => {
    fs.access.mockResolvedValue(undefined);
    mockDockerApi.getContainer.mockReturnValue({
      inspect: vi.fn().mockResolvedValue({
        Config: {
          Labels: {
            'com.docker.compose.project.config_files':
              '/opt/drydock/test/stack.yml,/opt/drydock/test/stack.override.yml',
          },
        },
      }),
    });
    const container = { name: 'inspected', watcher: 'local', labels: {} };
    const processComposeFileSpy = vi.spyOn(trigger, 'processComposeFile').mockResolvedValue();

    await trigger.triggerBatch([container]);

    expect(processComposeFileSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/stack.yml',
      [container],
      ['/opt/drydock/test/stack.yml', '/opt/drydock/test/stack.override.yml'],
    );
  });

  // -----------------------------------------------------------------------
  // initTrigger & trigger delegation
  // -----------------------------------------------------------------------

  test('initTrigger should set mode to batch', async () => {
    trigger.configuration.mode = 'simple';
    trigger.configuration.file = undefined;

    await trigger.initTrigger();

    expect(trigger.configuration.mode).toBe('batch');
  });

  test('initTrigger should throw when configured file does not exist', async () => {
    trigger.configuration.file = '/nonexistent/compose.yml';
    const err = new Error('ENOENT');
    err.code = 'ENOENT';
    fs.access.mockRejectedValueOnce(err);

    await expect(trigger.initTrigger()).rejects.toThrow('ENOENT');

    expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining('does not exist'));
  });

  test('initTrigger should log permission denied when configured file has EACCES', async () => {
    trigger.configuration.file = '/restricted/compose.yml';
    const err = new Error('EACCES');
    err.code = 'EACCES';
    fs.access.mockRejectedValueOnce(err);

    await expect(trigger.initTrigger()).rejects.toThrow('EACCES');

    expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining('permission denied'));
  });

  test('trigger should delegate to triggerBatch with single container', async () => {
    const container = { name: 'test' };
    const spy = vi.spyOn(trigger, 'triggerBatch').mockResolvedValue([true]);

    await trigger.trigger(container);

    expect(spy).toHaveBeenCalledWith([container]);
  });

  test('trigger should throw when update is still available but compose trigger applies no runtime updates', async () => {
    trigger.configuration.dryrun = false;
    const container = { name: 'test', updateAvailable: true };
    vi.spyOn(trigger, 'triggerBatch').mockResolvedValue([false]);

    await expect(trigger.trigger(container)).rejects.toThrow(
      'No compose updates were applied for container test',
    );
  });

  test('trigger should use unknown fallback when throwing without a container name', async () => {
    trigger.configuration.dryrun = false;
    const container = { updateAvailable: true };
    vi.spyOn(trigger, 'triggerBatch').mockResolvedValue([false]);

    await expect(trigger.trigger(container as any)).rejects.toThrow(
      'No compose updates were applied for container unknown',
    );
  });

  test('getConfigurationSchema should extend Docker schema with compose hardening options', () => {
    const schema = trigger.getConfigurationSchema();
    expect(schema).toBeDefined();
    const { error } = schema.validate({
      prune: false,
      dryrun: false,
      autoremovetimeout: 10000,
      file: '/opt/drydock/test/compose.yml',
      backup: true,
      composeFileLabel: 'dd.compose.file',
      reconciliationMode: 'block',
      digestPinning: true,
      composeFileOnce: true,
    });
    expect(error).toBeUndefined();
  });

  test('getConfigurationSchema should accept env-normalized compose hardening keys', () => {
    const schema = trigger.getConfigurationSchema();
    const { error, value } = schema.validate({
      prune: false,
      dryrun: false,
      autoremovetimeout: 10000,
      file: '/opt/drydock/test/compose.yml',
      backup: true,
      composefilelabel: 'com.example.compose.file',
      reconciliationmode: 'block',
      digestpinning: true,
      composefileonce: true,
    });
    expect(error).toBeUndefined();
    expect(value.composeFileLabel).toBe('com.example.compose.file');
    expect(value.reconciliationMode).toBe('block');
    expect(value.digestPinning).toBe(true);
    expect(value.composeFileOnce).toBe(true);
  });

  test('normalizeImplicitLatest should return input when image is empty or already digest/tag qualified', () => {
    expect(testable_normalizeImplicitLatest('')).toBe('');
    expect(testable_normalizeImplicitLatest('alpine@sha256:abc')).toBe('alpine@sha256:abc');
    expect(testable_normalizeImplicitLatest('nginx:1.0.0')).toBe('nginx:1.0.0');
  });

  test('normalizeImplicitLatest should append latest even when image path ends with slash', () => {
    expect(testable_normalizeImplicitLatest('repo/')).toBe('repo/:latest');
  });

  test('hasExplicitRegistryHost should detect empty, host:port, and localhost prefixes', () => {
    expect(testable_hasExplicitRegistryHost('')).toBe(false);
    expect(testable_hasExplicitRegistryHost('registry.example.com:5000/nginx:1.1.0')).toBe(true);
    expect(testable_hasExplicitRegistryHost('localhost/nginx:1.1.0')).toBe(true);
  });

  test('normalizePostStartHooks should return empty array when post_start is missing', () => {
    expect(testable_normalizePostStartHooks(undefined)).toEqual([]);
  });

  test('normalizePostStartEnvironmentValue should return empty string on json serialization errors', () => {
    const circular: any = {};
    circular.self = circular;
    expect(testable_normalizePostStartEnvironmentValue(circular)).toBe('');
  });

  test('updateComposeServiceImageInText should update only target service image while preserving comments', () => {
    const compose = [
      'services:',
      '  nginx:',
      '    # pinned for compatibility',
      '    image: nginx:1.1.0 # current',
      '    environment:',
      '      - NGINX_PORT=80',
      '  redis:',
      '    image: redis:7.0.0',
      '',
    ].join('\n');

    const updated = testable_updateComposeServiceImageInText(compose, 'nginx', 'nginx:1.2.0');

    expect(updated).toContain('    # pinned for compatibility');
    expect(updated).toContain('    image: nginx:1.2.0 # current');
    expect(updated).toContain('  redis:');
    expect(updated).toContain('    image: redis:7.0.0');
  });

  test('updateComposeServiceImageInText should insert image when service has no image key', () => {
    const compose = ['services:', '  nginx:', '    environment:', '      - NGINX_PORT=80', ''].join(
      '\n',
    );

    const updated = testable_updateComposeServiceImageInText(compose, 'nginx', 'nginx:1.2.0');

    expect(updated).toContain('  nginx:');
    expect(updated).toContain('    image: nginx:1.2.0');
    expect(updated).toContain('    environment:');
  });

  test('updateComposeServiceImageInText should preserve CRLF newlines', () => {
    const compose = ['services:', '  nginx:', '    image: nginx:1.1.0', ''].join('\r\n');

    const updated = testable_updateComposeServiceImageInText(compose, 'nginx', 'nginx:1.2.0');

    expect(updated).toContain('\r\n');
    expect(updated).toContain('image: nginx:1.2.0');
  });

  test('updateComposeServiceImageInText should preserve quote style when replacing image value', () => {
    const compose = ['services:', '  nginx:', "    image: 'nginx:1.1.0'", ''].join('\n');

    const updated = testable_updateComposeServiceImageInText(compose, 'nginx', 'nginx:1.2.0');

    expect(updated).toContain("image: 'nginx:1.2.0'");
  });

  test('updateComposeServiceImageInText should update image in flow-style service mapping', () => {
    const compose = ['services:', '  nginx: { image: "nginx:1.1.0", restart: always }', ''].join(
      '\n',
    );

    const updated = testable_updateComposeServiceImageInText(compose, 'nginx', 'nginx:1.2.0');

    expect(updated).toContain('nginx: { image: "nginx:1.2.0", restart: always }');
  });

  test('updateComposeServiceImageInText should parse with maxAliasCount guard', () => {
    const compose = ['services:', '  nginx:', '    image: nginx:1.1.0', ''].join('\n');
    const parseDocumentSpy = vi.spyOn(yaml, 'parseDocument');

    testable_updateComposeServiceImageInText(compose, 'nginx', 'nginx:1.2.0');

    expect(parseDocumentSpy).toHaveBeenCalledWith(
      compose,
      expect.objectContaining({
        keepSourceTokens: true,
        maxAliasCount: 10000,
      }),
    );
  });

  test('updateComposeServiceImageInText should throw for flow-style services without image key', () => {
    const compose = ['services:', '  nginx: { restart: always }', ''].join('\n');

    expect(() => testable_updateComposeServiceImageInText(compose, 'nginx', 'nginx:1.2.0')).toThrow(
      'Unable to insert compose image for flow-style service nginx without image key',
    );
  });

  test('updateComposeServiceImageInText should throw when services section is missing', () => {
    const compose = ['version: "3"', 'x-service: value', ''].join('\n');

    expect(() => testable_updateComposeServiceImageInText(compose, 'nginx', 'nginx:1.2.0')).toThrow(
      'Unable to locate services section in compose file',
    );
  });

  test('updateComposeServiceImageInText should insert image using default field indentation when service has no fields', () => {
    const compose = ['services:', '  nginx:', ''].join('\n');

    const updated = testable_updateComposeServiceImageInText(compose, 'nginx', 'nginx:1.2.0');

    expect(updated).toContain('  nginx:');
    expect(updated).toContain('    image: nginx:1.2.0');
  });

  test('updateComposeServiceImageInText should throw when service is missing', () => {
    const compose = ['services:', '  nginx:', '    image: nginx:1.1.0', ''].join('\n');

    expect(() => testable_updateComposeServiceImageInText(compose, 'redis', 'redis:7.1.0')).toThrow(
      'Unable to locate compose service redis',
    );
  });

  // -----------------------------------------------------------------------
  // Comment preservation
  // -----------------------------------------------------------------------

  test('updateComposeServiceImageInText should preserve commented-out service fields', () => {
    const compose = [
      'services:',
      '  nginx:',
      '    image: nginx:1.1.0',
      '    # ports:',
      '    #   - "8080:80"',
      '    # volumes:',
      '    #   - ./html:/usr/share/nginx/html',
      '    # environment:',
      '    #   - FOO=bar',
      '    restart: always',
      '',
    ].join('\n');

    const updated = testable_updateComposeServiceImageInText(compose, 'nginx', 'nginx:1.2.0');

    expect(updated).toContain('    image: nginx:1.2.0');
    expect(updated).toContain('    # ports:');
    expect(updated).toContain('    #   - "8080:80"');
    expect(updated).toContain('    # volumes:');
    expect(updated).toContain('    #   - ./html:/usr/share/nginx/html');
    expect(updated).toContain('    # environment:');
    expect(updated).toContain('    #   - FOO=bar');
    expect(updated).toContain('    restart: always');
  });

  test('updateComposeServiceImageInText should preserve a commented-out entire service', () => {
    const compose = [
      'services:',
      '  nginx:',
      '    image: nginx:1.1.0',
      '  # redis:',
      '  #   image: redis:7',
      '  #   ports:',
      '  #     - "6379:6379"',
      '',
    ].join('\n');

    const updated = testable_updateComposeServiceImageInText(compose, 'nginx', 'nginx:1.2.0');

    expect(updated).toContain('    image: nginx:1.2.0');
    expect(updated).toContain('  # redis:');
    expect(updated).toContain('  #   image: redis:7');
    expect(updated).toContain('  #   ports:');
    expect(updated).toContain('  #     - "6379:6379"');
  });

  test('updateComposeServiceImageInText should preserve top-level file comments', () => {
    const compose = [
      '# My production stack',
      '# Last updated: 2024-01-01',
      'services:',
      '  nginx:',
      '    image: nginx:1.1.0',
      '',
    ].join('\n');

    const updated = testable_updateComposeServiceImageInText(compose, 'nginx', 'nginx:1.2.0');

    expect(updated).toContain('# My production stack');
    expect(updated).toContain('# Last updated: 2024-01-01');
    expect(updated).toContain('    image: nginx:1.2.0');
  });

  test('updateComposeServiceImageInText should preserve mixed inline and block comments', () => {
    const compose = [
      '# Stack header',
      'services:',
      '  nginx:',
      '    image: nginx:1.1.0 # web server',
      '    # ports:',
      '    #   - "80:80"',
      '    environment: # env vars',
      '      - NGINX_PORT=80 # default port',
      '  redis:',
      '    image: redis:7.0.0 # cache',
      '',
    ].join('\n');

    const updated = testable_updateComposeServiceImageInText(compose, 'nginx', 'nginx:1.2.0');

    expect(updated).toContain('# Stack header');
    expect(updated).toContain('    image: nginx:1.2.0 # web server');
    expect(updated).toContain('    # ports:');
    expect(updated).toContain('    #   - "80:80"');
    expect(updated).toContain('    environment: # env vars');
    expect(updated).toContain('      - NGINX_PORT=80 # default port');
    expect(updated).toContain('    image: redis:7.0.0 # cache');
  });

  // -----------------------------------------------------------------------
  // Image pruning after compose update
  // -----------------------------------------------------------------------

  test('processComposeFile should prune images after non-dryrun update when prune is enabled', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.prune = true;

    const container = makeContainer();

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
    );
    const { pruneImagesSpy, cleanupOldImagesSpy } = spyOnProcessComposeHelpers(trigger);

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);

    expect(pruneImagesSpy).toHaveBeenCalledWith(
      mockDockerApi,
      getState().registry.hub,
      container,
      expect.anything(),
    );
    expect(cleanupOldImagesSpy).toHaveBeenCalledWith(
      mockDockerApi,
      getState().registry.hub,
      container,
      expect.anything(),
    );
  });

  test('processComposeFile should not call pruneImages when prune is disabled', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.prune = false;

    const container = makeContainer();

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
    );
    const { pruneImagesSpy, cleanupOldImagesSpy } = spyOnProcessComposeHelpers(trigger);

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);

    // pruneImages is gated by prune config
    expect(pruneImagesSpy).not.toHaveBeenCalled();
    // cleanupOldImages is always called — it handles the prune check internally
    expect(cleanupOldImagesSpy).toHaveBeenCalledTimes(1);
  });

  test('processComposeFile should skip pruneImages and post-update lifecycle in dryrun mode', async () => {
    trigger.configuration.dryrun = true;
    trigger.configuration.prune = true;

    const container = makeContainer();

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
    );
    const { pruneImagesSpy, cleanupOldImagesSpy, postHookSpy, rollbackMonitorSpy } =
      spyOnProcessComposeHelpers(trigger);

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);

    // pruneImages is skipped in compose dryrun mode
    expect(pruneImagesSpy).not.toHaveBeenCalled();
    // cleanupOldImages is skipped (performContainerUpdate returns false in dryrun)
    expect(cleanupOldImagesSpy).not.toHaveBeenCalled();
    // Post-update hook is skipped in dryrun
    expect(postHookSpy).not.toHaveBeenCalled();
    // Rollback monitor is skipped in dryrun
    expect(rollbackMonitorSpy).not.toHaveBeenCalled();
    // No update event emitted
    expect(emitContainerUpdateApplied).not.toHaveBeenCalled();
  });

  test('processComposeFile should prune images for each container in a multi-container update', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.prune = true;

    const nginxContainer = makeContainer();
    const redisContainer = makeContainer({
      name: 'redis',
      imageName: 'redis',
      tagValue: '7.0.0',
      remoteValue: '7.1.0',
    });

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({
        nginx: { image: 'nginx:1.0.0' },
        redis: { image: 'redis:7.0.0' },
      }),
    );
    const { pruneImagesSpy, cleanupOldImagesSpy } = spyOnProcessComposeHelpers(trigger);

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [
      nginxContainer,
      redisContainer,
    ]);

    expect(pruneImagesSpy).toHaveBeenCalledTimes(2);
    expect(cleanupOldImagesSpy).toHaveBeenCalledTimes(2);
  });

  test('processComposeFile should parse compose update document only once for multi-service updates', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.prune = false;

    const nginxContainer = makeContainer();
    const redisContainer = makeContainer({
      name: 'redis',
      imageName: 'redis',
      tagValue: '7.0.0',
      remoteValue: '7.1.0',
    });

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({
        nginx: { image: 'nginx:1.0.0' },
        redis: { image: 'redis:7.0.0' },
      }),
    );
    spyOnProcessComposeHelpers(trigger);
    const parseDocumentSpy = vi.spyOn(yaml, 'parseDocument');

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [
      nginxContainer,
      redisContainer,
    ]);

    expect(parseDocumentSpy).toHaveBeenCalledTimes(1);
  });

  test('processComposeFile should refresh each distinct service in compose-file-once mode', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.prune = false;
    trigger.configuration.composeFileOnce = true;

    const nginxContainer = makeContainer({
      labels: { 'com.docker.compose.service': 'nginx' },
    });
    const redisContainer = makeContainer({
      name: 'redis',
      imageName: 'redis',
      tagValue: '7.0.0',
      remoteValue: '7.1.0',
      labels: { 'com.docker.compose.service': 'redis' },
    });

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({
        nginx: { image: 'nginx:1.0.0' },
        redis: { image: 'redis:7.0.0' },
      }),
    );
    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(
      Buffer.from(
        [
          'services:',
          '  nginx:',
          '    image: nginx:1.0.0',
          '  redis:',
          '    image: redis:7.0.0',
          '',
        ].join('\n'),
      ),
    );
    vi.spyOn(trigger, 'writeComposeFile').mockResolvedValue();
    const runContainerUpdateLifecycleSpy = vi
      .spyOn(trigger, 'runContainerUpdateLifecycle')
      .mockResolvedValue();
    vi.spyOn(trigger, 'maybeScanAndGateUpdate').mockResolvedValue();
    vi.spyOn(trigger, 'runPreUpdateHook').mockResolvedValue();
    vi.spyOn(trigger, 'runPostUpdateHook').mockResolvedValue();
    vi.spyOn(trigger, 'cleanupOldImages').mockResolvedValue();
    vi.spyOn(trigger, 'maybeStartAutoRollbackMonitor').mockResolvedValue();

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [
      nginxContainer,
      redisContainer,
    ]);

    expect(runContainerUpdateLifecycleSpy).toHaveBeenCalledTimes(2);
    expect(runContainerUpdateLifecycleSpy).toHaveBeenNthCalledWith(
      1,
      nginxContainer,
      expect.objectContaining({
        service: 'nginx',
        composeFileOnceApplied: false,
      }),
    );
    expect(runContainerUpdateLifecycleSpy).toHaveBeenNthCalledWith(
      2,
      redisContainer,
      expect.objectContaining({
        service: 'redis',
        composeFileOnceApplied: false,
      }),
    );
  });

  test('processComposeFile should pre-pull distinct services and skip per-service pull in compose-file-once mode', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.prune = false;
    trigger.configuration.composeFileOnce = true;

    const nginxContainer = makeContainer({
      labels: { 'com.docker.compose.service': 'nginx' },
    });
    const redisContainer = makeContainer({
      name: 'redis',
      imageName: 'redis',
      tagValue: '7.0.0',
      remoteValue: '7.1.0',
      labels: { 'com.docker.compose.service': 'redis' },
    });

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({
        nginx: { image: 'nginx:1.0.0' },
        redis: { image: 'redis:7.0.0' },
      }),
    );
    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(
      Buffer.from(
        [
          'services:',
          '  nginx:',
          '    image: nginx:1.0.0',
          '  redis:',
          '    image: redis:7.0.0',
          '',
        ].join('\n'),
      ),
    );
    vi.spyOn(trigger, 'writeComposeFile').mockResolvedValue();
    const pullImageSpy = vi.spyOn(trigger, 'pullImage').mockResolvedValue();
    const updateContainerWithComposeSpy = vi
      .spyOn(trigger, 'updateContainerWithCompose')
      .mockResolvedValue();
    vi.spyOn(trigger, 'runServicePostStartHooks').mockResolvedValue();
    vi.spyOn(trigger, 'maybeScanAndGateUpdate').mockResolvedValue();
    vi.spyOn(trigger, 'runPreUpdateHook').mockResolvedValue();
    vi.spyOn(trigger, 'runPostUpdateHook').mockResolvedValue();
    vi.spyOn(trigger, 'cleanupOldImages').mockResolvedValue();
    vi.spyOn(trigger, 'maybeStartAutoRollbackMonitor').mockResolvedValue();

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [
      nginxContainer,
      redisContainer,
    ]);

    expect(pullImageSpy).toHaveBeenCalledTimes(2);
    expect(updateContainerWithComposeSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/stack.yml',
      'nginx',
      nginxContainer,
      expect.objectContaining({
        skipPull: true,
      }),
    );
    expect(updateContainerWithComposeSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/stack.yml',
      'redis',
      redisContainer,
      expect.objectContaining({
        skipPull: true,
      }),
    );
  });

  test('processComposeFile should prune images for digest-only updates when prune is enabled', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.prune = true;

    const container = makeContainer({
      name: 'redis',
      imageName: 'redis',
      tagValue: '7.0.0',
      updateKind: 'digest',
      remoteValue: 'sha256:deadbeef',
    });

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ redis: { image: 'redis:7.0.0' } }),
    );
    const { pruneImagesSpy, cleanupOldImagesSpy } = spyOnProcessComposeHelpers(trigger);

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);

    expect(pruneImagesSpy).toHaveBeenCalledTimes(1);
    expect(cleanupOldImagesSpy).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // Update lifecycle (security, hooks, backups, events)
  // -----------------------------------------------------------------------

  test('processComposeFile should use self-update branch for compose-managed Drydock', async () => {
    trigger.configuration.dryrun = false;

    const container = makeContainer({
      name: 'drydock',
      imageName: 'codeswhat/drydock',
      tagValue: '1.0.0',
      remoteValue: '1.1.0',
      labels: { 'com.docker.compose.service': 'drydock' },
    });

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ drydock: { image: 'codeswhat/drydock:1.0.0' } }),
    );
    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(
      Buffer.from(['services:', '  drydock:', '    image: codeswhat/drydock:1.0.0', ''].join('\n')),
    );
    vi.spyOn(trigger, 'writeComposeFile').mockResolvedValue();
    const notifySpy = vi.spyOn(trigger, 'maybeNotifySelfUpdate').mockResolvedValue();
    const executeSelfUpdateSpy = vi.spyOn(trigger, 'executeSelfUpdate').mockResolvedValue(true);
    const postHookSpy = vi.spyOn(trigger, 'runPostUpdateHook').mockResolvedValue();

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);

    expect(notifySpy).toHaveBeenCalledTimes(1);
    expect(executeSelfUpdateSpy).toHaveBeenCalledTimes(1);
    expect(postHookSpy).not.toHaveBeenCalled();
    expect(emitContainerUpdateApplied).not.toHaveBeenCalled();
  });

  test('processComposeFile should run full update lifecycle for non-dryrun update', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.prune = false;

    const container = makeContainer();

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
    );
    const { maybeScanSpy, preHookSpy, postHookSpy, composeUpdateSpy, rollbackMonitorSpy } =
      spyOnProcessComposeHelpers(trigger);

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);

    // Security scanning
    expect(maybeScanSpy).toHaveBeenCalledTimes(1);
    // Pre/post update hooks
    expect(preHookSpy).toHaveBeenCalledTimes(1);
    expect(postHookSpy).toHaveBeenCalledTimes(1);
    // Rollback monitor phase
    expect(rollbackMonitorSpy).toHaveBeenCalledTimes(1);
    // Compose update
    expect(composeUpdateSpy).toHaveBeenCalledTimes(1);
    // Backup inserted
    expect(backupStore.insertBackup).toHaveBeenCalledWith(
      expect.objectContaining({
        containerName: 'nginx',
        imageTag: '1.0.0',
        triggerName: 'dockercompose.test',
      }),
    );
    // Backup pruning
    expect(backupStore.pruneOldBackups).toHaveBeenCalledWith('nginx', undefined);
    // Update applied event
    expect(emitContainerUpdateApplied).toHaveBeenCalledWith('test_nginx');
  });

  test('processComposeFile should run security scanning but skip post-update lifecycle in dryrun mode', async () => {
    trigger.configuration.dryrun = true;

    const container = makeContainer();

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
    );
    const { maybeScanSpy, preHookSpy, postHookSpy, rollbackMonitorSpy } =
      spyOnProcessComposeHelpers(trigger);

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);

    // Security scanning runs even in dryrun (matches Docker behavior)
    expect(maybeScanSpy).toHaveBeenCalledTimes(1);
    // Pre-update hook still runs (can abort before dryrun pull)
    expect(preHookSpy).toHaveBeenCalledTimes(1);
    // Post-update hook skipped (performContainerUpdate returns false in dryrun)
    expect(postHookSpy).not.toHaveBeenCalled();
    // Rollback monitoring does not start because runtime update returns false in dryrun
    expect(rollbackMonitorSpy).not.toHaveBeenCalled();
    // Backup insertion is skipped in compose dryrun mode
    expect(backupStore.insertBackup).not.toHaveBeenCalled();
    // No update event (performContainerUpdate returned false)
    expect(emitContainerUpdateApplied).not.toHaveBeenCalled();
  });

  test('processComposeFile should emit failure event on error', async () => {
    trigger.configuration.dryrun = false;

    const container = makeContainer();

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
    );
    const helpers = spyOnProcessComposeHelpers(trigger);
    helpers.composeUpdateSpy.mockRejectedValue(new Error('compose pull failed'));

    await expect(
      trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]),
    ).rejects.toThrow('compose pull failed');

    expect(emitContainerUpdateApplied).not.toHaveBeenCalled();
    expect(emitContainerUpdateFailed).toHaveBeenCalledWith({
      containerName: 'test_nginx',
      error: 'compose pull failed',
    });
  });

  test('mapCurrentVersionToUpdateVersion should match services by raw image substring', () => {
    const compose = makeCompose({
      nginx: { image: 'ghcr.io/acme/nginx:1.0.0-alpine' },
    });
    const container = makeContainer({
      imageName: 'nginx',
      tagValue: '1.0.0',
      remoteValue: '1.1.0',
    });

    const result = trigger.mapCurrentVersionToUpdateVersion(compose, container);

    expect(result?.service).toBe('nginx');
  });

  test('getComposeFilesFromProjectLabels should warn and skip invalid working directory and config file labels', () => {
    const composeFiles = trigger.getComposeFilesFromProjectLabels(
      {
        'com.docker.compose.project.working_dir': '\0invalid-workdir',
        'com.docker.compose.project.config_files': '/opt/drydock/test/stack.yml,\0invalid-file',
      },
      'test-container',
    );

    expect(composeFiles).toContain('/opt/drydock/test/stack.yml');
    expect(composeFiles).not.toContain('\0invalid-file');
    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.stringContaining('com.docker.compose.project.working_dir'),
    );
    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.stringContaining('com.docker.compose.project.config_files'),
    );
  });

  test('getComposeFilesFromInspect should return empty list when watcher has no docker api', async () => {
    vi.spyOn(trigger, 'getWatcher').mockReturnValue({} as any);

    await expect(
      trigger.getComposeFilesFromInspect({
        name: 'nginx',
      } as any),
    ).resolves.toEqual([]);
  });

  test('getComposeFilesFromInspect should return empty list when inspect fails', async () => {
    const inspectError = new Error('inspect failed');
    vi.spyOn(trigger, 'getWatcher').mockReturnValue({
      dockerApi: {
        modem: {},
        getContainer: vi.fn(() => ({
          inspect: vi.fn().mockRejectedValue(inspectError),
        })),
      },
    } as any);

    await expect(
      trigger.getComposeFilesFromInspect({
        name: 'nginx',
      } as any),
    ).resolves.toEqual([]);
    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.stringContaining('Unable to inspect compose labels'),
    );
  });

  test('normalizeDigestPinningValue should normalize accepted digest formats', () => {
    expect(trigger.normalizeDigestPinningValue(undefined)).toBeNull();
    expect(trigger.normalizeDigestPinningValue('   ')).toBeNull();
    expect(trigger.normalizeDigestPinningValue('sha256:ABC123')).toBe('sha256:ABC123');
    expect(trigger.normalizeDigestPinningValue('abc123')).toBe('sha256:abc123');
    expect(trigger.normalizeDigestPinningValue('not-a-digest')).toBeNull();
  });

  test('normalizeComposeFileChain should return empty chain when no compose file is provided', () => {
    expect(trigger.normalizeComposeFileChain(undefined, undefined)).toEqual([]);
  });

  test('normalizeComposeFileChain should drop empty compose file entries', () => {
    expect(trigger.normalizeComposeFileChain('/opt/drydock/test/stack.yml', [''])).toEqual([]);
  });

  test('getComposeFilesFromProjectLabels should resolve config files relative to compose working directory', () => {
    const composeFiles = trigger.getComposeFilesFromProjectLabels(
      {
        'com.docker.compose.project.working_dir': '/opt/drydock/test',
        'com.docker.compose.project.config_files': 'stack.yml,stack.override.yml',
      },
      'test-container',
    );

    expect(composeFiles).toEqual([
      '/opt/drydock/test/stack.yml',
      '/opt/drydock/test/stack.override.yml',
    ]);
  });

  test('resolveComposeFilesForContainer should map compose config file labels from host bind paths to container paths', async () => {
    const originalHostname = process.env.HOSTNAME;
    process.env.HOSTNAME = 'drydock-self';

    mockDockerApi.getContainer.mockImplementation((containerName) => {
      if (containerName === 'drydock-self') {
        return {
          inspect: vi.fn().mockResolvedValue({
            HostConfig: {
              Binds: ['/mnt/volume1/docker/stacks:/drydock:rw'],
            },
          }),
        };
      }
      return {
        inspect: vi.fn().mockResolvedValue({
          State: { Running: true },
        }),
      };
    });

    try {
      const composeFiles = await trigger.resolveComposeFilesForContainer({
        name: 'monitoring',
        watcher: 'local',
        labels: {
          'com.docker.compose.project.config_files':
            '/mnt/volume1/docker/stacks/monitoring/compose.yaml',
        },
      });

      expect(composeFiles).toEqual(['/drydock/monitoring/compose.yaml']);
    } finally {
      if (originalHostname === undefined) {
        delete process.env.HOSTNAME;
      } else {
        process.env.HOSTNAME = originalHostname;
      }
    }
  });

  test('parseHostToContainerBindMount should return null when bind definition is missing source or destination', () => {
    expect(trigger.parseHostToContainerBindMount('/mnt/volume1/docker/stacks')).toBeNull();
    expect(trigger.parseHostToContainerBindMount(':/drydock')).toBeNull();
  });

  test('parseHostToContainerBindMount should ignore trailing mount options', () => {
    expect(trigger.parseHostToContainerBindMount('/mnt/volume1/docker/stacks:/drydock:rw')).toEqual(
      {
        source: '/mnt/volume1/docker/stacks',
        destination: '/drydock',
      },
    );
    expect(trigger.parseHostToContainerBindMount('/mnt/volume1/docker/stacks:/drydock:ro')).toEqual(
      {
        source: '/mnt/volume1/docker/stacks',
        destination: '/drydock',
      },
    );
  });

  test('getSelfContainerIdentifier should return null when HOSTNAME contains slash', () => {
    const originalHostname = process.env.HOSTNAME;
    process.env.HOSTNAME = 'pod/name';

    try {
      expect(trigger.getSelfContainerIdentifier()).toBeNull();
    } finally {
      if (originalHostname === undefined) {
        delete process.env.HOSTNAME;
      } else {
        process.env.HOSTNAME = originalHostname;
      }
    }
  });

  test('getSelfContainerIdentifier should return null when HOSTNAME is whitespace', () => {
    const originalHostname = process.env.HOSTNAME;
    process.env.HOSTNAME = '   ';

    try {
      expect(trigger.getSelfContainerIdentifier()).toBeNull();
    } finally {
      if (originalHostname === undefined) {
        delete process.env.HOSTNAME;
      } else {
        process.env.HOSTNAME = originalHostname;
      }
    }
  });

  test('getSelfContainerIdentifier should return null when HOSTNAME is undefined', () => {
    const originalHostname = process.env.HOSTNAME;
    delete process.env.HOSTNAME;

    try {
      expect(trigger.getSelfContainerIdentifier()).toBeNull();
    } finally {
      if (originalHostname === undefined) {
        delete process.env.HOSTNAME;
      } else {
        process.env.HOSTNAME = originalHostname;
      }
    }
  });

  test('getSelfContainerIdentifier should return null when HOSTNAME starts with non-alphanumeric character', () => {
    const originalHostname = process.env.HOSTNAME;
    process.env.HOSTNAME = '-drydock-self';

    try {
      expect(trigger.getSelfContainerIdentifier()).toBeNull();
    } finally {
      if (originalHostname === undefined) {
        delete process.env.HOSTNAME;
      } else {
        process.env.HOSTNAME = originalHostname;
      }
    }
  });

  test('getSelfContainerIdentifier should return null when HOSTNAME has unsupported characters', () => {
    const originalHostname = process.env.HOSTNAME;
    process.env.HOSTNAME = 'drydock$self';

    try {
      expect(trigger.getSelfContainerIdentifier()).toBeNull();
    } finally {
      if (originalHostname === undefined) {
        delete process.env.HOSTNAME;
      } else {
        process.env.HOSTNAME = originalHostname;
      }
    }
  });

  test('getSelfContainerIdentifier should return trimmed hostname when HOSTNAME is valid', () => {
    const originalHostname = process.env.HOSTNAME;
    process.env.HOSTNAME = '  drydock-self  ';

    try {
      expect(trigger.getSelfContainerIdentifier()).toBe('drydock-self');
    } finally {
      if (originalHostname === undefined) {
        delete process.env.HOSTNAME;
      } else {
        process.env.HOSTNAME = originalHostname;
      }
    }
  });

  test('parseHostToContainerBindMount should return null when source or destination is not absolute', () => {
    expect(trigger.parseHostToContainerBindMount('relative/path:/drydock')).toBeNull();
    expect(
      trigger.parseHostToContainerBindMount('/mnt/volume1/docker/stacks:relative/path'),
    ).toBeNull();
  });

  test('ensureHostToContainerBindMountsLoaded should return early when watcher docker api is unavailable', async () => {
    const originalHostname = process.env.HOSTNAME;
    process.env.HOSTNAME = 'drydock-self';

    vi.spyOn(trigger, 'getWatcher').mockReturnValue({} as any);

    try {
      await trigger.ensureHostToContainerBindMountsLoaded({ name: 'monitoring' } as any);

      expect(trigger.isHostToContainerBindMountCacheLoaded()).toBe(false);
      expect(trigger.getHostToContainerBindMountCache()).toEqual([]);
    } finally {
      if (originalHostname === undefined) {
        delete process.env.HOSTNAME;
      } else {
        process.env.HOSTNAME = originalHostname;
      }
    }
  });

  test('ensureHostToContainerBindMountsLoaded should wait for an in-flight load to finish', async () => {
    const originalHostname = process.env.HOSTNAME;
    process.env.HOSTNAME = 'drydock-self';

    let resolveInspect: ((value: any) => void) | undefined;
    const inspectPromise = new Promise((resolve) => {
      resolveInspect = resolve;
    });
    mockDockerApi.getContainer.mockReturnValue({
      inspect: vi.fn().mockReturnValue(inspectPromise),
    });

    try {
      const firstLoad = trigger.ensureHostToContainerBindMountsLoaded({
        name: 'monitoring',
        watcher: 'local',
      } as any);
      await Promise.resolve();

      let secondLoadResolved = false;
      const secondLoad = trigger
        .ensureHostToContainerBindMountsLoaded({
          name: 'monitoring',
          watcher: 'local',
        } as any)
        .then(() => {
          secondLoadResolved = true;
        });

      await Promise.resolve();
      expect(secondLoadResolved).toBe(false);

      if (!resolveInspect) {
        throw new Error('resolveInspect was not initialized');
      }
      resolveInspect({
        HostConfig: {
          Binds: ['/mnt/volume1/docker/stacks:/drydock:rw'],
        },
      });

      await Promise.all([firstLoad, secondLoad]);

      expect(mockDockerApi.getContainer).toHaveBeenCalledTimes(1);
      expect(trigger.getHostToContainerBindMountCache()).toEqual([
        {
          source: '/mnt/volume1/docker/stacks',
          destination: '/drydock',
        },
      ]);
    } finally {
      if (originalHostname === undefined) {
        delete process.env.HOSTNAME;
      } else {
        process.env.HOSTNAME = originalHostname;
      }
    }
  });

  test('ensureHostToContainerBindMountsLoaded should skip when bind definitions are not an array', async () => {
    const originalHostname = process.env.HOSTNAME;
    process.env.HOSTNAME = 'drydock-self';

    mockDockerApi.getContainer.mockReturnValue({
      inspect: vi.fn().mockResolvedValue({
        HostConfig: {
          Binds: null,
        },
      }),
    });

    try {
      await trigger.ensureHostToContainerBindMountsLoaded({
        name: 'monitoring',
        watcher: 'local',
      } as any);

      expect(trigger.isHostToContainerBindMountCacheLoaded()).toBe(true);
      expect(trigger.getHostToContainerBindMountCache()).toEqual([]);
    } finally {
      if (originalHostname === undefined) {
        delete process.env.HOSTNAME;
      } else {
        process.env.HOSTNAME = originalHostname;
      }
    }
  });

  test('ensureHostToContainerBindMountsLoaded should parse and sort bind mounts by source path length', async () => {
    const originalHostname = process.env.HOSTNAME;
    process.env.HOSTNAME = 'drydock-self';

    mockDockerApi.getContainer.mockReturnValue({
      inspect: vi.fn().mockResolvedValue({
        HostConfig: {
          Binds: ['/mnt/volume1/docker:/drydock-base:rw', '/mnt/volume1/docker/stacks:/drydock:rw'],
        },
      }),
    });

    try {
      await trigger.ensureHostToContainerBindMountsLoaded({
        name: 'monitoring',
        watcher: 'local',
      } as any);

      expect(trigger.getHostToContainerBindMountCache()).toEqual([
        {
          source: '/mnt/volume1/docker/stacks',
          destination: '/drydock',
        },
        {
          source: '/mnt/volume1/docker',
          destination: '/drydock-base',
        },
      ]);
    } finally {
      if (originalHostname === undefined) {
        delete process.env.HOSTNAME;
      } else {
        process.env.HOSTNAME = originalHostname;
      }
    }
  });

  test('ensureHostToContainerBindMountsLoaded should log debug message when inspect fails', async () => {
    const originalHostname = process.env.HOSTNAME;
    process.env.HOSTNAME = 'drydock-self';

    mockDockerApi.getContainer.mockReturnValue({
      inspect: vi.fn().mockRejectedValue(new Error('inspect failed')),
    });

    try {
      await trigger.ensureHostToContainerBindMountsLoaded({
        name: 'monitoring',
        watcher: 'local',
      } as any);

      expect(trigger.isHostToContainerBindMountCacheLoaded()).toBe(true);
      expect(mockLog.debug).toHaveBeenCalledWith(
        expect.stringContaining('Unable to inspect bind mounts for compose host-path remapping'),
      );
    } finally {
      if (originalHostname === undefined) {
        delete process.env.HOSTNAME;
      } else {
        process.env.HOSTNAME = originalHostname;
      }
    }
  });

  test('mapComposePathToContainerBindMount should map exact source paths to destination paths', () => {
    trigger.setHostToContainerBindMountCache([
      {
        source: '/mnt/volume1/docker/stacks/monitoring/compose.yaml',
        destination: '/drydock/monitoring/compose.yaml',
      },
    ]);

    const mappedPath = trigger.mapComposePathToContainerBindMount(
      '/mnt/volume1/docker/stacks/monitoring/compose.yaml',
    );

    expect(mappedPath).toBe('/drydock/monitoring/compose.yaml');
  });

  test('mapComposePathToContainerBindMount should map nested files when bind source ends with path separator', () => {
    trigger.setHostToContainerBindMountCache([
      {
        source: '/mnt/volume1/docker/stacks/',
        destination: '/drydock/',
      },
    ]);

    const mappedPath = trigger.mapComposePathToContainerBindMount(
      '/mnt/volume1/docker/stacks/monitoring/compose.yaml',
    );

    expect(mappedPath).toBe('/drydock/monitoring/compose.yaml');
  });

  test('mapComposePathToContainerBindMount should return original path when no bind source matches', () => {
    trigger.setHostToContainerBindMountCache([
      {
        source: '/mnt/volume1/docker/stacks/',
        destination: '/drydock/',
      },
    ]);

    const composePath = '/opt/other/stack/compose.yaml';
    const mappedPath = trigger.mapComposePathToContainerBindMount(composePath);

    expect(mappedPath).toBe(composePath);
  });

  test('mapComposePathToContainerBindMount should return destination root when computed relative path is empty', () => {
    trigger.setHostToContainerBindMountCache([
      {
        source: '/mnt/volume1/docker/stacks/',
        destination: '/drydock/',
      },
    ]);
    const relativeSpy = vi.spyOn(path, 'relative').mockReturnValueOnce('');

    try {
      const mappedPath = trigger.mapComposePathToContainerBindMount(
        '/mnt/volume1/docker/stacks/monitoring/compose.yaml',
      );
      expect(mappedPath).toBe('/drydock/');
    } finally {
      relativeSpy.mockRestore();
    }
  });

  test('mapComposePathToContainerBindMount should skip unsafe relative compose paths that escape source', () => {
    trigger.setHostToContainerBindMountCache([
      {
        source: '/mnt/volume1/docker/stacks/',
        destination: '/drydock/',
      },
    ]);
    const relativeSpy = vi.spyOn(path, 'relative').mockReturnValueOnce('../escape');

    try {
      const composePath = '/mnt/volume1/docker/stacks/monitoring/compose.yaml';
      const mappedPath = trigger.mapComposePathToContainerBindMount(composePath);
      expect(mappedPath).toBe(composePath);
    } finally {
      relativeSpy.mockRestore();
    }
  });

  test('getImageNameFromReference should parse image names from tags and digests', () => {
    expect(trigger.getImageNameFromReference(undefined)).toBeUndefined();
    expect(trigger.getImageNameFromReference('nginx:1.0.0')).toBe('nginx');
    expect(trigger.getImageNameFromReference('ghcr.io/acme/web@sha256:abc')).toBe(
      'ghcr.io/acme/web',
    );
    expect(trigger.getImageNameFromReference('ghcr.io/acme/web')).toBe('ghcr.io/acme/web');
  });

  test('getComposeMutationImageReference should honor digest pinning settings and fallbacks', () => {
    const container = makeContainer({
      updateKind: 'digest',
      remoteValue: 'abc123',
      result: {},
    });
    trigger.configuration.digestPinning = false;
    expect(trigger.getComposeMutationImageReference(container as any, 'nginx:1.1.0')).toBe(
      'nginx:1.1.0',
    );

    trigger.configuration.digestPinning = true;
    expect(trigger.getComposeMutationImageReference(container as any, '')).toBe('');
    expect(trigger.getComposeMutationImageReference(container as any, 'nginx:1.1.0')).toBe(
      'nginx@sha256:abc123',
    );
    expect(
      trigger.getComposeMutationImageReference(
        makeContainer({ updateKind: 'digest', remoteValue: 'invalid' }) as any,
        'nginx:1.1.0',
      ),
    ).toBe('nginx:1.1.0');
    expect(
      trigger.getComposeMutationImageReference(
        makeContainer({ updateKind: 'tag', remoteValue: '1.1.0' }) as any,
        'nginx:1.1.0',
      ),
    ).toBe('nginx:1.1.0');
  });

  test('getComposeMutationImageReference should preserve explicit docker.io prefix from compose image', () => {
    const container = makeContainer({
      updateKind: 'digest',
      remoteValue: 'abc123',
      result: {},
    });

    trigger.configuration.digestPinning = false;
    expect(
      trigger.getComposeMutationImageReference(
        container as any,
        'nginx:1.1.0',
        'docker.io/nginx:1.0.0',
      ),
    ).toBe('docker.io/nginx:1.1.0');

    trigger.configuration.digestPinning = true;
    expect(
      trigger.getComposeMutationImageReference(
        container as any,
        'nginx:1.1.0',
        'docker.io/nginx:1.0.0',
      ),
    ).toBe('docker.io/nginx@sha256:abc123');

    expect(
      trigger.getComposeMutationImageReference(
        container as any,
        'ghcr.io/acme/nginx:1.1.0',
        'docker.io/nginx:1.0.0',
      ),
    ).toBe('ghcr.io/acme/nginx@sha256:abc123');
  });

  test('buildComposeServiceImageUpdates should use runtime update image when compose update override is missing', () => {
    const serviceUpdates = trigger.buildComposeServiceImageUpdates([
      {
        service: 'nginx',
        update: 'nginx:1.1.0',
      },
    ] as any);

    expect(serviceUpdates.get('nginx')).toBe('nginx:1.1.0');
  });

  test('buildUpdatedComposeFileObjectForValidation should return undefined for non-object input', () => {
    const updated = trigger.buildUpdatedComposeFileObjectForValidation(null, new Map());

    expect(updated).toBeUndefined();
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
    );
    expect(runContainerUpdateLifecycleSpy).toHaveBeenNthCalledWith(
      2,
      secondContainer,
      expect.objectContaining({
        service: 'nginx',
        composeFileOnceApplied: true,
      }),
    );
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
      .mockResolvedValue();
    vi.spyOn(trigger, 'runServicePostStartHooks').mockResolvedValue();
    vi.spyOn(trigger, 'maybeScanAndGateUpdate').mockResolvedValue();
    vi.spyOn(trigger, 'runPreUpdateHook').mockResolvedValue();
    vi.spyOn(trigger, 'runPostUpdateHook').mockResolvedValue();
    vi.spyOn(trigger, 'cleanupOldImages').mockResolvedValue();
    vi.spyOn(trigger, 'maybeStartAutoRollbackMonitor').mockResolvedValue();

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [
      firstContainer,
      secondContainer,
    ]);

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
