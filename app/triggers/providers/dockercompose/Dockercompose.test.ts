// @ts-nocheck
import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import { emitContainerUpdateApplied, emitContainerUpdateFailed } from '../../../event/index.js';
import { getState } from '../../../registry/index.js';
import * as backupStore from '../../../store/backup.js';
import Dockercompose, {
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
}));
vi.mock('../../../store/container.js', () => ({
  getContainer: vi.fn(),
  updateContainer: vi.fn(),
  cacheSecurityState: vi.fn(),
}));
vi.mock('../../hooks/HookRunner.js', () => ({ runHook: vi.fn() }));
vi.mock('../docker/HealthMonitor.js', () => ({ startHealthMonitor: vi.fn() }));

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
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

    mockLog = {
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };

    trigger = new Dockercompose();
    trigger.log = mockLog;
    trigger.configuration = {
      dryrun: true,
      backup: false,
      composeFileLabel: 'dd.compose.file',
    };

    mockDockerApi = {
      modem: {
        socketPath: '/var/run/docker.sock',
      },
      getContainer: vi.fn().mockReturnValue({
        inspect: vi.fn().mockResolvedValue({
          State: { Running: true },
        }),
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

    execFile.mockImplementation((_command, _args, _options, callback) => {
      callback(null, '', '');
      return {};
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
    );
    expect(composeUpdateSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/stack.yml',
      'redis',
      digestContainer,
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
    );
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
    const { writeComposeFileSpy } = spyOnProcessComposeHelpers(trigger, composeWithOtherImageStrings);

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);

    const [, updatedCompose] = writeComposeFileSpy.mock.calls[0];
    expect(updatedCompose).toContain('    image: nginx:1.1.0');
    expect(updatedCompose).toContain('MIRROR_IMAGE=nginx:1.0.0');
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
    );
  });

  // -----------------------------------------------------------------------
  // compose command execution
  // -----------------------------------------------------------------------

  test('updateContainerWithCompose should skip compose commands in dry-run mode', async () => {
    trigger.configuration.dryrun = true;
    const runComposeCommandSpy = vi.spyOn(trigger, 'runComposeCommand').mockResolvedValue();
    const container = { name: 'nginx', watcher: 'local' };

    await trigger.updateContainerWithCompose('/opt/drydock/test/stack.yml', 'nginx', container);

    expect(runComposeCommandSpy).not.toHaveBeenCalled();
    expect(mockLog.child).toHaveBeenCalledWith({ container: 'nginx' });
    expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('dry-run mode is enabled'));
  });

  test('updateContainerWithCompose should run pull then up for the target service', async () => {
    trigger.configuration.dryrun = false;
    const runComposeCommandSpy = vi.spyOn(trigger, 'runComposeCommand').mockResolvedValue();
    mockDockerApi.getContainer.mockReturnValueOnce({
      inspect: vi.fn().mockResolvedValue({
        State: { Running: true },
      }),
    });
    const container = { name: 'nginx', watcher: 'local' };

    await trigger.updateContainerWithCompose('/opt/drydock/test/stack.yml', 'nginx', container);

    expect(runComposeCommandSpy).toHaveBeenNthCalledWith(
      1,
      '/opt/drydock/test/stack.yml',
      ['pull', 'nginx'],
      mockLog,
    );
    expect(runComposeCommandSpy).toHaveBeenNthCalledWith(
      2,
      '/opt/drydock/test/stack.yml',
      ['up', '-d', '--no-deps', 'nginx'],
      mockLog,
    );
  });

  test('updateContainerWithCompose should preserve stopped runtime state', async () => {
    trigger.configuration.dryrun = false;
    const runComposeCommandSpy = vi.spyOn(trigger, 'runComposeCommand').mockResolvedValue();
    mockDockerApi.getContainer.mockReturnValueOnce({
      inspect: vi.fn().mockResolvedValue({
        State: { Running: false },
      }),
    });
    const container = { name: 'nginx', watcher: 'local' };

    await trigger.updateContainerWithCompose('/opt/drydock/test/stack.yml', 'nginx', container);

    expect(runComposeCommandSpy).toHaveBeenNthCalledWith(
      1,
      '/opt/drydock/test/stack.yml',
      ['pull', 'nginx'],
      mockLog,
    );
    expect(runComposeCommandSpy).toHaveBeenNthCalledWith(
      2,
      '/opt/drydock/test/stack.yml',
      ['up', '--no-start', '--no-deps', 'nginx'],
      mockLog,
    );
  });

  test('updateContainerWithCompose should add force-recreate argument when requested', async () => {
    trigger.configuration.dryrun = false;
    const runComposeCommandSpy = vi.spyOn(trigger, 'runComposeCommand').mockResolvedValue();
    const container = { name: 'nginx', watcher: 'local' };

    await trigger.updateContainerWithCompose('/opt/drydock/test/stack.yml', 'nginx', container, {
      shouldStart: true,
      skipPull: true,
      forceRecreate: true,
    });

    expect(runComposeCommandSpy).toHaveBeenCalledTimes(1);
    expect(runComposeCommandSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/stack.yml',
      ['up', '-d', '--no-deps', '--force-recreate', 'nginx'],
      mockLog,
    );
  });

  test('stopAndRemoveContainer should be a no-op with compose lifecycle log', async () => {
    await trigger.stopAndRemoveContainer({}, {}, { name: 'nginx' }, mockLog);

    expect(mockLog.info).toHaveBeenCalledWith(
      'Skip direct stop/remove for compose-managed container nginx; using compose lifecycle',
    );
  });

  test('recreateContainer should rewrite compose service image and recreate via compose lifecycle', async () => {
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
    const composeUpdateSpy = vi.spyOn(trigger, 'updateContainerWithCompose').mockResolvedValue();
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
    expect(composeUpdateSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/stack.yml',
      'nginx',
      container,
      {
        shouldStart: false,
        skipPull: true,
        forceRecreate: true,
      },
    );
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

  test('executeSelfUpdate should run compose-native self-update strategy', async () => {
    trigger.configuration.dryrun = false;
    const container = makeContainer({
      name: 'drydock',
      imageName: 'codeswhat/drydock',
      labels: {
        'dd.compose.file': '/opt/drydock/test/stack.yml',
        'com.docker.compose.service': 'drydock',
      },
    });

    trigger._composeContextMap.set('drydock', {
      composeFile: '/opt/drydock/test/stack.yml',
      service: 'drydock',
      serviceDefinition: {},
    });

    const insertBackupSpy = vi.spyOn(trigger, 'insertContainerImageBackup');
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
    );

    expect(updated).toBe(true);
    expect(insertBackupSpy).toHaveBeenCalledTimes(1);
    expect(composeUpdateSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/stack.yml',
      'drydock',
      container,
    );
    expect(hooksSpy).toHaveBeenCalledWith(container, 'drydock', {});
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
    trigger._composeContextMap.set('drydock', {
      composeFile: '/opt/drydock/test/stack.yml',
      service: 'drydock',
      serviceDefinition: {},
    });
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
      {
        name: 'drydock',
      },
      mockLog,
    );

    expect(updated).toBe(false);
    expect(composeUpdateSpy).not.toHaveBeenCalled();
    expect(hooksSpy).not.toHaveBeenCalled();
    expect(mockLog.info).toHaveBeenCalledWith(
      'Do not replace the existing container because dry-run mode is enabled',
    );
  });

  test('runComposeCommand should use docker compose when available', async () => {
    const logContainer = { debug: vi.fn(), warn: vi.fn() };

    await trigger.runComposeCommand('/opt/drydock/test/stack.yml', ['pull', 'nginx'], logContainer);

    expect(execFile).toHaveBeenCalledWith(
      'docker',
      ['compose', '-f', '/opt/drydock/test/stack.yml', 'pull', 'nginx'],
      expect.objectContaining({
        cwd: '/opt/drydock/test',
      }),
      expect.any(Function),
    );
    expect(logContainer.warn).not.toHaveBeenCalled();
  });

  test('runComposeCommand should fall back to docker-compose when docker compose plugin is missing', async () => {
    execFile
      .mockImplementationOnce((_command, _args, _options, callback) => {
        const error = new Error('compose plugin missing');
        error.stderr = "docker: 'compose' is not a docker command.";
        callback(error, '', error.stderr);
        return {};
      })
      .mockImplementationOnce((_command, _args, _options, callback) => {
        callback(null, '', '');
        return {};
      });

    const logContainer = { debug: vi.fn(), warn: vi.fn() };

    await trigger.runComposeCommand('/opt/drydock/test/stack.yml', ['pull', 'nginx'], logContainer);

    expect(execFile).toHaveBeenNthCalledWith(
      1,
      'docker',
      ['compose', '-f', '/opt/drydock/test/stack.yml', 'pull', 'nginx'],
      expect.objectContaining({ cwd: '/opt/drydock/test' }),
      expect.any(Function),
    );
    expect(execFile).toHaveBeenNthCalledWith(
      2,
      'docker-compose',
      ['-f', '/opt/drydock/test/stack.yml', 'pull', 'nginx'],
      expect.objectContaining({ cwd: '/opt/drydock/test' }),
      expect.any(Function),
    );
    expect(logContainer.warn).toHaveBeenCalledWith(
      expect.stringContaining('trying docker-compose'),
    );
  });

  test('runComposeCommand should throw when compose command fails', async () => {
    execFile.mockImplementationOnce((_command, _args, _options, callback) => {
      callback(new Error('boom'), '', 'boom');
      return {};
    });

    const logContainer = { debug: vi.fn(), warn: vi.fn() };

    await expect(
      trigger.runComposeCommand('/opt/drydock/test/stack.yml', ['pull', 'nginx'], logContainer),
    ).rejects.toThrow(
      'Error when running docker compose pull nginx for /opt/drydock/test/stack.yml (boom)',
    );

    expect(execFile).toHaveBeenCalledTimes(1);
  });

  test('runComposeCommand should handle failures without stderr payload', async () => {
    execFile.mockImplementationOnce((_command, _args, _options, callback) => {
      callback(new Error('boom-without-stderr'), '', undefined);
      return {};
    });

    const logContainer = { debug: vi.fn(), warn: vi.fn() };

    await expect(
      trigger.runComposeCommand('/opt/drydock/test/stack.yml', ['pull', 'nginx'], logContainer),
    ).rejects.toThrow(
      'Error when running docker compose pull nginx for /opt/drydock/test/stack.yml (boom-without-stderr)',
    );
  });

  test('runComposeCommand should log stdout and stderr output', async () => {
    execFile.mockImplementationOnce((_command, _args, _options, callback) => {
      callback(null, 'pulled image\n', 'minor warning\n');
      return {};
    });
    const logContainer = { debug: vi.fn(), warn: vi.fn() };

    await trigger.runComposeCommand('/opt/drydock/test/stack.yml', ['pull', 'nginx'], logContainer);

    expect(logContainer.debug).toHaveBeenCalledWith(
      expect.stringContaining('docker compose pull nginx stdout:\npulled image'),
    );
    expect(logContainer.debug).toHaveBeenCalledWith(
      expect.stringContaining('docker compose pull nginx stderr:\nminor warning'),
    );
  });

  test('getContainerRunningState should assume running when inspect fails', async () => {
    const logContainer = { warn: vi.fn() };
    mockDockerApi.getContainer.mockReturnValueOnce({
      inspect: vi.fn().mockRejectedValue(new Error('inspect failed')),
    });

    const running = await trigger.getContainerRunningState(
      {
        name: 'nginx',
        watcher: 'local',
      },
      logContainer,
    );

    expect(running).toBe(true);
    expect(logContainer.warn).toHaveBeenCalledWith(
      'Unable to inspect running state for nginx; assuming running (inspect failed)',
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

  test('triggerBatch should group containers by compose file and process each', async () => {
    trigger.configuration.file = '/opt/drydock/test/compose.yml';
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
    trigger.configuration.file = '/opt/drydock/test/compose.yml';
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
    const spy = vi.spyOn(trigger, 'triggerBatch').mockResolvedValue();

    await trigger.trigger(container);

    expect(spy).toHaveBeenCalledWith([container]);
  });

  test('getConfigurationSchema should extend Docker schema with file, backup, composeFileLabel', () => {
    const schema = trigger.getConfigurationSchema();
    expect(schema).toBeDefined();
    const { error } = schema.validate({
      prune: false,
      dryrun: false,
      autoremovetimeout: 10000,
      file: '/opt/drydock/test/compose.yml',
      backup: true,
      composeFileLabel: 'dd.compose.file',
    });
    expect(error).toBeUndefined();
  });

  test('normalizeImplicitLatest should return input when image is empty or already digest/tag qualified', () => {
    expect(testable_normalizeImplicitLatest('')).toBe('');
    expect(testable_normalizeImplicitLatest('alpine@sha256:abc')).toBe('alpine@sha256:abc');
    expect(testable_normalizeImplicitLatest('nginx:1.0.0')).toBe('nginx:1.0.0');
  });

  test('normalizeImplicitLatest should append latest even when image path ends with slash', () => {
    expect(testable_normalizeImplicitLatest('repo/')).toBe('repo/:latest');
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
});
