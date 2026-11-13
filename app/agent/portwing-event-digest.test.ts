// Real AgentClient, EdgeAgentAdapter, controller-side native watcher, in-memory
// store and Docker Hub provider. Only the Docker daemon (via the bridge) and
// registry HTTP responses are stubbed; nothing touches the network.
import { EventEmitter } from 'node:events';
import Dockerode from 'dockerode';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Container } from '../model/container.js';
import Hub from '../registries/providers/hub/Hub.js';
import * as registry from '../registry/index.js';
import * as containers from '../store/container.js';
import * as store from '../store/index.js';
import { _resetControllerLocalContainerIdsForTests } from '../watchers/controller-local-container-ids.js';
import type Docker from '../watchers/providers/docker/Docker.js';
import { AgentClient } from './AgentClient.js';
import type AgentWatcher from './components/AgentWatcher.js';
import { EdgeAgentAdapter } from './EdgeAgentAdapter.js';
import { PortwingDockerBridge } from './PortwingDockerBridge.js';

vi.mock('../watchers/providers/docker/release-notes-enrichment.js', () => ({
  enrichContainerWithReleaseNotes: vi.fn().mockResolvedValue(undefined),
}));

const ID = 'a'.repeat(64);
const IMAGE_ID = `sha256:${'c'.repeat(64)}`;
const RUNNING_DIGEST = `sha256:${'d'.repeat(64)}`;
const REGISTRY_DIGEST = `sha256:${'e'.repeat(64)}`; // `latest` has moved on
const AGENT = 'edge1';
const REF = 'louislam/uptime-kuma:latest';
const labels = { 'dd.watch': 'true', 'dd.action.exclude': 'all' };

// Container as Portwing 1.2.0 sends it (internal/adapter/drydock/wire.go).
const portwingRecord = () => ({
  id: ID,
  name: 'target',
  displayName: 'target',
  status: 'running',
  watcher: 'docker',
  agent: AGENT,
  image: {
    id: IMAGE_ID,
    registry: { name: 'unknown', url: 'docker.io' },
    name: 'louislam/uptime-kuma',
    tag: { value: 'latest', semver: false },
    digest: { watch: false },
    architecture: 'arm64',
    os: 'linux',
  },
  updateAvailable: false,
  updateKind: { kind: 'unknown' },
  labels: { ...labels },
});

class TestSocket extends EventEmitter {
  send = vi.fn();
  close() {}
}

let client: AgentClient;
let socket: TestSocket;
let adapter: EdgeAgentAdapter;
let nativeWatcher: Docker;
let hub: Hub;
const manifestLookups = vi.fn();

async function frame(type: string, data: unknown) {
  socket.emit('message', JSON.stringify({ type, data }));
  await (adapter as unknown as { orderedStateFrameChain: Promise<void> }).orderedStateFrameChain;
  await new Promise((resolve) => setTimeout(resolve, 50)); // event-driven refresh settles
}
const stored = () => containers.getContainer(ID) as Container;

beforeEach(async () => {
  _resetControllerLocalContainerIdsForTests();
  await store.init({ memory: true });
  vi.spyOn(PortwingDockerBridge.prototype, 'start').mockResolvedValue({
    baseUrl: 'http://127.0.0.1:1',
    host: '127.0.0.1',
    port: 1,
    authorization: 'Bearer test',
  } as never);
  vi.spyOn(Dockerode.prototype, 'listContainers').mockResolvedValue([
    {
      Id: ID,
      Names: ['/target'],
      Image: REF,
      ImageID: IMAGE_ID,
      State: 'running',
      Labels: { ...labels },
      Ports: [],
      Mounts: [],
      HostConfig: { NetworkMode: 'default' },
      NetworkSettings: { Networks: {} },
    },
  ] as never);
  vi.spyOn(Dockerode.prototype, 'getImage').mockImplementation((() => ({
    inspect: vi.fn().mockResolvedValue({
      Id: IMAGE_ID,
      RepoTags: [REF],
      RepoDigests: [`louislam/uptime-kuma@${RUNNING_DIGEST}`],
      Architecture: 'arm64',
      Os: 'linux',
      Config: { Labels: {} },
    }),
  })) as never);
  vi.spyOn(Dockerode.prototype, 'getContainer').mockImplementation((() => ({
    inspect: vi.fn().mockResolvedValue({
      Id: ID,
      Name: '/target',
      Image: IMAGE_ID,
      Config: { Image: REF, Labels: { ...labels } },
      State: { Status: 'running' },
    }),
  })) as never);

  hub = new Hub();
  await hub.register('registry', 'hub', 'public', {} as never);
  vi.spyOn(hub, 'getTags').mockResolvedValue(['latest'] as never);
  vi.spyOn(hub, 'getImageManifestDigest').mockImplementation(async (_image, localDigest) => {
    manifestLookups();
    return { digest: localDigest ? RUNNING_DIGEST : REGISTRY_DIGEST, version: 2 } as never;
  });
  vi.spyOn(hub, 'getImagePublishedAt').mockResolvedValue(undefined as never);
  registry.getState().registry[hub.getId()] = hub as never;

  client = new AgentClient(AGENT, { host: '127.0.0.1', port: 1, secret: '' } as never);
  socket = new TestSocket();
  adapter = new EdgeAgentAdapter(client, socket as never);
  client.edgeAdapter = adapter;
  adapter.activate();
  await frame('dd:component_sync', {
    watchers: [
      {
        type: 'docker',
        name: 'docker',
        configuration: { transport: 'docker-api', execution: 'controller', events: 'portwing' },
      },
    ],
    triggers: [],
  });
  const agentWatcher = registry.getState().watcher[`${AGENT}.docker.docker`] as AgentWatcher;
  nativeWatcher = (agentWatcher as unknown as { controllerWatcher: Docker }).controllerWatcher;
  nativeWatcher.watchCron?.stop();
  clearTimeout(nativeWatcher.watchCronTimeout);
  manifestLookups.mockClear();
});

afterEach(async () => {
  await adapter?.onDisconnect();
  client?.stop();
  await registry.deregisterAgentComponents(AGENT);
  delete registry.getState().registry[hub.getId()];
  vi.restoreAllMocks();
  _resetControllerLocalContainerIdsForTests();
});

test('control: the scheduled native scan detects the digest update', async () => {
  await frame('dd:container_sync', { containers: [portwingRecord()] });
  await nativeWatcher.watch();
  expect(stored().updateAvailable).toBe(true);
  expect(stored().result?.digest).toBe(REGISTRY_DIGEST);
});

test('a dd:container_updated event keeps the detected digest update', async () => {
  await frame('dd:container_sync', { containers: [portwingRecord()] });
  await nativeWatcher.watch();
  expect(stored().updateAvailable).toBe(true);

  // Portwing sends this on any status or health change of the container.
  await frame('dd:container_updated', { container: portwingRecord() });

  expect(stored().updateAvailable).toBe(true);
  expect(stored().result?.digest).toBe(REGISTRY_DIGEST);
});

test('a container that first appears through dd:container_added gets a digest check', async () => {
  await frame('dd:container_added', { container: portwingRecord() });

  expect(manifestLookups).toHaveBeenCalled();
  expect(stored().result?.digest).toBe(REGISTRY_DIGEST);
  expect(stored().updateAvailable).toBe(true);
});

test('an unavailable Docker image does not erase the detected digest update', async () => {
  await frame('dd:container_sync', { containers: [portwingRecord()] });
  await nativeWatcher.watch();
  expect(stored().updateAvailable).toBe(true);
  vi.mocked(Dockerode.prototype.getImage).mockImplementationOnce((() => ({
    inspect: vi.fn().mockRejectedValue(new Error('image unavailable')),
  })) as never);

  await frame('dd:container_updated', { container: portwingRecord() });

  expect(stored().updateAvailable).toBe(true);
  expect(stored().result?.digest).toBe(REGISTRY_DIGEST);
});

test('an event whose container disappeared does not erase the detected digest update', async () => {
  await frame('dd:container_sync', { containers: [portwingRecord()] });
  await nativeWatcher.watch();
  expect(stored().updateAvailable).toBe(true);
  vi.mocked(Dockerode.prototype.listContainers).mockResolvedValueOnce([]);

  await frame('dd:container_updated', { container: portwingRecord() });

  expect(stored().updateAvailable).toBe(true);
  expect(stored().result?.digest).toBe(REGISTRY_DIGEST);
});

test('a full report of the same image retains controller-derived digest facts', async () => {
  await frame('dd:container_sync', { containers: [portwingRecord()] });
  await nativeWatcher.watch();
  expect(stored().updateAvailable).toBe(true);

  await frame('dd:container_sync', { containers: [portwingRecord()] });

  expect(stored().image.digest.repo).toBe(RUNNING_DIGEST);
  expect(stored().image.digest.value).toBe(RUNNING_DIGEST);
  expect(stored().image.digest.repoDigests).toContain(RUNNING_DIGEST);
  expect(stored().updateAvailable).toBe(true);
});

test.each(['id', 'name', 'tag', 'registry'])(
  'a different image %s does not inherit previous digest facts',
  async (field) => {
    await frame('dd:container_sync', { containers: [portwingRecord()] });
    await nativeWatcher.watch();
    const changed = portwingRecord();
    if (field === 'id') changed.image.id = `sha256:${'f'.repeat(64)}`;
    if (field === 'name') changed.image.name = 'library/nginx';
    if (field === 'tag') changed.image.tag.value = '1.0.0';
    if (field === 'registry') changed.image.registry.url = 'quay.io';

    await frame('dd:container_sync', { containers: [changed] });

    expect(stored().image.digest.repo).toBeUndefined();
    expect(stored().image.digest.value).toBeUndefined();
    expect(stored().image.digest.repoDigests).toBeUndefined();
  },
);

test('an untrackable Docker summary does not erase the detected digest update', async () => {
  await frame('dd:container_sync', { containers: [portwingRecord()] });
  await nativeWatcher.watch();
  vi.mocked(Dockerode.prototype.listContainers).mockResolvedValueOnce([
    { Id: ID, Names: ['/target'], Image: '', State: 'running', Labels: labels },
  ] as never);

  await frame('dd:container_updated', { container: portwingRecord() });

  expect(stored().updateAvailable).toBe(true);
  expect(stored().result?.digest).toBe(REGISTRY_DIGEST);
});

test('event image facts come from the running image when a local tag has moved', async () => {
  vi.mocked(Dockerode.prototype.getImage).mockImplementation(((reference: string) => ({
    inspect: vi.fn().mockResolvedValue({
      Id: reference === IMAGE_ID ? IMAGE_ID : `sha256:${'f'.repeat(64)}`,
      RepoTags: [REF],
      RepoDigests: [
        `louislam/uptime-kuma@${reference === IMAGE_ID ? RUNNING_DIGEST : REGISTRY_DIGEST}`,
      ],
      Architecture: 'arm64',
      Os: 'linux',
      Config: { Labels: {} },
    }),
  })) as never);

  await frame('dd:container_added', { container: portwingRecord() });

  expect(stored().image.id).toBe(IMAGE_ID);
  expect(stored().image.digest.value).toBe(RUNNING_DIGEST);
  expect(stored().result?.digest).toBe(REGISTRY_DIGEST);
  expect(stored().updateAvailable).toBe(true);
});
