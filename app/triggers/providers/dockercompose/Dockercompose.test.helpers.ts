import { EventEmitter } from 'node:events';
// ---------------------------------------------------------------------------
// Factory helpers to eliminate repeated object literals
// ---------------------------------------------------------------------------

/**
 * Build a container object for tests. Only the fields that vary need to be
 * supplied; sensible defaults cover the rest.
 */
export function makeContainer(overrides: Record<string, unknown> = {}) {
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
export function makeCompose(services: Record<string, unknown>) {
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
export function makeExecMocks({
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

export function makeDockerContainerHandle({
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
export function spyOnProcessComposeHelpers(
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
  const verifySigSpy = vi.spyOn(triggerInstance, 'verifySignaturePreUpdate').mockResolvedValue();
  const scanAndGateSpy = vi.spyOn(triggerInstance, 'scanAndGatePostPull').mockResolvedValue();
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
    verifySigSpy,
    scanAndGateSpy,
    preHookSpy,
    postHookSpy,
    pruneImagesSpy,
    cleanupOldImagesSpy,
    rollbackMonitorSpy,
  };
}

export function setupDockercomposeTestContext({
  DockercomposeCtor,
  watchMock,
  getStateMock,
}: {
  DockercomposeCtor: any;
  watchMock: any;
  getStateMock: any;
}) {
  vi.clearAllMocks();
  vi.mocked(watchMock).mockReset();

  const mockLog = {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };

  const trigger = new DockercomposeCtor();
  trigger.log = mockLog;
  trigger.resetHostToContainerBindMountCache();
  trigger.configuration = {
    dryrun: true,
    backup: false,
    composeFileLabel: 'dd.compose.file',
  };

  const mockDockerApi = {
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

  vi.mocked(getStateMock).mockReturnValue({
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
  } as any);

  return { trigger, mockLog, mockDockerApi };
}
