import fs from 'node:fs';
import path from 'node:path';
import * as event from '../event/index.js';
import { createContainerFixture } from '../test/helpers.js';
import * as container from './container.js';

vi.mock('./migrate');
vi.mock('../event');

beforeEach(async () => {
  vi.resetAllMocks();
});

test('createCollections should create collection containers when not exist', async () => {
  const collection = {
    findOne: () => {},
    insert: () => {},
    ensureIndex: vi.fn(),
  };
  const db = {
    getCollection: () => null,
    addCollection: () => collection,
  };
  const spy = vi.spyOn(db, 'addCollection');
  container.createCollections(db);
  expect(spy).toHaveBeenCalledWith('containers', {
    indices: ['data.watcher', 'data.status', 'data.updateAvailable'],
  });
  expect(collection.ensureIndex).toHaveBeenCalledWith('data.watcher');
  expect(collection.ensureIndex).toHaveBeenCalledWith('data.status');
  expect(collection.ensureIndex).toHaveBeenCalledWith('data.updateAvailable');
});

test('createCollections should not create collection containers when already exist', async () => {
  const existingCollection = {
    findOne: () => {},
    insert: () => {},
    ensureIndex: vi.fn(),
  };
  const db = {
    getCollection: () => existingCollection,
    addCollection: () => null,
  };
  const spy = vi.spyOn(db, 'addCollection');
  container.createCollections(db);
  expect(spy).not.toHaveBeenCalled();
  expect(existingCollection.ensureIndex).toHaveBeenCalledWith('data.watcher');
  expect(existingCollection.ensureIndex).toHaveBeenCalledWith('data.status');
  expect(existingCollection.ensureIndex).toHaveBeenCalledWith('data.updateAvailable');
});

test('insertContainer should insert doc and emit an event', async () => {
  const collection = {
    findOne: () => {},
    insert: () => {},
  };
  const db = {
    getCollection: () => collection,
    addCollection: () => null,
  };
  const containerToSave = createContainerFixture();
  const spyInsert = vi.spyOn(collection, 'insert');
  const spyEvent = vi.spyOn(event, 'emitContainerAdded');
  container.createCollections(db);
  container.insertContainer(containerToSave);
  expect(spyInsert).toHaveBeenCalled();
  expect(spyEvent).toHaveBeenCalled();
});

test('updateContainer should update doc and emit an event', async () => {
  const collection = {
    insert: () => {},
    chain: () => ({
      find: () => ({
        remove: () => ({}),
      }),
    }),
  };
  const db = {
    getCollection: () => collection,
    addCollection: () => null,
  };
  const containerToSave = createContainerFixture();
  const spyInsert = vi.spyOn(collection, 'insert');
  const spyEvent = vi.spyOn(event, 'emitContainerUpdated');
  container.createCollections(db);
  container.updateContainer(containerToSave);
  expect(spyInsert).toHaveBeenCalled();
  expect(spyEvent).toHaveBeenCalled();
});

test('updateContainer should preserve updatePolicy when omitted from payload', async () => {
  const existingContainer = {
    data: createContainerFixture({
      updatePolicy: { skipTags: ['2.0.0'] },
    }),
  };
  const collection = {
    findOne: () => existingContainer,
    insert: () => {},
    chain: () => ({
      find: () => ({
        remove: () => ({}),
      }),
    }),
  };
  const db = {
    getCollection: () => collection,
    addCollection: () => null,
  };
  const containerToSave = createContainerFixture();

  container.createCollections(db);
  const updated = container.updateContainer(containerToSave);
  expect(updated.updatePolicy).toEqual({
    skipTags: ['2.0.0'],
  });
});

test('updateContainer should clear updatePolicy when explicitly set to undefined', async () => {
  const existingContainer = {
    data: createContainerFixture({
      updatePolicy: { skipTags: ['2.0.0'] },
    }),
  };
  const collection = {
    findOne: () => existingContainer,
    insert: () => {},
    chain: () => ({
      find: () => ({
        remove: () => ({}),
      }),
    }),
  };
  const db = {
    getCollection: () => collection,
    addCollection: () => null,
  };
  const containerToSave = createContainerFixture({ updatePolicy: undefined });

  container.createCollections(db);
  const updated = container.updateContainer(containerToSave);
  expect(updated.updatePolicy).toBeUndefined();
});

test('updateContainer should preserve security scan when omitted from payload', async () => {
  const existingContainer = {
    data: createContainerFixture({
      security: {
        scan: {
          scanner: 'trivy',
          image: 'registry/image:1.2.3',
          scannedAt: new Date().toISOString(),
          status: 'blocked',
          blockSeverities: ['CRITICAL', 'HIGH'],
          blockingCount: 1,
          summary: {
            unknown: 0,
            low: 0,
            medium: 0,
            high: 1,
            critical: 0,
          },
          vulnerabilities: [
            {
              id: 'CVE-123',
              severity: 'HIGH',
            },
          ],
        },
      },
    }),
  };
  const collection = {
    findOne: () => existingContainer,
    insert: () => {},
    chain: () => ({
      find: () => ({
        remove: () => ({}),
      }),
    }),
  };
  const db = {
    getCollection: () => collection,
    addCollection: () => null,
  };
  const containerToSave = createContainerFixture();

  container.createCollections(db);
  const updated = container.updateContainer(containerToSave);
  expect(updated.security).toEqual(existingContainer.data.security);
});

test('updateContainer should clear security when explicitly set to undefined', async () => {
  const existingContainer = {
    data: createContainerFixture({
      security: {
        scan: {
          scanner: 'trivy',
          image: 'registry/image:1.2.3',
          scannedAt: new Date().toISOString(),
          status: 'passed',
          blockSeverities: [],
          blockingCount: 0,
          summary: { unknown: 0, low: 0, medium: 0, high: 0, critical: 0 },
          vulnerabilities: [],
        },
      },
    }),
  };
  const collection = {
    findOne: () => existingContainer,
    insert: () => {},
    chain: () => ({
      find: () => ({
        remove: () => ({}),
      }),
    }),
  };
  const db = {
    getCollection: () => collection,
    addCollection: () => null,
  };
  const containerToSave = createContainerFixture({ security: undefined });

  container.createCollections(db);
  const updated = container.updateContainer(containerToSave);
  expect(updated.security).toBeUndefined();
});

test('updateContainer should preserve raw runtime env values when payload contains classified values', async () => {
  const existingContainer = {
    data: createContainerFixture({
      id: 'container-runtime-classification',
      details: {
        ports: [],
        volumes: [],
        env: [{ key: 'DB_PASSWORD', value: 'super-secret-password' }],
      },
    }),
  };
  const collection = {
    findOne: () => existingContainer,
    insert: vi.fn((doc) => {
      existingContainer.data = doc.data;
    }),
    chain: () => ({
      find: () => ({
        remove: () => ({}),
      }),
    }),
  };
  const db = {
    getCollection: () => collection,
    addCollection: () => null,
  };
  const containerToSave = createContainerFixture({
    id: 'container-runtime-classification',
    details: {
      ports: [],
      volumes: [],
      env: [{ key: 'DB_PASSWORD', value: 'super-secret-password', sensitive: true }],
    },
  });

  container.createCollections(db);
  const updated = container.updateContainer(containerToSave);

  expect(updated.details.env[0]).toEqual({
    key: 'DB_PASSWORD',
    value: 'super-secret-password',
  });
  expect(existingContainer.data.details.env[0]).toEqual({
    key: 'DB_PASSWORD',
    value: 'super-secret-password',
  });
});

test('insertContainer should redact sensitive env values in SSE event payload', async () => {
  const collection = {
    findOne: () => {},
    insert: () => {},
  };
  const db = {
    getCollection: () => collection,
    addCollection: () => null,
  };
  const containerToSave = createContainerFixture({
    details: {
      ports: [],
      volumes: [],
      env: [
        { key: 'API_TOKEN', value: 'super-secret' },
        { key: 'PATH', value: '/usr/local/bin' },
      ],
    },
  });
  const spyEvent = vi.spyOn(event, 'emitContainerAdded');
  container.createCollections(db);
  container.insertContainer(containerToSave);

  const emittedPayload = spyEvent.mock.calls[0][0];
  expect(emittedPayload.details.env[0]).toEqual({
    key: 'API_TOKEN',
    value: '[REDACTED]',
    sensitive: true,
  });
  expect(emittedPayload.details.env[1]).toEqual({
    key: 'PATH',
    value: '/usr/local/bin',
    sensitive: false,
  });
});

test('updateContainer should redact sensitive env values in SSE event payload', async () => {
  const collection = {
    insert: () => {},
    findOne: () => undefined,
    chain: () => ({
      find: () => ({
        remove: () => ({}),
      }),
    }),
  };
  const db = {
    getCollection: () => collection,
    addCollection: () => null,
  };
  const containerToSave = createContainerFixture({
    details: {
      ports: [],
      volumes: [],
      env: [
        { key: 'DB_PASSWORD', value: 'secret-pass' },
        { key: 'NODE_ENV', value: 'production' },
      ],
    },
  });
  const spyEvent = vi.spyOn(event, 'emitContainerUpdated');
  container.createCollections(db);
  container.updateContainer(containerToSave);

  const emittedPayload = spyEvent.mock.calls[0][0];
  expect(emittedPayload.details.env[0]).toEqual({
    key: 'DB_PASSWORD',
    value: '[REDACTED]',
    sensitive: true,
  });
  expect(emittedPayload.details.env[1]).toEqual({
    key: 'NODE_ENV',
    value: 'production',
    sensitive: false,
  });
});

test('insertContainer should stamp updateDetectedAt when update is available', async () => {
  const collection = {
    findOne: () => {},
    insert: () => {},
  };
  const db = {
    getCollection: () => collection,
    addCollection: () => null,
  };
  const base = createContainerFixture();
  const containerWithUpdate = {
    ...base,
    image: {
      ...base.image,
      tag: { ...base.image.tag, value: '1.0.0' },
    },
    result: { tag: '2.0.0' },
  };

  container.createCollections(db);
  const inserted = container.insertContainer(containerWithUpdate);

  expect(typeof inserted.updateDetectedAt).toBe('string');
});

test('updateContainer should preserve updateDetectedAt when update has not changed', async () => {
  const existingDetectedAt = '2026-02-24T09:15:00.000Z';
  const existingFixture = createContainerFixture();
  const existingContainer = {
    data: {
      ...existingFixture,
      image: {
        ...existingFixture.image,
        tag: { ...existingFixture.image.tag, value: '1.0.0' },
      },
      result: { tag: '2.0.0' },
      updateDetectedAt: existingDetectedAt,
    },
  };
  const collection = {
    findOne: () => existingContainer,
    insert: () => {},
    chain: () => ({
      find: () => ({
        remove: () => ({}),
      }),
    }),
  };
  const db = {
    getCollection: () => collection,
    addCollection: () => null,
  };
  const nextFixture = createContainerFixture();
  const containerToSave = {
    ...nextFixture,
    image: {
      ...nextFixture.image,
      tag: { ...nextFixture.image.tag, value: '1.0.0' },
    },
    result: { tag: '2.0.0' },
  };

  container.createCollections(db);
  const updated = container.updateContainer(containerToSave);

  expect(updated.updateDetectedAt).toBe(existingDetectedAt);
});

test('updateContainer should clear updateDetectedAt when update is no longer available', async () => {
  const existingFixture = createContainerFixture();
  const existingContainer = {
    data: {
      ...existingFixture,
      image: {
        ...existingFixture.image,
        tag: { ...existingFixture.image.tag, value: '1.0.0' },
      },
      result: { tag: '2.0.0' },
      updateDetectedAt: '2026-02-24T09:15:00.000Z',
    },
  };
  const collection = {
    findOne: () => existingContainer,
    insert: () => {},
    chain: () => ({
      find: () => ({
        remove: () => ({}),
      }),
    }),
  };
  const db = {
    getCollection: () => collection,
    addCollection: () => null,
  };
  const nextFixture = createContainerFixture();
  const containerToSave = {
    ...nextFixture,
    image: {
      ...nextFixture.image,
      tag: { ...nextFixture.image.tag, value: '1.0.0' },
    },
    result: { tag: '1.0.0' },
  };

  container.createCollections(db);
  const updated = container.updateContainer(containerToSave);

  expect(updated.updateDetectedAt).toBeUndefined();
});

test('getContainers should return all containers sorted by name', async () => {
  const containerExample = createContainerFixture();
  const containers = [
    { data: { ...containerExample, name: 'container3' } },
    { data: { ...containerExample, name: 'container2' } },
    { data: { ...containerExample, name: 'container1' } },
  ];
  const collection = {
    find: () => containers,
  };
  const db = {
    getCollection: () => collection,
    addCollection: () => ({
      findOne: () => {},
      insert: () => {},
    }),
  };
  container.createCollections(db);
  const results = container.getContainers();
  expect(results[0].name).toEqual('container1');
  expect(results[1].name).toEqual('container2');
  expect(results[2].name).toEqual('container3');
});

test('getContainers should sort by tag when watcher and name are equal', async () => {
  const containerExample = createContainerFixture();
  const containers = [
    {
      data: {
        ...containerExample,
        watcher: 'same-watcher',
        name: 'same-name',
        image: {
          ...containerExample.image,
          tag: { ...containerExample.image.tag, value: '2.0.0' },
        },
      },
    },
    {
      data: {
        ...containerExample,
        watcher: 'same-watcher',
        name: 'same-name',
        image: {
          ...containerExample.image,
          tag: { ...containerExample.image.tag, value: '1.0.0' },
        },
      },
    },
  ];
  const collection = {
    find: () => containers,
  };
  const db = {
    getCollection: () => collection,
    addCollection: () => ({
      findOne: () => {},
      insert: () => {},
    }),
  };
  container.createCollections(db);
  const results = container.getContainers();
  expect(results[0].image.tag.value).toEqual('1.0.0');
  expect(results[1].image.tag.value).toEqual('2.0.0');
});

test('getContainers should redact sensitive env values by default', async () => {
  const containerExample = createContainerFixture({
    details: {
      ports: [],
      volumes: [],
      env: [
        { key: 'API_TOKEN', value: 'super-secret' },
        { key: 'PATH', value: '/usr/local/bin' },
      ],
    },
  });
  const containers = [{ data: containerExample }];
  const collection = {
    find: () => containers,
  };
  const db = {
    getCollection: () => collection,
    addCollection: () => ({
      findOne: () => {},
      insert: () => {},
    }),
  };
  container.createCollections(db);

  const result = container.getContainers();

  expect(result[0].details.env[0]).toEqual({
    key: 'API_TOKEN',
    value: '[REDACTED]',
    sensitive: true,
  });
  expect(result[0].details.env[1]).toEqual({
    key: 'PATH',
    value: '/usr/local/bin',
    sensitive: false,
  });
  expect(containers[0].data.details.env[0].value).toBe('super-secret');
});

test('store/container should not define duplicate runtime env classification logic', () => {
  const source = fs.readFileSync(path.resolve(__dirname, './container.ts'), 'utf8');

  expect(source).not.toContain('function classifyContainerRuntimeDetails(');
});

test('getContainers should always redact sensitive env values', async () => {
  const containerExample = createContainerFixture({
    details: {
      ports: [],
      volumes: [],
      env: [
        { key: 'API_TOKEN', value: 'super-secret' },
        { key: 'NODE_ENV', value: 'production' },
      ],
    },
  });
  const containers = [{ data: containerExample }];
  const collection = {
    find: () => containers,
  };
  const db = {
    getCollection: () => collection,
    addCollection: () => ({
      findOne: () => {},
      insert: () => {},
    }),
  };
  container.createCollections(db);

  const result = container.getContainers({});

  expect(result[0].details.env[0]).toEqual({
    key: 'API_TOKEN',
    value: '[REDACTED]',
    sensitive: true,
  });
  expect(result[0].details.env[1]).toEqual({
    key: 'NODE_ENV',
    value: 'production',
    sensitive: false,
  });
});

test('getContainer should return 1 container by id', async () => {
  const containerExample = { data: createContainerFixture() };
  const collection = {
    findOne: () => containerExample,
  };
  const db = {
    getCollection: () => collection,
  };
  container.createCollections(db);
  const result = container.getContainer('132456789');
  expect(result.name).toEqual(containerExample.data.name);
});

test('getContainer should redact sensitive env values by default', async () => {
  const containerExample = {
    data: createContainerFixture({
      details: {
        ports: [],
        volumes: [],
        env: [{ key: 'DB_PASSWORD', value: 'raw-secret' }],
      },
    }),
  };
  const collection = {
    findOne: () => containerExample,
  };
  const db = {
    getCollection: () => collection,
  };
  container.createCollections(db);

  const result = container.getContainer('132456789');

  expect(result.details.env[0]).toEqual({
    key: 'DB_PASSWORD',
    value: '[REDACTED]',
    sensitive: true,
  });
  expect(containerExample.data.details.env[0].value).toBe('raw-secret');
});

test('getContainer should always redact sensitive env values', async () => {
  const containerExample = {
    data: createContainerFixture({
      details: {
        ports: [],
        volumes: [],
        env: [{ key: 'DB_PASSWORD', value: 'raw-secret' }],
      },
    }),
  };
  const collection = {
    findOne: () => containerExample,
  };
  const db = {
    getCollection: () => collection,
  };
  container.createCollections(db);

  const result = container.getContainer('132456789');

  expect(result.details.env[0]).toEqual({
    key: 'DB_PASSWORD',
    value: '[REDACTED]',
    sensitive: true,
  });
});

test('getContainerRaw should return unredacted env values', async () => {
  const containerExample = {
    data: createContainerFixture({
      details: {
        ports: [],
        volumes: [],
        env: [{ key: 'DB_PASSWORD', value: 'raw-secret' }],
      },
    }),
  };
  const collection = {
    findOne: () => containerExample,
  };
  const db = {
    getCollection: () => collection,
  };
  container.createCollections(db);

  const result = container.getContainerRaw('132456789');

  expect(result.details.env[0]).toEqual({
    key: 'DB_PASSWORD',
    value: 'raw-secret',
  });
});

test('getContainerRaw should return undefined when not found', async () => {
  const collection = {
    findOne: () => null,
  };
  const db = {
    getCollection: () => collection,
  };
  container.createCollections(db);
  const result = container.getContainerRaw('nonexistent');
  expect(result).toBeUndefined();
});

test('getContainer should return undefined when not found', async () => {
  const collection = {
    findOne: () => null,
  };
  const db = {
    getCollection: () => collection,
  };
  container.createCollections(db);
  const result = container.getContainer('123456789');
  expect(result).toEqual(undefined);
});

test('getContainers should return empty array when collection is not initialized', async () => {
  vi.resetModules();
  const freshContainer = await import('./container.js');
  const result = freshContainer.getContainers();
  expect(result).toEqual([]);
});

test('getContainers should filter by query parameters', async () => {
  const containerExample = createContainerFixture();
  const collection = {
    find: vi.fn(() => [{ data: containerExample }]),
  };
  const db = {
    getCollection: () => collection,
    addCollection: () => null,
  };
  container.createCollections(db);
  container.getContainers({ watcher: 'test' });
  expect(collection.find).toHaveBeenCalledWith({ 'data.watcher': 'test' });
});

test('deleteContainer should do nothing when container is not found', async () => {
  const collection = {
    findOne: () => null,
    chain: () => ({
      find: () => ({
        remove: () => ({}),
      }),
    }),
  };
  const db = {
    getCollection: () => collection,
    addCollection: () => null,
  };
  const spyEvent = vi.spyOn(event, 'emitContainerRemoved');
  container.createCollections(db);
  container.deleteContainer('nonexistent-id');
  expect(spyEvent).not.toHaveBeenCalled();
});

test('deleteContainer should delete doc and emit an event', async () => {
  const containerExample = { data: createContainerFixture() };
  const collection = {
    findOne: () => containerExample,
    chain: () => ({
      find: () => ({
        remove: () => ({}),
      }),
    }),
  };
  const db = {
    getCollection: () => collection,
    addCollection: () => null,
  };
  const spyEvent = vi.spyOn(event, 'emitContainerRemoved');
  container.createCollections(db);
  container.deleteContainer(containerExample);
  expect(spyEvent).toHaveBeenCalled();
});

test('updateContainer should default security to undefined when container and store both lack it', async () => {
  const collection = {
    findOne: () => undefined,
    insert: () => {},
    chain: () => ({
      find: () => ({
        remove: () => ({}),
      }),
    }),
  };
  const db = {
    getCollection: () => collection,
    addCollection: () => null,
  };
  container.createCollections(db);
  const containerToSave = createContainerFixture();
  const updated = container.updateContainer(containerToSave);
  expect(updated.security).toBeUndefined();
});

test('insertContainer should pick up cached security state when container has none', async () => {
  const collection = {
    findOne: () => {},
    insert: () => {},
  };
  const db = {
    getCollection: () => collection,
    addCollection: () => null,
  };
  const securityData = {
    scan: {
      scanner: 'trivy',
      image: 'registry/image:1.2.3',
      scannedAt: new Date().toISOString(),
      status: 'passed',
      blockSeverities: [],
      blockingCount: 0,
      summary: { unknown: 0, low: 0, medium: 0, high: 0, critical: 0 },
      vulnerabilities: [],
    },
  };
  container.createCollections(db);
  container.cacheSecurityState('test', 'test', securityData);
  const result = container.insertContainer(createContainerFixture());
  expect(result.security).toEqual(securityData);
});

test('insertContainer should clear cached security state after consuming it', async () => {
  const collection = {
    findOne: () => {},
    insert: () => {},
  };
  const db = {
    getCollection: () => collection,
    addCollection: () => null,
  };
  const securityData = {
    scan: {
      scanner: 'trivy',
      image: 'registry/image:1.2.3',
      scannedAt: new Date().toISOString(),
      status: 'passed',
      blockSeverities: [],
      blockingCount: 0,
      summary: { unknown: 0, low: 0, medium: 0, high: 0, critical: 0 },
      vulnerabilities: [],
    },
  };
  container.createCollections(db);
  container.cacheSecurityState('test', 'test', securityData);
  container.insertContainer(createContainerFixture());
  expect(container.getCachedSecurityState('test', 'test')).toBeUndefined();
});

test('insertContainer should not overwrite explicit security state with cache', async () => {
  const collection = {
    findOne: () => {},
    insert: () => {},
  };
  const db = {
    getCollection: () => collection,
    addCollection: () => null,
  };
  const cachedSecurity = {
    scan: {
      scanner: 'trivy',
      image: 'registry/image:old',
      scannedAt: new Date().toISOString(),
      status: 'passed',
      blockSeverities: [],
      blockingCount: 0,
      summary: { unknown: 0, low: 0, medium: 0, high: 0, critical: 0 },
      vulnerabilities: [],
    },
  };
  const explicitSecurity = {
    scan: {
      scanner: 'trivy',
      image: 'registry/image:new',
      scannedAt: new Date().toISOString(),
      status: 'blocked',
      blockSeverities: ['CRITICAL'],
      blockingCount: 1,
      summary: { unknown: 0, low: 0, medium: 0, high: 0, critical: 1 },
      vulnerabilities: [{ id: 'CVE-999', severity: 'CRITICAL' }],
    },
  };
  container.createCollections(db);
  container.cacheSecurityState('test', 'test', cachedSecurity);
  const result = container.insertContainer(createContainerFixture({ security: explicitSecurity }));
  expect(result.security).toEqual(explicitSecurity);
});

test('getCachedSecurityState should expire entries after cache TTL', async () => {
  vi.useFakeTimers();
  try {
    container.clearAllCachedSecurityState();
    vi.setSystemTime(new Date('2026-02-01T00:00:00.000Z'));

    const securityData = {
      scan: {
        scanner: 'trivy',
        image: 'registry/image:1.2.3',
        scannedAt: new Date().toISOString(),
        status: 'passed',
        blockSeverities: [],
        blockingCount: 0,
        summary: { unknown: 0, low: 0, medium: 0, high: 0, critical: 0 },
        vulnerabilities: [],
      },
    };
    container.cacheSecurityState('ttl', 'entry', securityData);

    vi.advanceTimersByTime(container.SECURITY_STATE_CACHE_TTL_MS + 1);

    expect(container.getCachedSecurityState('ttl', 'entry')).toBeUndefined();
  } finally {
    vi.useRealTimers();
    container.clearAllCachedSecurityState();
  }
});

test('cacheSecurityState should evict oldest entries when max size is exceeded', async () => {
  container.clearAllCachedSecurityState();
  const maxEntries = container.SECURITY_STATE_CACHE_MAX_ENTRIES;
  for (let index = 0; index <= maxEntries; index += 1) {
    container.cacheSecurityState('limit', `container-${index}`, { status: 'ok', index });
  }

  expect(container.getCachedSecurityState('limit', 'container-0')).toBeUndefined();
  expect(container.getCachedSecurityState('limit', `container-${maxEntries}`)).toEqual({
    status: 'ok',
    index: maxEntries,
  });

  for (let index = 0; index <= maxEntries; index += 1) {
    container.clearCachedSecurityState('limit', `container-${index}`);
  }
});

test('getContainers should evict oldest query cache entries when size cap is exceeded', async () => {
  const containerExample = createContainerFixture();
  const collection = {
    find: vi.fn(() => [{ data: containerExample }]),
  };
  const db = {
    getCollection: () => collection,
    addCollection: () => null,
  };
  container.createCollections(db);
  collection.find.mockClear();
  const maxEntries = container.CONTAINERS_QUERY_CACHE_MAX_ENTRIES;

  for (let index = 0; index <= maxEntries; index += 1) {
    container.getContainers({ watcher: `watcher-${index}` });
  }
  const readCountAfterUniqueQueries = collection.find.mock.calls.length;

  container.getContainers({ watcher: 'watcher-0' });
  expect(collection.find.mock.calls.length).toBe(readCountAfterUniqueQueries + 1);
});

test('getContainers should cache validated results and invalidate cache after writes', async () => {
  const containerExample = createContainerFixture();
  const docs = [{ data: containerExample }];
  const collection = {
    find: vi.fn(() => [...docs]),
    insert: vi.fn((doc) => {
      docs.push(doc);
    }),
    findOne: vi.fn(() => undefined),
    chain: vi.fn(() => ({
      find: () => ({
        remove: () => ({}),
      }),
    })),
  };
  const db = {
    getCollection: () => collection,
    addCollection: () => null,
  };
  container.createCollections(db);
  collection.find.mockClear();

  container.getContainers();
  const readCountAfterFirstGet = collection.find.mock.calls.length;
  container.getContainers();
  expect(collection.find.mock.calls.length).toBe(readCountAfterFirstGet);

  container.insertContainer(
    createContainerFixture({
      id: 'cache-test-insert',
      name: 'cache-test-insert',
    }),
  );
  const readCountBeforeGetAfterWrite = collection.find.mock.calls.length;
  container.getContainers();
  expect(collection.find.mock.calls.length).toBe(readCountBeforeGetAfterWrite + 1);
});
