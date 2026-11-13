import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import * as registry from '../../../registry/index.js';
import * as store from '../../../store/index.js';
import DockerTrigger from '../../../triggers/providers/docker/Docker.js';
import Docker from './Docker.js';

const IMAGE_ID = `sha256:${'c'.repeat(64)}`;
let watcher: Docker;

beforeEach(async () => {
  await store.init({ memory: true });
  watcher = new Docker();
  watcher.initWatcher = async () => {
    watcher.dockerApi = {
      listContainers: vi.fn().mockResolvedValue([]),
      getImage: vi.fn(() => ({
        inspect: vi.fn().mockResolvedValue({
          Id: IMAGE_ID,
          RepoTags: ['nginx:1.27.0'],
          RepoDigests: [`nginx@sha256:${'d'.repeat(64)}`],
          Architecture: 'arm64',
          Os: 'linux',
          Config: { Labels: {} },
        }),
      })),
      getContainer: vi.fn(() => ({ inspect: vi.fn().mockResolvedValue({ State: {} }) })),
    } as never;
  };
  // The same registration AgentWatcher.init() performs for its controller-side delegate.
  await watcher.register('watcher', 'docker', 'docker', { watchevents: false } as never, 'edge1');
  registry.getState().watcher['edge1.docker.docker'] = watcher as never;
});

afterEach(async () => {
  delete registry.getState().watcher['edge1.docker.docker'];
  await watcher.deregister();
  vi.restoreAllMocks();
});

test('a container first discovered by an agent-owned native watcher belongs to that agent', async () => {
  const created = await watcher.addImageDetailsToContainer({
    Id: 'a'.repeat(64),
    Names: ['/web'],
    Image: 'nginx:1.27.0',
    ImageID: IMAGE_ID,
    State: 'running',
    Labels: { 'dd.watch': 'true' },
    Ports: [],
    Mounts: [],
    HostConfig: { NetworkMode: 'default' },
    NetworkSettings: { Networks: {} },
  } as never);

  expect(created?.agent).toBe('edge1');
  // The Docker action builds `${agent}.docker.${watcher}` only when `agent` is set;
  // without it this resolves `docker.docker` and throws "No watcher found".
  expect(DockerTrigger.prototype.getWatcher.call({}, created)).toBe(watcher);
});
