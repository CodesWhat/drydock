import { generateKeyPairSync, verify } from 'node:crypto';
import axios from 'axios';
import * as event from '../event/index.js';
import * as registry from '../registry/index.js';
import * as store from '../store/container.js';
import type { Database } from '../store/db/driver.js';
import { createContainerFixture } from '../test/helpers.js';
import { createMigratedMemoryDatabase } from '../test/sqlite-db.js';
import { AgentClient } from './AgentClient.js';
import * as agentEvents from './api/event.js';
import { bodySha256Hex, buildCanonicalMessage } from './ed25519-signer.js';

vi.mock('axios');
vi.mock('../registry/index.js', () => ({
  getState: vi.fn(),
  registerComponent: vi.fn(),
  deregisterAgentComponents: vi.fn(),
}));
vi.mock('../log/index.js');
let db: Database;
let client: AgentClient;
let state: { watcher: Record<string, unknown> };
const descriptor = {
  type: 'docker',
  name: 'Exact / name',
  configuration: {},
  metadata: { inventoryRefreshSupported: true },
};
beforeEach(async () => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  store._resetContainerStoreStateForTests();
  db = createMigratedMemoryDatabase();
  store.createCollections(db);
  state = { watcher: { 'edge.docker.Exact / name': {} } };
  vi.mocked(registry.getState).mockReturnValue(state as never);
  client = new AgentClient('edge', {
    host: 'https://agent.example',
    port: 443,
    secret: 'shared-secret',
  });
  client.isConnected = true;
  await client.handleComponentSync([descriptor], []);
});
afterEach(() => {
  agentEvents._resetAgentEventStateForTests();
  client.stop();
  event.clearAllListenersForTests();
  db.close();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

test('signs the operation identity in the native request body when using Ed25519', async () => {
  client.stop();
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  client = new AgentClient('edge', {
    host: 'https://agent.example',
    port: 443,
    secret: '',
    authmode: 'ed25519',
    signingkeyid: 'inventory-key',
    signingkey: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
  });
  client.isConnected = true;
  await client.handleComponentSync([descriptor], []);
  vi.mocked(axios.post).mockImplementation(async (_url, body) => ({
    data: {
      context: {
        origin: 'inventory',
        operationId: (body as { operationId: string }).operationId,
        source: { type: 'docker', name: descriptor.name },
      },
      containers: [],
      removedIds: [],
      errors: [],
      authoritative: true,
    },
  }));
  await client.refreshInventory('docker', descriptor.name);
  const [, body, config] = vi.mocked(axios.post).mock.calls[0];
  const headers = config!.headers as Record<string, string>;
  const canonical = buildCanonicalMessage(
    'POST',
    '/api/watchers/docker/Exact%20%2F%20name/inventory',
    bodySha256Hex(Buffer.from(JSON.stringify(body))),
    Number(headers['X-Portwing-Timestamp']),
    headers['X-Portwing-Nonce'],
  );
  expect(
    verify(
      null,
      Buffer.from(canonical),
      publicKey,
      Buffer.from(headers['X-Portwing-Signature'], 'base64url'),
    ),
  ).toBe(true);
  expect(body).toEqual({ operationId: expect.any(String) });
});

test('replicates real agent store lifecycle frames and raw HTTP without registry enrichment', async () => {
  const agentDb = createMigratedMemoryDatabase();
  const report = vi.spyOn(event, 'emitContainerReport');
  const reports = vi.spyOn(event, 'emitContainerReports');
  const watch = vi.spyOn(client, 'watch');
  const watchContainer = vi.spyOn(client, 'watchContainer');
  store.insertContainer(
    createContainerFixture({
      id: 'old',
      name: 'service',
      watcher: descriptor.name,
      agent: 'edge',
      updatePolicyOverrides: { snoozeUntil: '2027-01-01T00:00:00.000Z' },
    }),
  );
  const write = vi.fn(() => true);
  agentEvents.initEvents();
  agentEvents.subscribeEvents(
    { ip: '127.0.0.1', on: vi.fn() } as never,
    { writeHead: vi.fn(), write } as never,
  );
  vi.mocked(axios.post).mockImplementation(async (_url, body) => {
    const context = {
      origin: 'inventory' as const,
      operationId: (body as { operationId: string }).operationId,
      source: { type: 'docker' as const, name: descriptor.name },
    };
    store.createCollections(agentDb);
    store.insertContainer(
      createContainerFixture({ id: 'old', name: 'service', watcher: descriptor.name }),
    );
    write.mockClear();
    store.deleteContainer('old', { replacementExpected: true, context });
    store.insertContainer(
      createContainerFixture({ id: 'new', name: 'service', watcher: descriptor.name }),
      context,
    );
    store.updateContainerFields(
      'new',
      {
        status: 'exited',
        details: { ports: [], volumes: [], env: [{ key: 'PASSWORD', value: 'actual-secret' }] },
      },
      context,
    );
    const containers = store.getContainersRaw();
    const frames = write.mock.calls.map(([line]) => JSON.parse(String(line).slice(6)));
    store.createCollections(db);
    for (const frame of frames) await client.handleEvent(frame.type, frame.data);
    expect(frames.map(({ type }) => type)).toEqual([
      'dd:inventory-removed',
      'dd:inventory-added',
      'dd:inventory-updated',
    ]);
    return { data: { context, containers, removedIds: ['old'], errors: [], authoritative: true } };
  });
  try {
    const completed = await client.refreshInventory('docker', descriptor.name);
    expect(completed.containers).toHaveLength(1);
    expect(store.getContainerRaw('new')).toMatchObject({
      status: 'exited',
      updatePolicyOverrides: { snoozeUntil: '2027-01-01T00:00:00.000Z' },
      details: { env: [{ key: 'PASSWORD', value: 'actual-secret' }] },
    });
    expect(store.getContainer('new')?.details?.env[0].value).toBe('[REDACTED]');
    expect(watch).not.toHaveBeenCalled();
    expect(watchContainer).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
    expect(reports).not.toHaveBeenCalled();
  } finally {
    store.createCollections(db);
    agentDb.close();
  }
});

test.each(['added', 'updated', 'removed'])(
  'accepted inventory %s mutations notify other clients through debounced stats',
  async (kind) => {
    if (kind !== 'added')
      store.insertContainer(
        createContainerFixture({ id: 'known', watcher: descriptor.name, agent: 'edge' }),
      );
    await vi.advanceTimersByTimeAsync(1000);
    const stats = vi.spyOn(event, 'emitAgentStatsChanged');
    let beforeDebounce = -1;
    let beforeHttp = -1;
    vi.mocked(axios.post).mockImplementation(async (_url, body) => {
      const context = {
        origin: 'inventory',
        operationId: (body as { operationId: string }).operationId,
        source: { type: 'docker', name: descriptor.name },
      };
      const container = createContainerFixture({
        id: 'known',
        watcher: descriptor.name,
        status: 'exited',
      });
      await client.handleEvent(`dd:inventory-${kind}`, { context, container });
      await client.handleEvent(`dd:inventory-${kind}`, { context, container });
      beforeDebounce = stats.mock.calls.length;
      await vi.advanceTimersByTimeAsync(1000);
      beforeHttp = stats.mock.calls.length;
      return {
        data: {
          context,
          containers: kind === 'removed' ? [] : [container],
          removedIds: kind === 'removed' ? ['known'] : [],
          errors: [],
          authoritative: true,
        },
      };
    });
    await client.refreshInventory('docker', descriptor.name);
    expect(beforeDebounce).toBe(0);
    expect(beforeHttp).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(stats).toHaveBeenCalledTimes(1);
  },
);

test.each(['added', 'updated', 'removed'])(
  'HTTP-only inventory %s mutations notify other clients',
  async (kind) => {
    if (kind !== 'added')
      store.insertContainer(
        createContainerFixture({ id: 'known', watcher: descriptor.name, agent: 'edge' }),
      );
    await vi.advanceTimersByTimeAsync(1000);
    const stats = vi.spyOn(event, 'emitAgentStatsChanged');
    vi.mocked(axios.post).mockImplementation(async (_url, body) => ({
      data: {
        context: {
          origin: 'inventory',
          operationId: (body as { operationId: string }).operationId,
          source: { type: 'docker', name: descriptor.name },
        },
        containers:
          kind === 'removed'
            ? []
            : [createContainerFixture({ id: 'known', watcher: descriptor.name, status: 'exited' })],
        removedIds: kind === 'removed' ? ['known'] : [],
        errors: [],
        authoritative: true,
      },
    }));
    await client.refreshInventory('docker', descriptor.name);
    expect(stats).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(stats).toHaveBeenCalledExactlyOnceWith({ agentName: 'edge' });
  },
);

test('rejected and late inventory frames do not emit false stats changes', async () => {
  store.insertContainer(createContainerFixture({ id: 'local', watcher: 'controller' }));
  await vi.advanceTimersByTimeAsync(1000);
  const stats = vi.spyOn(event, 'emitAgentStatsChanged');
  let late!: { context: unknown; container: unknown };
  vi.mocked(axios.post).mockImplementation(async (_url, body) => {
    const context = {
      origin: 'inventory',
      operationId: (body as { operationId: string }).operationId,
      source: { type: 'docker', name: descriptor.name },
    };
    const container = createContainerFixture({ id: 'local', watcher: descriptor.name });
    await client.handleEvent('dd:inventory-updated', { context, container });
    await client.handleEvent('dd:inventory-added', { context, container: {} });
    await client.handleEvent('dd:inventory-added', {
      context: { ...context, operationId: 'older' },
      container,
    });
    await client.handleEvent('dd:inventory-removed', { context, container: { id: 'missing' } });
    late = { context, container: createContainerFixture({ id: 'late', watcher: descriptor.name }) };
    return { data: { context, containers: [], removedIds: [], errors: [], authoritative: true } };
  });
  await client.refreshInventory('docker', descriptor.name);
  await client.handleEvent('dd:inventory-added', late);
  await vi.advanceTimersByTimeAsync(1000);
  expect(stats).not.toHaveBeenCalled();
  expect(store.getContainerRaw('late')).toBeUndefined();
});

test('ordinary concurrent lifecycle still emits its normal scan report', async () => {
  let resolve!: (data: unknown) => void;
  let operationId!: string;
  vi.mocked(axios.post).mockImplementation((_url, body) => {
    operationId = (body as { operationId: string }).operationId;
    return new Promise((done) => {
      resolve = (data) => done({ data });
    });
  });
  const pending = client.refreshInventory('docker', descriptor.name);
  const report = vi.spyOn(event, 'emitContainerReport');
  await client.handleEvent(
    'dd:container-added',
    createContainerFixture({ id: 'scan', watcher: descriptor.name }),
  );
  expect(report).toHaveBeenCalledTimes(1);
  resolve({
    context: {
      origin: 'inventory',
      operationId,
      source: { type: 'docker', name: descriptor.name },
    },
    containers: [],
    removedIds: [],
    errors: [],
    authoritative: true,
  });
  expect((await pending).containers.map(({ id }) => id)).toEqual(['scan']);
});

test('advertises only explicit current native Docker capability', async () => {
  expect(client.isInventoryRefreshSupported('docker', descriptor.name)).toBe(true);
  expect(client.isInventoryRefreshSupported('docker', 'exact / name')).toBe(false);
  expect(client.isInventoryRefreshSupported('other', descriptor.name)).toBe(false);
  await client.handleComponentSync([{ ...descriptor, metadata: undefined }], []);
  expect(client.isInventoryRefreshSupported('docker', descriptor.name)).toBe(false);
  await expect(client.refreshInventory('docker', descriptor.name)).rejects.toMatchObject({
    status: 501,
  });
  expect(axios.post).not.toHaveBeenCalled();
});

test('authenticates the exact inventory request and admits matching SSE before HTTP', async () => {
  const report = vi.spyOn(event, 'emitContainerReports');
  const single = vi.spyOn(event, 'emitContainerReport');
  const watch = vi.spyOn(client, 'watch');
  const watchContainer = vi.spyOn(client, 'watchContainer');
  vi.mocked(axios.post).mockImplementation(async (url, body, config) => {
    const context = {
      origin: 'inventory',
      operationId: (body as { operationId: string }).operationId,
      source: { type: 'docker', name: descriptor.name },
    };
    const container = createContainerFixture({ id: 'remote', watcher: descriptor.name });
    await client.handleEvent('dd:inventory-added', { context, container });
    expect(store.getContainerRaw('remote')?.agent).toBe('edge');
    return {
      data: { context, containers: [container], removedIds: [], errors: [], authoritative: true },
    };
  });
  const result = await client.refreshInventory('docker', descriptor.name);
  expect(axios.post).toHaveBeenCalledWith(
    'https://agent.example/api/watchers/docker/Exact%20%2F%20name/inventory',
    { operationId: expect.any(String) },
    expect.objectContaining({
      headers: expect.objectContaining({ 'X-Dd-Agent-Secret': 'shared-secret' }),
      signal: expect.any(AbortSignal),
      timeout: 30_000,
    }),
  );
  expect(result.containers.map(({ id }) => id)).toEqual(['remote']);
  expect(watch).not.toHaveBeenCalled();
  expect(watchContainer).not.toHaveBeenCalled();
  expect(report).not.toHaveBeenCalled();
  expect(single).not.toHaveBeenCalled();
  await vi.runAllTimersAsync();
  expect(axios.post).toHaveBeenCalledTimes(1);
});

test.each(['stop', 'disconnect', 'components', 'watcher'] as const)(
  'invalidates native HTTP and SSE after %s replacement',
  async (reason) => {
    let resolve!: (data: unknown) => void;
    let context: unknown;
    vi.mocked(axios.post).mockImplementation((_url, body) => {
      context = {
        origin: 'inventory',
        operationId: (body as { operationId: string }).operationId,
        source: { type: 'docker', name: descriptor.name },
      };
      return new Promise((done) => {
        resolve = (data) => done({ data });
      });
    });
    const pending = client.refreshInventory('docker', descriptor.name);
    if (reason === 'stop') client.stop();
    if (reason === 'disconnect') client.scheduleReconnect();
    if (reason === 'components') await client.handleComponentSync([descriptor], []);
    if (reason === 'watcher') state.watcher['edge.docker.Exact / name'] = {};
    const container = createContainerFixture({ id: 'late', watcher: descriptor.name });
    await client.handleEvent('dd:inventory-added', { context, container });
    resolve({ context, containers: [container], removedIds: [], errors: [], authoritative: true });
    expect((await pending).authoritative).toBe(false);
    expect(store.getContainerRaw('late')).toBeUndefined();
  },
);

test('rejects disconnected native calls before transport', async () => {
  client.isConnected = false;
  await expect(client.refreshInventory('docker', descriptor.name)).rejects.toMatchObject({
    status: 503,
  });
  expect(axios.post).not.toHaveBeenCalled();
});

test.each([501, 503, 504, 404, 418])(
  'maps agent HTTP %s to a sanitized public operation error',
  async (status) => {
    vi.mocked(axios.post).mockRejectedValue({
      response: { status, data: { error: 'private-remote-error' } },
    });
    await expect(client.refreshInventory('docker', descriptor.name)).rejects.toMatchObject({
      status: [501, 503, 504, 404].includes(status) ? status : 500,
    });
  },
);

test('maps network timeouts without exposing transport messages', async () => {
  vi.mocked(axios.post).mockRejectedValue({ code: 'ECONNABORTED', message: 'private-address' });
  await expect(client.refreshInventory('docker', descriptor.name)).rejects.toMatchObject({
    status: 504,
    message: 'Inventory refresh timed out',
  });
});
