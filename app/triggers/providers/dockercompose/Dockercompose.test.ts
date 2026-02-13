// @ts-nocheck
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import { getState } from '../../../registry/index.js';
import Docker from '../docker/Docker.js';
import Dockercompose, {
  testable_normalizeImplicitLatest,
  testable_normalizePostStartEnvironmentValue,
  testable_normalizePostStartHooks,
} from './Dockercompose.js';

vi.mock('../../../registry', () => ({
  getState: vi.fn(),
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
    },
    access: vi.fn().mockResolvedValue(undefined),
    copyFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(Buffer.from('')),
    writeFile: vi.fn().mockResolvedValue(undefined),
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
    watcher,
    ...rest
  } = overrides as any;

  const container: Record<string, unknown> = {
    name,
    image: {
      name: imageName,
      registry: { name: registryName },
      tag: { value: tagValue },
    },
    updateKind: {
      kind: updateKind,
      remoteValue,
    },
    ...rest,
  };

  if (labels !== undefined) container.labels = labels;
  if (watcher !== undefined) container.watcher = watcher;

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
function spyOnProcessComposeHelpers(triggerInstance, composeFileContent = 'image: nginx:1.0.0') {
  const getComposeFileSpy = vi
    .spyOn(triggerInstance, 'getComposeFile')
    .mockResolvedValue(Buffer.from(composeFileContent));
  const writeComposeFileSpy = vi.spyOn(triggerInstance, 'writeComposeFile').mockResolvedValue();
  const dockerTriggerSpy = vi.spyOn(Docker.prototype, 'trigger').mockResolvedValue();
  const hooksSpy = vi.spyOn(triggerInstance, 'runServicePostStartHooks').mockResolvedValue();
  const backupSpy = vi.spyOn(triggerInstance, 'backup').mockResolvedValue();
  return { getComposeFileSpy, writeComposeFileSpy, dockerTriggerSpy, hooksSpy, backupSpy };
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
      getContainer: vi.fn(),
    };

    getState.mockReturnValue({
      registry: {
        hub: {
          getImageFullName: (image, tag) => `${image.name}:${tag}`,
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

    const dockerTriggerSpy = vi.spyOn(Docker.prototype, 'trigger').mockResolvedValue();

    await trigger.processComposeFile('/opt/drydock/test/portainer.yml', [container]);

    expect(dockerTriggerSpy).toHaveBeenCalledWith(container);
  });

  test('processComposeFile should only trigger containers with actual image changes', async () => {
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

    const dockerTriggerSpy = vi.spyOn(Docker.prototype, 'trigger').mockResolvedValue();

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [
      tagContainer,
      digestContainer,
    ]);

    expect(dockerTriggerSpy).toHaveBeenCalledTimes(1);
    expect(dockerTriggerSpy).toHaveBeenCalledWith(tagContainer);
  });

  test('processComposeFile should skip writes and triggers when no service image changes are needed', async () => {
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

    const { getComposeFileSpy, writeComposeFileSpy, dockerTriggerSpy } =
      spyOnProcessComposeHelpers(trigger);

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);

    expect(getComposeFileSpy).not.toHaveBeenCalled();
    expect(writeComposeFileSpy).not.toHaveBeenCalled();
    expect(dockerTriggerSpy).not.toHaveBeenCalled();
    expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('already up to date'));
  });

  test('processComposeFile should treat implicit latest as up to date', async () => {
    trigger.configuration.dryrun = false;
    const container = makeContainer({
      tagValue: 'latest',
      updateKind: 'digest',
      remoteValue: 'sha256:deadbeef',
    });

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx' } }),
    );

    const { getComposeFileSpy, writeComposeFileSpy, dockerTriggerSpy } =
      spyOnProcessComposeHelpers(trigger);

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);

    expect(getComposeFileSpy).not.toHaveBeenCalled();
    expect(writeComposeFileSpy).not.toHaveBeenCalled();
    expect(dockerTriggerSpy).not.toHaveBeenCalled();
    expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('already up to date'));
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
      'image: nginx:1.1.0',
    );
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

    const { dockerTriggerSpy } = spyOnProcessComposeHelpers(trigger);

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container1, container2]);

    expect(dockerTriggerSpy).toHaveBeenCalledTimes(1);
    expect(dockerTriggerSpy).toHaveBeenCalledWith(container1);
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

    const dockerTriggerSpy = vi.spyOn(Docker.prototype, 'trigger').mockResolvedValue();

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);

    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('No containers found'));
    expect(dockerTriggerSpy).not.toHaveBeenCalled();
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

    const { dockerTriggerSpy } = spyOnProcessComposeHelpers(trigger);

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container1, container2]);

    expect(dockerTriggerSpy).toHaveBeenCalledTimes(1);
    expect(dockerTriggerSpy).toHaveBeenCalledWith(container1);
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

  test('writeComposeFile should log error on write failure', async () => {
    fs.writeFile.mockRejectedValueOnce(new Error('write failed'));

    await trigger.writeComposeFile('/opt/drydock/test/compose.yml', 'data');

    expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining('write failed'));
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
});
