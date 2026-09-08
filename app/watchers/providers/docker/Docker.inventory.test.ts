import type Dockerode from 'dockerode';
import * as sse from '../../../api/sse.js';
import * as event from '../../../event/index.js';
import * as registry from '../../../registry/index.js';
import * as store from '../../../store/container.js';
import type { Database } from '../../../store/db/driver.js';
import { createContainerFixture } from '../../../test/helpers.js';
import { createMigratedMemoryDatabase } from '../../../test/sqlite-db.js';
import Docker from './Docker.js';

vi.mock('../../../log');

let db: Database;
let docker: Docker;
let list: ReturnType<typeof vi.fn>;
let inspect: ReturnType<typeof vi.fn>;
let imageInspect: ReturnType<typeof vi.fn>;
let unsubscribe: Array<() => void>;

function summary(id = 'new', name = 'service') {
  return { Id: id, Image: 'nginx:1.0.0', Names: [`/${name}`], State: 'running', Labels: {} };
}

function inspection(id = 'new', name = 'service', status = 'running') {
  return {
    Id: id,
    Name: `/${name}`,
    Config: { Image: 'nginx:1.0.0', Labels: {}, Env: ['PASSWORD=secret', 'PUBLIC=value'] },
    State: { Status: status, Health: { Status: 'healthy' } },
  };
}

function seed(id = 'known', overrides = {}) {
  return store.insertContainer(
    createContainerFixture({ id, name: 'service', watcher: 'local', ...overrides }),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  store._resetContainerStoreStateForTests();
  db = createMigratedMemoryDatabase();
  store.createCollections(db);
  docker = new Docker();
  docker.name = 'local';
  docker.type = 'docker';
  docker.configuration = {
    watchbydefault: true,
    discoverysettlems: 30_000,
  } as typeof docker.configuration;
  list = vi.fn().mockResolvedValue([summary()]);
  inspect = vi.fn().mockImplementation(async (id: string) => inspection(id));
  imageInspect = vi.fn().mockResolvedValue({
    Id: 'image-new',
    RepoTags: ['nginx:1.0.0'],
    RepoDigests: ['nginx@sha256:abc'],
    Architecture: 'amd64',
    Os: 'linux',
  });
  docker.dockerApi = {
    listContainers: list,
    getContainer: (id: string) => ({ inspect: () => inspect(id) }),
    getImage: () => ({ inspect: imageInspect }),
  } as unknown as Dockerode;
  vi.spyOn(docker, 'ensureRemoteAuthHeaders').mockResolvedValue(undefined);
  vi.spyOn(registry, 'getState').mockReturnValue({ registry: {}, watcher: {} } as ReturnType<
    typeof registry.getState
  >);
  unsubscribe = [];
});

afterEach(() => {
  sse._resetInitializationStateForTests();
  for (const stop of unsubscribe) stop();
  db.close();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

test('persists immediate discovery without registry checks, reports, full watches, or settle timers', async () => {
  const watch = vi.spyOn(docker, 'watch');
  const getContainers = vi.spyOn(docker, 'getContainers');
  const findNewVersion = vi.spyOn(docker, 'findNewVersion');
  const report = vi.spyOn(event, 'emitContainerReport');
  const reports = vi.spyOn(event, 'emitContainerReports');
  const snapshot = vi.spyOn(event, 'emitWatcherSnapshot');
  const result = await docker.refreshInventory();
  expect(result.authoritative).toBe(true);
  expect(result.errors).toEqual([]);
  expect(result.containers.map((container) => container.id)).toEqual(['new']);
  expect(store.getContainer('new')).toMatchObject({
    name: 'service',
    status: 'running',
    image: { tag: { value: '1.0.0' } },
  });
  await vi.advanceTimersByTimeAsync(120_000);
  for (const call of [watch, getContainers, findNewVersion, report, reports, snapshot])
    expect(call).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

test('returns degraded last-known inventory when enumeration fails', async () => {
  seed();
  list.mockRejectedValue(new Error('socket unavailable'));
  const result = await docker.refreshInventory();
  expect(result.authoritative).toBe(false);
  expect(result.errors).toEqual([{ phase: 'enumerate', message: 'socket unavailable' }]);
  expect(result.containers.map((container) => container.id)).toEqual(['known']);
  expect(result.removedIds).toEqual([]);
});

test.each([403, 500, undefined])(
  'preserves omitted records on non-404 inspection failure (%s)',
  async (statusCode) => {
    const before = seed();
    list.mockResolvedValue([]);
    inspect.mockRejectedValue(Object.assign(new Error('inspect unavailable'), { statusCode }));
    const result = await docker.refreshInventory();
    expect(result.authoritative).toBe(false);
    expect(result.errors).toEqual([
      { phase: 'inspect', id: 'known', message: 'inspect unavailable' },
    ]);
    expect(store.getContainer('known')).toEqual(before);
    expect(result.removedIds).toEqual([]);
  },
);

test('preserves a listed record when inspection fails and continues independent discoveries', async () => {
  const before = seed();
  list.mockResolvedValue([summary('known'), summary('new', 'other')]);
  inspect.mockImplementation(async (id) => {
    if (id === 'known') throw new Error('timed out');
    return inspection(id, 'other');
  });
  const result = await docker.refreshInventory();
  expect(result.authoritative).toBe(false);
  expect(store.getContainer('known')).toEqual(before);
  expect(store.getContainer('new')?.name).toBe('other');
});

test('removes only confirmed missing source-owned records and preserves unrelated agents/watchers', async () => {
  seed();
  seed('remote', { agent: 'edge' });
  seed('other', { watcher: 'elsewhere' });
  list.mockResolvedValue([]);
  inspect.mockRejectedValue(Object.assign(new Error('not found'), { statusCode: 404 }));
  const result = await docker.refreshInventory();
  expect(result).toMatchObject({
    authoritative: true,
    containers: [],
    removedIds: ['known'],
    errors: [],
  });
  expect(store.getContainer('remote')).toBeDefined();
  expect(store.getContainer('other')).toBeDefined();
  expect(inspect).toHaveBeenCalledExactlyOnceWith('known');
});

test('preserves stopped watched containers omitted by the default Docker list', async () => {
  seed();
  list.mockResolvedValue([]);
  inspect.mockResolvedValue(inspection('known', 'service', 'exited'));
  const result = await docker.refreshInventory();
  expect(result.authoritative).toBe(true);
  expect(store.getContainer('known')?.status).toBe('exited');
});

test('merges runtime fields into the latest row without replacing concurrent scan results or policies', async () => {
  seed();
  list.mockResolvedValue([summary('known')]);
  inspect.mockImplementation(async () => {
    store.updateContainerFields('known', {
      result: { tag: '3.0.0' },
      error: { message: 'registry offline' },
      updatePolicyOverrides: { snoozeUntil: '2027-01-01T00:00:00.000Z' },
    });
    return inspection('known', 'service', 'exited');
  });
  const result = await docker.refreshInventory();
  expect(result.authoritative).toBe(true);
  expect(store.getContainer('known')).toMatchObject({
    status: 'exited',
    result: { tag: '3.0.0' },
    error: { message: 'registry offline' },
    updatePolicyOverrides: { snoozeUntil: '2027-01-01T00:00:00.000Z' },
  });
  expect(imageInspect).not.toHaveBeenCalled();
});

test('rejects foreign stored identities rather than overwriting them', async () => {
  const before = seed('new', { agent: 'edge' });
  const result = await docker.refreshInventory();
  expect(result.authoritative).toBe(false);
  expect(result.errors).toEqual([expect.objectContaining({ phase: 'ownership', id: 'new' })]);
  expect(store.getContainer('new')).toEqual(before);
});

test.each(['deregister', 'source', 'newer'] as const)(
  'checks generation and watcher identity before any store mutation (%s)',
  async (change) => {
    const insert = vi.spyOn(store, 'insertContainer');
    const update = vi.spyOn(store, 'updateContainerFields');
    const remove = vi.spyOn(store, 'deleteContainer');
    inspect.mockImplementationOnce(async () => {
      if (change === 'deregister')
        Object.assign(docker, { scanGeneration: 1, isWatcherDeregistered: true });
      if (change === 'source') docker.configuration.socket = '/different.sock';
      if (change === 'newer') Object.assign(docker, { controllerLocalEnumerationGeneration: 2 });
      return inspection();
    });
    const result = await docker.refreshInventory();
    expect(result.authoritative).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ phase: 'stale' }));
    for (const call of [insert, update, remove]) expect(call).not.toHaveBeenCalled();
  },
);

test('does not resurrect a record removed while Docker inspection is in flight', async () => {
  seed();
  list.mockResolvedValue([summary('known')]);
  inspect.mockImplementation(async () => {
    store.deleteContainer('known');
    return inspection('known');
  });
  const result = await docker.refreshInventory();
  expect(store.getContainer('known')).toBeUndefined();
  expect(result.authoritative).toBe(false);
});

test('carries retained policy into a confirmed recreation and emits real-store lifecycle events', async () => {
  seed('old', { updatePolicyOverrides: { snoozeUntil: '2027-01-01T00:00:00.000Z' } });
  const added = vi.fn();
  const removed = vi.fn();
  const updated = vi.fn();
  sse.init();
  const broadcast = vi.spyOn(sse._sseEventBuffer, 'push');
  unsubscribe.push(
    event.registerContainerAdded(added),
    event.registerContainerRemoved(removed),
    event.registerContainerUpdated(updated),
  );
  inspect.mockImplementation(async (id) => {
    if (id === 'old') throw Object.assign(new Error('not found'), { statusCode: 404 });
    return inspection(id);
  });
  const result = await docker.refreshInventory();
  expect(result.removedIds).toEqual(['old']);
  expect(store.getContainer('new')).toMatchObject({
    updatePolicyOverrides: { snoozeUntil: '2027-01-01T00:00:00.000Z' },
  });
  expect(removed).toHaveBeenCalledWith(expect.objectContaining({ id: 'old' }));
  expect(added.mock.calls[0][0]).toMatchObject({
    id: 'new',
    details: {
      ports: [],
      volumes: [],
      env: [
        { key: 'PASSWORD', value: '[REDACTED]' },
        { key: 'PUBLIC', value: 'value' },
      ],
    },
  });
  inspect.mockResolvedValue(inspection('new', 'service', 'exited'));
  await docker.refreshInventory();
  expect(updated).toHaveBeenCalledWith(expect.objectContaining({ id: 'new', status: 'exited' }));
  expect(broadcast.mock.calls.map((call) => call[1])).toEqual([
    'dd:container-removed',
    'dd:container-added',
    'dd:container-updated',
  ]);
});

test('retains existing independent timers without adding settlement work', async () => {
  const independent = vi.fn();
  setTimeout(independent, 40_000);
  await docker.refreshInventory();
  expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(40_000);
  expect(independent).toHaveBeenCalledOnce();
});

test('does not discover a transient recreated alias next to its replacement', async () => {
  list.mockResolvedValue([summary('abcdef123456789', 'abcdef123456_service'), summary('new')]);
  inspect.mockImplementation(async (id) =>
    inspection(id, id === 'new' ? 'service' : 'abcdef123456_service'),
  );
  const result = await docker.refreshInventory();
  expect(result.authoritative).toBe(true);
  expect(result.containers.map((container) => container.id)).toEqual(['new']);
});

test('reports a per-target read failure without discarding independent successful observations', async () => {
  list.mockResolvedValue([summary('bad'), summary('new')]);
  const realRead = store.getContainerRaw;
  vi.spyOn(store, 'getContainerRaw').mockImplementation((id) => {
    if (id === 'bad') throw new Error('row unreadable');
    return realRead(id);
  });
  const result = await docker.refreshInventory();
  expect(result.errors).toContainEqual({ phase: 'store', id: 'bad', message: 'row unreadable' });
  expect(store.getContainer('new')).toBeDefined();
});

test.each([undefined, [{ Id: '', Image: 'nginx' }]])(
  'returns a degraded result for malformed Docker listings (%s)',
  async (response) => {
    seed();
    list.mockResolvedValue(response);
    const result = await docker.refreshInventory();
    expect(result.authoritative).toBe(false);
    expect(result.errors[0].phase).toBe('enumerate');
    expect(store.getContainer('known')).toBeDefined();
  },
);

test.each(['mismatch', 'missing-status'])(
  'rejects incomplete or mismatched inspection identity (%s)',
  async (failure) => {
    inspect.mockResolvedValue(
      failure === 'mismatch' ? inspection('wrong') : { ...inspection(), State: {} },
    );
    const result = await docker.refreshInventory();
    expect(result.errors[0]).toMatchObject({ phase: 'inspect', id: 'new' });
    expect(store.getContainer('new')).toBeUndefined();
  },
);

test.each(['rejected', 'missing'])(
  'treats missing effective Swarm labels as degraded (%s)',
  async (mode) => {
    seed('new');
    inspect.mockResolvedValue({
      ...inspection(),
      Config: { Labels: { 'com.docker.swarm.service.id': 'svc' } },
    });
    if (mode === 'rejected')
      docker.dockerApi.getService = vi
        .fn()
        .mockReturnValue({ inspect: vi.fn().mockRejectedValue(new Error('service denied')) });
    const result = await docker.refreshInventory();
    expect(result.authoritative).toBe(false);
    expect(result.errors[0]).toMatchObject({ phase: 'labels', id: 'new' });
    expect(store.getContainer('new')?.status).toBe('unknown');
  },
);

test('removes explicit watch exclusions and does not discover unwatched containers', async () => {
  seed('known');
  list.mockResolvedValue([summary('known'), summary('new')]);
  inspect.mockImplementation(async (id) => ({
    ...inspection(id),
    Config: { Labels: { 'dd.watch': 'false' } },
  }));
  const result = await docker.refreshInventory();
  expect(result).toMatchObject({
    containers: [],
    removedIds: ['known'],
    errors: [],
    authoritative: true,
  });
  expect(imageInspect).not.toHaveBeenCalled();
});

test('refreshes effective Swarm labels without overwriting operator policy overrides', async () => {
  seed('new', { updatePolicyOverrides: { snoozeUntil: '2027-01-01T00:00:00.000Z' } });
  inspect.mockResolvedValue({
    ...inspection(),
    Config: { Labels: { 'com.docker.swarm.service.id': 'svc', 'dd.display.name': 'override' } },
  });
  docker.dockerApi.getService = vi.fn().mockReturnValue({
    inspect: vi.fn().mockResolvedValue({
      Spec: {
        Labels: { 'dd.display.name': 'service' },
        TaskTemplate: { ContainerSpec: { Labels: { 'dd.tag.include': '^1' } } },
      },
    }),
  });
  await docker.refreshInventory();
  expect(store.getContainer('new')).toMatchObject({
    displayName: 'override',
    includeTags: '^1',
    updatePolicyOverrides: { snoozeUntil: '2027-01-01T00:00:00.000Z' },
  });
});

test('reports new image inspection failure and retains the last-known source inventory', async () => {
  seed();
  imageInspect.mockRejectedValue(new Error('image unavailable'));
  const result = await docker.refreshInventory();
  expect(result.errors).toContainEqual({ phase: 'image', id: 'new', message: 'image unavailable' });
  expect(store.getContainer('known')).toBeDefined();
});

test('skips Podman infrastructure rows without an image', async () => {
  list.mockResolvedValue([{ ...summary(), Image: '' }]);
  const result = await docker.refreshInventory();
  expect(result).toMatchObject({ containers: [], errors: [], authoritative: true });
  expect(inspect).not.toHaveBeenCalled();
});

test('uses watchall and keeps agent-owned discovery scoped to its source', async () => {
  docker.configuration.watchall = true;
  docker.agent = 'edge';
  await docker.refreshInventory();
  expect(list).toHaveBeenCalledExactlyOnceWith({ all: true });
  expect(store.getContainer('new')?.agent).toBe('edge');
});

test('returns a store diagnostic when the initial snapshot cannot be read', async () => {
  vi.spyOn(store, 'getContainersRaw').mockImplementation(() => {
    throw new Error('store unavailable');
  });
  const result = await docker.refreshInventory();
  expect(result).toEqual({
    containers: [],
    removedIds: [],
    errors: [{ phase: 'store', message: 'store unavailable' }],
    authoritative: false,
  });
  expect(list).not.toHaveBeenCalled();
});

test('continues after a write failure and reports only confirmed persistence', async () => {
  list.mockResolvedValue([summary('bad'), summary('new')]);
  const realInsert = store.insertContainer;
  vi.spyOn(store, 'insertContainer').mockImplementation((container) => {
    if (container.id === 'bad') throw new Error('write unavailable');
    return realInsert(container);
  });
  const result = await docker.refreshInventory();
  expect(result.errors).toContainEqual({
    phase: 'persist',
    id: 'bad',
    message: 'write unavailable',
  });
  expect(result.containers.map((container) => container.id)).toEqual(['new']);
});

test('stops remaining writes when a lifecycle listener invalidates the watcher', async () => {
  list.mockResolvedValue([summary('first'), summary('second')]);
  unsubscribe.push(
    event.registerContainerAdded(() => {
      docker.name = 'changed';
    }),
  );
  const result = await docker.refreshInventory();
  expect(result.authoritative).toBe(false);
  expect(store.getContainer('first')).toBeDefined();
  expect(store.getContainer('second')).toBeUndefined();
  expect(result.containers.map((container) => container.id)).toEqual(['first']);
});

test('refuses to start on a deregistered watcher', async () => {
  Object.assign(docker, { isWatcherDeregistered: true });
  const result = await docker.refreshInventory();
  expect(result.authoritative).toBe(false);
  expect(list).not.toHaveBeenCalled();
});

test('a newer refresh wins over an older listing without pruning its discoveries', async () => {
  let resolveFirst!: (value: ReturnType<typeof summary>[]) => void;
  list.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveFirst = resolve;
      }),
  );
  const first = docker.refreshInventory();
  await Promise.resolve();
  await docker.refreshInventory();
  resolveFirst([]);
  const stale = await first;
  expect(stale.authoritative).toBe(false);
  expect(stale.containers.map((container) => container.id)).toEqual(['new']);
  expect(store.getContainer('new')).toBeDefined();
});

test('returns a store error if the final persisted snapshot cannot be read', async () => {
  const realRead = store.getContainersRaw;
  let reads = 0;
  vi.spyOn(store, 'getContainersRaw').mockImplementation(() => {
    reads += 1;
    if (reads > 1) throw new Error('final read unavailable');
    return realRead();
  });
  const result = await docker.refreshInventory();
  expect(result.errors).toContainEqual({ phase: 'store', message: 'final read unavailable' });
  expect(result.authoritative).toBe(false);
  expect(store.getContainer('new')).toBeDefined();
});

test.each([true, false])(
  'falls back to the listed name or id when inspect has no name (%s)',
  async (hasListedName) => {
    list.mockResolvedValue([{ ...summary(), Names: hasListedName ? ['/listed'] : [] }]);
    inspect.mockResolvedValue({ ...inspection(), Name: undefined });
    await docker.refreshInventory();
    expect(store.getContainer('new')?.name).toBe(hasListedName ? 'listed' : 'new');
  },
);

test('does not require an image reference to refresh a known stopped container', async () => {
  seed();
  list.mockResolvedValue([]);
  inspect.mockResolvedValue({
    ...inspection('known', 'service', 'exited'),
    Config: undefined,
    Name: undefined,
  });
  const result = await docker.refreshInventory();
  expect(result.authoritative).toBe(true);
  expect(store.getContainer('known')?.status).toBe('exited');
});

test('reports unresolvable new image references without persisting a partial record', async () => {
  vi.spyOn(
    docker as unknown as { resolveImageName: () => undefined },
    'resolveImageName',
  ).mockReturnValue(undefined);
  const result = await docker.refreshInventory();
  expect(result.errors).toContainEqual({
    phase: 'image',
    id: 'new',
    message: 'Unable to resolve the local image reference',
  });
  expect(store.getContainer('new')).toBeUndefined();
});

test.each(['agent', 'name', 'image'])(
  'preserves a row whose identity changed during observation (%s)',
  async (field) => {
    seed('new');
    inspect.mockImplementation(async () => {
      const current = store.getContainerRaw('new')!;
      store.updateContainerFields(
        'new',
        field === 'image'
          ? { image: { ...current.image, id: 'replacement-image' } }
          : { [field]: 'changed' },
      );
      return inspection();
    });
    const result = await docker.refreshInventory();
    expect(result.authoritative).toBe(false);
    expect(result.errors[0]).toMatchObject({ phase: 'ownership', id: 'new' });
    expect(store.getContainer('new')?.status).toBe('unknown');
  },
);

test('merges into a same-source record first persisted by a concurrent full scan', async () => {
  inspect.mockImplementation(async () => {
    seed('new', { result: { tag: '2.0.0' } });
    return inspection();
  });
  const result = await docker.refreshInventory();
  expect(result.authoritative).toBe(true);
  expect(store.getContainer('new')).toMatchObject({ status: 'running', result: { tag: '2.0.0' } });
});

test('the shared discovery builder keeps optional-label support for full watches', async () => {
  const observed = await docker.addImageDetailsToContainer({ ...summary(), Labels: undefined });
  expect(observed?.labels).toEqual({});
  expect(store.getContainer('new')).toBeUndefined();
});

test.each(['abcdef123456_service', 'service-old-1770000000000'])(
  'retains policy when a confirmed recreation leaves its old container temporarily renamed (%s)',
  async (oldName) => {
    const oldId = 'abcdef123456789';
    seed(oldId, { updatePolicyOverrides: { snoozeUntil: '2027-01-01T00:00:00.000Z' } });
    list.mockResolvedValue([summary(oldId, oldName), summary('new')]);
    inspect.mockImplementation(async (id) => inspection(id, id === oldId ? oldName : 'service'));
    const result = await docker.refreshInventory();
    expect(result.removedIds).toEqual([oldId]);
    expect(store.getContainer(oldId)).toBeUndefined();
    expect(store.getContainer('new')).toMatchObject({
      updatePolicyOverrides: { snoozeUntil: '2027-01-01T00:00:00.000Z' },
    });
  },
);

test('does not remove a renamed old container when the replacement cannot be inspected', async () => {
  const oldId = 'abcdef123456789';
  seed(oldId);
  list.mockResolvedValue([summary(oldId, 'abcdef123456_service'), summary('new')]);
  inspect.mockImplementation(async (id) => {
    if (id === 'new') throw new Error('replacement unavailable');
    return inspection(id, 'abcdef123456_service');
  });
  const result = await docker.refreshInventory();
  expect(result.removedIds).toEqual([]);
  expect(store.getContainer(oldId)).toBeDefined();
});

test('does not remove a same-name sibling without an inspected recreation alias', async () => {
  seed('old');
  list.mockResolvedValue([summary('old'), summary('new')]);
  const result = await docker.refreshInventory();
  expect(result.removedIds).toEqual([]);
  expect(store.getContainer('old')).toBeDefined();
});

test('defers a same-identity replacement when its old record cannot be safely reconciled', async () => {
  seed('old', { updatePolicyOverrides: { snoozeUntil: '2027-01-01T00:00:00.000Z' } });
  inspect.mockImplementation(async (id) => {
    if (id === 'old') throw new Error('old inspection unavailable');
    return inspection(id);
  });
  const result = await docker.refreshInventory();
  expect(result.authoritative).toBe(false);
  expect(store.getContainer('old')).toBeDefined();
  expect(store.getContainer('new')).toBeUndefined();
});
