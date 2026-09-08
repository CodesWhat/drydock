import * as event from '../event/index.js';
import type { InventoryRefreshOptions } from '../model/inventory-refresh.js';
import * as store from '../store/container.js';
import type { Database } from '../store/db/driver.js';
import { createContainerFixture } from '../test/helpers.js';
import { createMigratedMemoryDatabase } from '../test/sqlite-db.js';
import {
  forgetControllerLocalEnumeration,
  recordControllerLocalEnumeration,
} from '../watchers/controller-local-container-ids.js';
import { AgentInventoryRefresh } from './agent-inventory.js';

vi.mock('../log');
vi.mock('../log/index.js');
let db: Database;
let inventory: AgentInventoryRefresh;
let request: ReturnType<typeof vi.fn>;
let connected: boolean;
let options: InventoryRefreshOptions;
let resolve: (value: unknown) => void;

function remote(id = 'new', overrides = {}) {
  return createContainerFixture({ id, watcher: 'local', name: 'service', ...overrides });
}
function context() {
  return {
    origin: 'inventory',
    operationId: options.operationId,
    source: { type: 'docker', name: 'local' },
  };
}
function result(containers: unknown[] = [], overrides = {}) {
  return {
    context: context(),
    containers,
    removedIds: [],
    errors: [],
    authoritative: true,
    ...overrides,
  };
}
function seed(id = 'known', overrides = {}) {
  return store.insertContainer(remote(id, { agent: 'edge', ...overrides }));
}
function frame(kind: string, container: unknown, metadata = context()) {
  inventory.handleEvent(`dd:inventory-${kind}`, { context: metadata, container });
}
beforeEach(() => {
  vi.useFakeTimers();
  store._resetContainerStoreStateForTests();
  db = createMigratedMemoryDatabase();
  store.createCollections(db);
  connected = true;
  request = vi.fn((_type, _name, supplied) => {
    options = supplied;
    return new Promise((done) => {
      resolve = done;
    });
  });
  inventory = new AgentInventoryRefresh({ agent: 'edge', isConnected: () => connected, request });
});
afterEach(() => {
  inventory.invalidate();
  forgetControllerLocalEnumeration({ getId: () => 'docker.controller' });
  event.clearAllListenersForTests();
  db.close();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

test('accepts matching SSE before HTTP and returns persisted agent-scoped inventory without reports', async () => {
  const report = vi.spyOn(event, 'emitContainerReport');
  const reports = vi.spyOn(event, 'emitContainerReports');
  const pending = inventory.refresh('docker', 'local');
  expect(options.operationId).toMatch(/^[0-9a-f-]{36}$/);
  const incoming = remote();
  frame('added', incoming);
  expect(store.getContainerRaw('new')?.agent).toBe('edge');
  resolve(result([incoming]));
  const completed = await pending;
  expect(completed.context).toEqual({
    ...context(),
    source: { type: 'docker', name: 'local', agent: 'edge' },
  });
  expect(completed.containers.map(({ id }) => id)).toEqual(['new']);
  expect(report).not.toHaveBeenCalled();
  expect(reports).not.toHaveBeenCalled();
  await vi.runAllTimersAsync();
  expect(request).toHaveBeenCalledTimes(1);
});

test('ignores unrequested, mismatched, and late inventory frames', async () => {
  const arbitrary = {
    origin: 'inventory',
    operationId: 'arbitrary',
    source: { type: 'docker', name: 'local' },
  };
  frame('added', remote(), arbitrary);
  const pending = inventory.refresh('docker', 'local');
  frame('added', remote(), arbitrary);
  frame('added', remote(), { ...context(), source: { type: 'docker', name: 'other' } });
  resolve(result());
  await pending;
  frame('added', remote());
  expect(store.getContainersRaw()).toEqual([]);
});

test('repeated frames and HTTP do not overwrite concurrent scan results or runtime fields', async () => {
  seed();
  const pending = inventory.refresh('docker', 'local');
  const incoming = remote('known', { status: 'exited' });
  frame('updated', incoming);
  store.updateContainerFields('known', {
    status: 'restarting',
    sourceRepo: 'https://example.com/new-scan',
    updatePolicyOverrides: { snoozeUntil: '2027-01-01T00:00:00.000Z' },
  });
  frame('updated', incoming);
  resolve(result([incoming]));
  await pending;
  expect(store.getContainerRaw('known')).toMatchObject({
    status: 'restarting',
    sourceRepo: 'https://example.com/new-scan',
    updatePolicyOverrides: { snoozeUntil: '2027-01-01T00:00:00.000Z' },
  });
});

test('own rename remains authoritative across repeated SSE and HTTP without adopting concurrent fields', async () => {
  const previous = seed();
  const pending = inventory.refresh('docker', 'local');
  const renamed = remote('known', { name: 'renamed', status: 'exited' });
  frame('updated', renamed);
  expect(store.getContainerRaw('known')?.identityKey).not.toBe(previous.identityKey);
  store.updateContainerFields('known', { status: 'restarting' });
  frame('updated', renamed);
  resolve(result([renamed]));
  expect(await pending).toMatchObject({ authoritative: true, errors: [] });
  expect(store.getContainerRaw('known')).toMatchObject({ name: 'renamed', status: 'restarting' });
});

test('does not notify when a store update does not persist a row', async () => {
  seed('known', { status: 'running' });
  const onMutation = vi.fn();
  inventory = new AgentInventoryRefresh({
    agent: 'edge',
    isConnected: () => connected,
    request,
    onMutation,
  });
  vi.spyOn(store, 'updateContainerFields').mockReturnValue(undefined);
  const pending = inventory.refresh('docker', 'local');
  frame('updated', remote('known', { status: 'exited' }));
  resolve(result());
  await pending;
  expect(onMutation).not.toHaveBeenCalled();
  expect(store.getContainerRaw('known')?.status).toBe('running');
});

test('confirmed removals precede recreation and retain controller policy', async () => {
  seed('old', { updatePolicyOverrides: { snoozeUntil: '2027-01-01T00:00:00.000Z' } });
  const pending = inventory.refresh('docker', 'local');
  frame('removed', { id: 'old' });
  frame('removed', { id: 'old' });
  frame('added', remote('new'));
  resolve(result([remote('new')], { removedIds: ['old'] }));
  const completed = await pending;
  expect(store.getContainerRaw('old')).toBeUndefined();
  expect(store.getContainerRaw('new')?.updatePolicyOverrides?.snoozeUntil).toBe(
    '2027-01-01T00:00:00.000Z',
  );
  expect(completed.removedIds).toEqual(['old']);
});

test.each([
  {},
  null,
  { authoritative: 'true' },
  { removedIds: [12] },
  { errors: [{ phase: 'unknown', message: 'secret' }] },
  { containers: [remote(), { id: 'invalid' }] },
  {
    context: {
      origin: 'inventory',
      operationId: 'wrong',
      source: { type: 'docker', name: 'local' },
    },
  },
])('validates the whole HTTP envelope before mutation: %j', async (override) => {
  const pending = inventory.refresh('docker', 'local');
  const failed = expect(pending).rejects.toMatchObject({ status: 500 });
  resolve(
    override === null
      ? null
      : Object.keys(override).length === 0
        ? {}
        : result([remote()], override),
  );
  await failed;
  expect(store.getContainersRaw()).toEqual([]);
});

test.each([{ agent: undefined }, { agent: 'other' }, { watcher: 'other' }])(
  'does not claim another owner %j',
  async (owner) => {
    seed('known', owner);
    const pending = inventory.refresh('docker', 'local');
    frame('updated', remote('known', { status: 'exited' }));
    frame('removed', { id: 'known' });
    resolve(result([remote('known', { status: 'exited' })]));
    const completed = await pending;
    expect(store.getContainerRaw('known')?.status).not.toBe('exited');
    expect(completed.authoritative).toBe(false);
  },
);

test('protects locally enumerated ids even before local persistence', async () => {
  recordControllerLocalEnumeration({ getId: () => 'docker.controller' }, ['new']);
  const pending = inventory.refresh('docker', 'local');
  frame('added', remote());
  resolve(result([remote()]));
  expect((await pending).authoritative).toBe(false);
  expect(store.getContainersRaw()).toEqual([]);
});

test('rejects source spoofing and malformed SSE while keeping the active operation', async () => {
  const pending = inventory.refresh('docker', 'local');
  frame('added', remote('new', { agent: 'other' }));
  frame('added', remote('new', { watcher: 'other' }));
  frame('added', { id: 'invalid' });
  inventory.handleEvent('dd:inventory-added', null);
  frame('removed', { id: 3 });
  resolve(result());
  await pending;
  expect(store.getContainersRaw()).toEqual([]);
});

test('newer operations invalidate older SSE and HTTP without discarding the new result', async () => {
  const first = inventory.refresh('docker', 'local');
  const firstContext = context();
  const firstResolve = resolve;
  const second = inventory.refresh('docker', 'local');
  frame('added', remote('stale'), firstContext);
  firstResolve({ ...result([remote('stale')]), context: firstContext });
  expect((await first).authoritative).toBe(false);
  frame('added', remote('fresh'));
  resolve(result([remote('fresh')]));
  expect((await second).containers.map(({ id }) => id)).toEqual(['fresh']);
  expect(store.getContainerRaw('stale')).toBeUndefined();
});

test.each(['abort', 'disconnect', 'invalidate', 'replacement'] as const)(
  'fences late writes after %s',
  async (reason) => {
    const cancellation = new AbortController();
    let current = true;
    const pending = inventory.refresh('docker', 'local', {
      signal: cancellation.signal,
      isCurrent: () => current,
    });
    if (reason === 'abort') cancellation.abort();
    if (reason === 'disconnect') connected = false;
    if (reason === 'invalidate') inventory.invalidate();
    if (reason === 'replacement') current = false;
    frame('added', remote());
    resolve(result([remote()]));
    expect((await pending).authoritative).toBe(false);
    expect(store.getContainersRaw()).toEqual([]);
  },
);

test('times out and fences subsequent native frames and HTTP', async () => {
  const pending = inventory.refresh('docker', 'local');
  const failed = expect(pending).rejects.toMatchObject({ status: 504 });
  await vi.advanceTimersByTimeAsync(30_000);
  await failed;
  frame('added', remote());
  resolve(result([remote()]));
  await Promise.resolve();
  expect(store.getContainersRaw()).toEqual([]);
});

test('returns stale partial state when cancellation makes the transport reject', async () => {
  request.mockImplementation(
    (_type, _name, supplied) =>
      new Promise((_resolve, reject) => {
        supplied.signal.addEventListener('abort', () => reject(new Error('request cancelled')), {
          once: true,
        });
      }),
  );
  const cancellation = new AbortController();
  const pending = inventory.refresh('docker', 'local', { signal: cancellation.signal });
  cancellation.abort();
  await expect(pending).resolves.toMatchObject({ authoritative: false, containers: [] });
});

test('keeps last-known degraded records and never treats absence as confirmed removal', async () => {
  seed();
  const pending = inventory.refresh('docker', 'local');
  resolve(
    result([remote('known', { status: 'exited' })], {
      authoritative: false,
      errors: [{ phase: 'inspect', id: 'known', message: 'secret' }],
    }),
  );
  expect((await pending).errors[0].message).not.toContain('secret');
  expect(store.getContainerRaw('known')?.status).not.toBe('exited');
  const second = inventory.refresh('docker', 'local');
  resolve(result());
  expect((await second).containers.map(({ id }) => id)).toEqual(['known']);
});

test('accepts authoritative empty inventory with only confirmed removals', async () => {
  seed();
  const pending = inventory.refresh('docker', 'local');
  resolve(result([], { removedIds: ['known'] }));
  expect(await pending).toMatchObject({
    containers: [],
    removedIds: ['known'],
    authoritative: true,
  });
});

test('preserves an ordinary write made synchronously by an inventory-added subscriber', async () => {
  const pending = inventory.refresh('docker', 'local');
  event.registerContainerAdded((container, metadata) => {
    if (metadata?.origin === 'inventory')
      store.updateContainerFields(container.id, { status: 'restarting' });
  });
  frame('added', remote('new', { status: 'exited' }));
  resolve(result([remote('new', { status: 'exited' })]));
  await pending;
  expect(store.getContainerRaw('new')?.status).toBe('restarting');
});

test('merges fresh declarative policy while retaining concurrent controller overrides', async () => {
  seed('known', { updatePolicyDeclarative: { env: {}, label: {} } });
  const pending = inventory.refresh('docker', 'local', { operationId: 'controller-chosen' });
  expect(options.operationId).toBe('controller-chosen');
  store.updateContainerFields('known', {
    updatePolicyOverrides: { snoozeUntil: '2027-01-01T00:00:00.000Z' },
  });
  resolve(
    result([
      remote('known', { updatePolicyDeclarative: { env: {}, label: { maturityMode: 'mature' } } }),
    ]),
  );
  await pending;
  expect(store.getContainerRaw('known')?.updatePolicy).toMatchObject({
    maturityMode: 'mature',
    snoozeUntil: '2027-01-01T00:00:00.000Z',
  });
});

test('does not replace concurrent declarative policy', async () => {
  seed();
  const pending = inventory.refresh('docker', 'local');
  store.updateContainerFields('known', {
    updatePolicyDeclarative: { env: {}, label: { maturityMode: 'mature' } },
  });
  resolve(result([remote('known')]));
  await pending;
  expect(store.getContainerRaw('known')?.updatePolicyDeclarative?.label.maturityMode).toBe(
    'mature',
  );
});

test('keeps label-derived configuration coherent with labels changed by a concurrent scan', async () => {
  seed('known', { labels: { 'dd.tag.include': 'stable' }, includeTags: 'stable' });
  const pending = inventory.refresh('docker', 'local');
  store.updateContainerFields('known', {
    labels: { 'dd.tag.include': 'stable', 'dd.display.name': 'fresh' },
    displayName: 'fresh',
  });
  resolve(
    result([
      remote('known', {
        labels: { 'dd.tag.include': 'old' },
        includeTags: 'old',
        status: 'exited',
      }),
    ]),
  );
  await pending;
  expect(store.getContainerRaw('known')).toMatchObject({
    includeTags: 'stable',
    displayName: 'fresh',
    status: 'exited',
  });
});

test('continues after a per-target persistence failure', async () => {
  const pending = inventory.refresh('docker', 'local');
  const insert = vi.spyOn(store, 'insertContainer').mockImplementationOnce(() => {
    throw new Error('private-db-error');
  });
  resolve(result([remote('bad', { name: 'bad' }), remote('good', { name: 'good' })]));
  const completed = await pending;
  expect(completed.errors).toContainEqual({
    phase: 'persist',
    id: 'bad',
    message: 'Unable to save the observed inventory',
  });
  expect(store.getContainerRaw('good')).toBeDefined();
  expect(insert).toHaveBeenCalledTimes(2);
});

test.each(['image', 'rename', 'delete', 'new'] as const)(
  'does not overwrite a concurrent %s identity change',
  async (change) => {
    if (change !== 'new') seed();
    const pending = inventory.refresh('docker', 'local');
    if (change === 'image')
      store.updateContainerFields('known', {
        image: { ...store.getContainerRaw('known')!.image, id: 'changed-image' },
      });
    if (change === 'rename') store.updateContainerFields('known', { name: 'renamed' });
    if (change === 'delete') store.deleteContainer('known');
    if (change === 'new') seed();
    frame('removed', { id: 'known' });
    frame('updated', remote('known', { status: 'exited' }));
    resolve(result([remote('known', { status: 'exited' })]));
    const completed = await pending;
    expect(completed.authoritative).toBe(false);
    expect(store.getContainerRaw('known')?.status).not.toBe('exited');
  },
);

test('does not replace an unconfirmed same-name container', async () => {
  seed('old');
  const pending = inventory.refresh('docker', 'local');
  resolve(result([remote('new')]));
  expect((await pending).authoritative).toBe(false);
  expect(store.getContainerRaw('new')).toBeUndefined();
  expect(store.getContainerRaw('old')).toBeDefined();
});

test('stops remaining removals and inserts when a lifecycle subscriber invalidates the operation', async () => {
  seed('a', { name: 'a' });
  seed('b', { name: 'b' });
  const pending = inventory.refresh('docker', 'local');
  event.registerContainerRemoved(() => inventory.invalidate());
  resolve(result([remote('new')], { removedIds: ['a', 'b'] }));
  await pending;
  expect(store.getContainerRaw('a')).toBeUndefined();
  expect(store.getContainerRaw('b')).toBeDefined();
  expect(store.getContainerRaw('new')).toBeUndefined();
});

test('preserves all known rows on a global degraded read', async () => {
  seed();
  const pending = inventory.refresh('docker', 'local');
  resolve(
    result([], {
      removedIds: ['known'],
      authoritative: false,
      errors: [{ phase: 'enumerate', message: 'private-daemon-error' }],
    }),
  );
  expect((await pending).containers.map(({ id }) => id)).toEqual(['known']);
});

test('does not remove a target whose inspection failed', async () => {
  seed();
  const pending = inventory.refresh('docker', 'local');
  resolve(
    result([], {
      removedIds: ['known'],
      authoritative: false,
      errors: [{ phase: 'inspect', id: 'known', message: 'private' }],
    }),
  );
  expect((await pending).removedIds).toEqual([]);
  expect(store.getContainerRaw('known')).toBeDefined();
});

test('rejects disconnected requests before contacting the agent', async () => {
  connected = false;
  await expect(inventory.refresh('docker', 'local')).rejects.toMatchObject({ status: 503 });
  expect(request).not.toHaveBeenCalled();
});

test.each([
  { containers: [remote('duplicate'), remote('duplicate')] },
  { containers: [remote('both')], removedIds: ['both'] },
  { errors: [null] },
  { errors: [{ phase: 2, message: 'bad' }] },
  { errors: [{ phase: 'inspect', message: 2 }] },
  { errors: [{ phase: 'inspect', message: '', id: 2 }] },
  { removedIds: null },
  { errors: null },
  { containers: null },
])('rejects malformed or ambiguous HTTP result %j', async (override) => {
  const pending = inventory.refresh('docker', 'local');
  const failed = expect(pending).rejects.toMatchObject({ status: 500 });
  resolve(result([], override));
  await failed;
  expect(store.getContainersRaw()).toEqual([]);
});

test('ignores malformed or unrelated event envelopes', async () => {
  const pending = inventory.refresh('docker', 'local');
  for (const value of [
    {},
    { context: {} },
    { context: { source: {} } },
    { context: { source: { type: 'docker', name: 2 } } },
  ])
    inventory.handleEvent('dd:inventory-added', value);
  inventory.handleEvent('unknown', { context: context(), container: remote() });
  frame('removed', null);
  frame('added', remote(), { ...context(), origin: 'scan' });
  resolve(result());
  await pending;
  expect(store.getContainersRaw()).toEqual([]);
});

test('keeps simultaneous watcher operations source-scoped', async () => {
  const requests = new Map<
    string,
    { options: InventoryRefreshOptions; resolve: (value: unknown) => void }
  >();
  request.mockImplementation(
    (_type, name, supplied) =>
      new Promise((done) => requests.set(name, { options: supplied, resolve: done })),
  );
  const local = inventory.refresh('docker', 'local');
  const other = inventory.refresh('docker', 'other');
  for (const name of ['local', 'other']) {
    const active = requests.get(name)!;
    const metadata = {
      origin: 'inventory',
      operationId: active.options.operationId,
      source: { type: 'docker', name },
    };
    const container = remote(name, { watcher: name, name });
    inventory.handleEvent('dd:inventory-added', { context: metadata, container });
    active.resolve({
      context: metadata,
      containers: [container],
      removedIds: [],
      errors: [],
      authoritative: true,
    });
  }
  expect((await local).containers.map(({ id }) => id)).toEqual(['local']);
  expect((await other).containers.map(({ id }) => id)).toEqual(['other']);
});
