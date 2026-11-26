import type { Container } from '../../../model/container.js';
import { getImagePreload, resetImagePreloads } from '../../../updates/image-preload-state.js';
import type Trigger from '../Trigger.js';
import {
  configurationValid,
  createMockLog,
  docker,
  registerCommonDockerBeforeEach,
} from './Docker.test.helpers.js';
import {
  acquirePullSlot,
  getPullPacingState,
  reportPullThrottle,
  resetPullPacing,
} from './pull-pacing.js';

registerCommonDockerBeforeEach();

type Preloader = {
  evaluate: (container: Container) => unknown;
  handleReport: (container: Container) => Promise<void>;
  idle: () => Promise<void>;
  start: () => void;
  stop: () => void;
};
const preloader = (docker as unknown as { imagePreloader: Preloader }).imagePreloader;

const container = {
  id: 'c1',
  name: 'web',
  watcher: 'local',
  image: {
    name: 'a/b',
    registry: { name: 'hub', url: 'registry-1.docker.io' },
    tag: { value: '1' },
  },
  result: { tag: '2', digest: 'sha256:abc' },
} as unknown as Container;

function pullApi() {
  let finish: () => void = () => undefined;
  const dockerApi = {
    pull: vi.fn().mockResolvedValue({}),
    modem: {
      followProgress: vi.fn((_stream, done) => {
        finish = () => done(null, []);
      }),
    },
  };
  return { dockerApi, finish: () => finish() };
}

beforeEach(() => {
  vi.useFakeTimers();
  resetPullPacing();
  resetImagePreloads();
  (docker.pullImage as unknown as { mockRestore?: () => void }).mockRestore?.();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetPullPacing();
  resetImagePreloads();
  vi.useRealTimers();
  docker.configuration = { ...configurationValid };
});

describe('configuration', () => {
  test('preload is off by default with bounded defaults', () => {
    const configuration = docker.validateConfiguration({});
    expect(configuration.preload).toBe(false);
    expect(configuration.preloadconcurrency).toBe(1);
    expect(configuration.preloadmaxcandidates).toBe(5);
  });

  test.each([
    [true, true],
    ['true', true],
    ['label', 'label'],
  ])('preload=%s is accepted', (value, expected) => {
    expect(docker.validateConfiguration({ preload: value }).preload).toBe(expected);
  });

  test.each(['preloadconcurrency', 'preloadmaxcandidates'])(
    '%s takes a positive integer',
    (key) => {
      expect(docker.validateConfiguration({ [key]: 3 })[key]).toBe(3);
      expect(docker.validateConfiguration({ [key]: '2' })[key]).toBe(2);
    },
  );

  test.each([
    ['preloadconcurrency', 0],
    ['preloadconcurrency', -1],
    ['preloadconcurrency', 1.5],
    ['preloadconcurrency', 'many'],
    ['preloadmaxcandidates', 0],
    ['preloadmaxcandidates', -1],
    ['preloadmaxcandidates', 1.5],
    ['preloadmaxcandidates', 'many'],
  ])('%s=%s is rejected', (key, value) => {
    expect(() => docker.validateConfiguration({ [key]: value })).toThrow();
  });

  test('an unknown preload value is rejected', () => {
    expect(() => docker.validateConfiguration({ preload: 'sometimes' })).toThrow();
  });
});

describe('lifecycle', () => {
  test('init starts the preloader and deregister stops it', async () => {
    const parent = Object.getPrototypeOf(Object.getPrototypeOf(docker)) as typeof Trigger.prototype;
    vi.spyOn(parent, 'init').mockResolvedValue(undefined);
    vi.spyOn(parent, 'deregisterComponent').mockResolvedValue(undefined);
    const start = vi.spyOn(preloader, 'start').mockImplementation(() => undefined);
    const stop = vi.spyOn(preloader, 'stop').mockImplementation(() => undefined);
    await docker.init();
    expect(start).toHaveBeenCalledTimes(1);
    await docker.deregisterComponent();
    expect(stop).toHaveBeenCalledTimes(1);
  });
});

describe('rollback backups', () => {
  test('isRollbackTag matches the retained backup tags of the container', async () => {
    const backupStore = await import('../../../store/backup.js');
    vi.mocked(backupStore.getBackupsForContainer).mockReturnValue([{ imageTag: '1' }] as never);
    expect(docker.isRollbackTag(container, '1')).toBe(true);
    vi.mocked(backupStore.getBackupsForContainer).mockReturnValue([{ imageTag: '1' }] as never);
    expect(docker.isRollbackTag(container, '2')).toBe(false);
    vi.mocked(backupStore.getBackupsForContainer).mockReturnValue(undefined as never);
    expect(docker.isRollbackTag(container, '1')).toBe(false);
  });
});

describe('a preload only makes image calls on the Docker API', () => {
  function lifecycleApi(present: boolean) {
    const lifecycle = {
      getContainer: vi.fn(),
      createContainer: vi.fn(),
      listContainers: vi.fn(),
    };
    const api = pullApi();
    const dockerApi = {
      ...lifecycle,
      ...api.dockerApi,
      getImage: vi.fn(() => ({
        inspect: present
          ? vi.fn().mockResolvedValue({})
          : vi.fn().mockRejectedValue(new Error('404')),
      })),
    };
    return { dockerApi, lifecycle, finish: api.finish };
  }

  function arrangeReal(dockerApi: unknown) {
    vi.spyOn(preloader, 'evaluate').mockReturnValue({ preload: true });
    vi.spyOn(docker, 'getWatcher').mockReturnValue({ dockerApi } as never);
    vi.spyOn(docker, 'resolveRegistryManager').mockReturnValue({
      getAuthPull: vi.fn().mockResolvedValue(undefined),
      getImageFullName: (_image: unknown, ref: string) => `a/b@${ref}`,
    } as never);
    docker.log = createMockLog('info', 'warn', 'debug') as never;
  }

  test.each([
    ['already cached', true],
    ['newly pulled', false],
  ])('%s', async (_name, present) => {
    const { dockerApi, lifecycle, finish } = lifecycleApi(present);
    arrangeReal(dockerApi);
    await preloader.handleReport(container);
    await vi.advanceTimersByTimeAsync(0);
    finish();
    await preloader.idle();
    expect(getImagePreload(container)?.status).toBe('done');
    expect(dockerApi.getImage).toHaveBeenCalledWith('a/b@sha256:abc');
    expect(dockerApi.pull).toHaveBeenCalledTimes(present ? 0 : 1);
    for (const spy of Object.values(lifecycle)) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});

describe('pull pacing integration', () => {
  function arrange() {
    const api = pullApi();
    vi.spyOn(preloader, 'evaluate').mockReturnValue({ preload: true });
    vi.spyOn(docker, 'getWatcher').mockReturnValue({ dockerApi: api.dockerApi } as never);
    vi.spyOn(docker, 'resolveRegistryManager').mockReturnValue({
      getAuthPull: vi.fn().mockResolvedValue(undefined),
      getImageFullName: (_image: unknown, ref: string) => `a/b@${ref}`,
    } as never);
    vi.spyOn(docker, 'isImageOnHost').mockResolvedValue(false);
    docker.log = createMockLog('info', 'warn', 'debug') as never;
    return api;
  }

  test('a throttled registry defers the preload pull until the backoff ends', async () => {
    const api = arrange();
    reportPullThrottle('docker.io', 20_000);
    await preloader.handleReport(container);
    await vi.advanceTimersByTimeAsync(19_999);
    expect(api.dockerApi.pull).not.toHaveBeenCalled();
    expect(getImagePreload(container)?.status).toBe('pending');

    await vi.advanceTimersByTimeAsync(1);
    expect(api.dockerApi.pull).toHaveBeenCalledWith(
      'a/b@sha256:abc',
      expect.objectContaining({ authconfig: undefined }),
    );
    api.finish();
    await preloader.idle();
    expect(getImagePreload(container)?.status).toBe('done');
    expect(getPullPacingState('docker.io').active).toBe(0);
  });

  test('a preload waits for a pull slot held by another pull', async () => {
    docker.configuration = { ...configurationValid, pullconcurrency: 1 };
    const api = arrange();
    const release = await acquirePullSlot('docker.io', { limit: 1 });
    await preloader.handleReport(container);
    await vi.advanceTimersByTimeAsync(0);
    expect(api.dockerApi.pull).not.toHaveBeenCalled();

    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(api.dockerApi.pull).toHaveBeenCalledTimes(1);
    api.finish();
    await preloader.idle();
    expect(getPullPacingState('docker.io').active).toBe(0);
  });
});
