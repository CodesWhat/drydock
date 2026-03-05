import fs from 'node:fs';
import path from 'node:path';
import * as event from '../event/index.js';
import { createContainerFixture } from '../test/helpers.js';
import * as container from './container.js';

vi.mock('./migrate');
vi.mock('../event');

beforeEach(async () => {
  vi.resetAllMocks();
  container._resetContainerStoreStateForTests();
});

function createFilterableCollection(initialDocs) {
  let docs = [...initialDocs];

  const matchesFilter = (doc, filter = {}) =>
    Object.entries(filter).every(([key, value]) => {
      const path = key.split('.');
      let current: Record<string, unknown> | unknown = doc;
      for (const segment of path) {
        if (!current || typeof current !== 'object') {
          return false;
        }
        current = (current as Record<string, unknown>)[segment];
      }
      return current === value;
    });

  return {
    find: vi.fn((filter = {}) => docs.filter((doc) => matchesFilter(doc, filter))),
    findOne: vi.fn((filter = {}) => docs.find((doc) => matchesFilter(doc, filter)) ?? null),
    insert: vi.fn((doc) => {
      docs.push(doc);
    }),
    chain: vi.fn(() => ({
      find: (filter = {}) => ({
        remove: () => {
          docs = docs.filter((doc) => !matchesFilter(doc, filter));
          return {};
        },
      }),
    })),
  };
}

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

test('updateContainer should use collection update when available for existing containers', async () => {
  const existingContainer = {
    data: createContainerFixture({
      id: 'container-update-with-update-method',
    }),
  };
  const collection = {
    findOne: () => existingContainer,
    update: vi.fn(),
    insert: vi.fn(),
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
  const containerToSave = createContainerFixture({
    id: 'container-update-with-update-method',
  });
  const spyEvent = vi.spyOn(event, 'emitContainerUpdated');
  container.createCollections(db);

  container.updateContainer(containerToSave);

  expect(collection.update).toHaveBeenCalledTimes(1);
  expect(collection.insert).not.toHaveBeenCalled();
  expect(collection.chain).not.toHaveBeenCalled();
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

test('updateContainer should reject incoming details when env is missing', async () => {
  const existingContainer = {
    data: createContainerFixture({
      id: 'container-details-non-array',
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
  container.createCollections(db);
  expect(() =>
    container.updateContainer(
      createContainerFixture({
        id: 'container-details-non-array',
        details: {
          ports: [],
          volumes: [],
        },
      }),
    ),
  ).toThrow('"details.env"');
});

test('updateContainer should keep incoming details when classified env list is empty', async () => {
  const existingContainer = {
    data: createContainerFixture({
      id: 'container-details-empty-env',
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
  container.createCollections(db);
  const updated = container.updateContainer(
    createContainerFixture({
      id: 'container-details-empty-env',
      details: {
        ports: [],
        volumes: [],
        env: [],
      },
    }),
  );

  expect(updated.details.env).toEqual([]);
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

test('updateContainer should preserve explicit incoming updateDetectedAt when provided', async () => {
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
  const explicitDetectedAt = '2026-02-24T10:00:00.000Z';
  const containerToSave = {
    ...nextFixture,
    image: {
      ...nextFixture.image,
      tag: { ...nextFixture.image.tag, value: '1.0.0' },
    },
    result: { tag: '2.0.0' },
    updateDetectedAt: explicitDetectedAt,
  };

  container.createCollections(db);
  const updated = container.updateContainer(containerToSave);

  expect(updated.updateDetectedAt).toBe(explicitDetectedAt);
});

test('updateContainer should set updateDetectedAt when previous update lacks timestamp', async () => {
  const existingFixture = createContainerFixture();
  const existingContainer = {
    data: {
      ...existingFixture,
      image: {
        ...existingFixture.image,
        tag: { ...existingFixture.image.tag, value: '1.0.0' },
      },
      result: { tag: '2.0.0' },
      updateDetectedAt: undefined,
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

  expect(typeof updated.updateDetectedAt).toBe('string');
});

test('updateContainer should refresh updateDetectedAt when update result changes', async () => {
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
    result: { tag: '2.1.0' },
  };

  container.createCollections(db);
  const updated = container.updateContainer(containerToSave);

  expect(updated.updateDetectedAt).toBeDefined();
  expect(updated.updateDetectedAt).not.toBe(existingDetectedAt);
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

test('getContainers should apply pagination options', async () => {
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

  const results = container.getContainers({}, { limit: 1, offset: 1 });

  expect(results).toHaveLength(1);
  expect(results[0].name).toEqual('container2');
});

test('getContainers should support offset-only pagination when limit is zero', async () => {
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

  const results = container.getContainers({}, { limit: 0, offset: 1 });

  expect(results).toHaveLength(2);
  expect(results[0].name).toEqual('container2');
  expect(results[1].name).toEqual('container3');
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

test('getContainersRaw should return unredacted env values', async () => {
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

  const result = container.getContainersRaw({});

  expect(result[0].details.env[0]).toEqual({
    key: 'API_TOKEN',
    value: 'super-secret',
  });
  expect(result[0].details.env[1]).toEqual({
    key: 'NODE_ENV',
    value: 'production',
  });
});

test('getContainersRaw should preserve Date and RegExp values when cloning', async () => {
  const buildDate = new Date('2026-03-05T09:00:00.000Z');
  const namePattern = /^drydock-container$/i;
  const containerExample = createContainerFixture();
  containerExample.labels = {
    buildDate,
    namePattern,
  } as unknown as Record<string, string>;
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

  const result = container.getContainersRaw({});

  expect(result[0].labels.buildDate).toBeInstanceOf(Date);
  expect((result[0].labels.buildDate as unknown as Date).toISOString()).toBe(
    '2026-03-05T09:00:00.000Z',
  );
  expect(result[0].labels.namePattern).toBeInstanceOf(RegExp);
  expect((result[0].labels.namePattern as unknown as RegExp).source).toBe('^drydock-container$');
  expect((result[0].labels.namePattern as unknown as RegExp).flags).toBe('i');
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

test('getContainers should ignore unsafe prototype-related query keys', async () => {
  const containerExample = createContainerFixture();
  const collection = {
    find: vi.fn(() => [{ data: containerExample }]),
  };
  const db = {
    getCollection: () => collection,
    addCollection: () => null,
  };
  container.createCollections(db);

  container.getContainers({
    watcher: 'safe-watcher',
    '__proto__.polluted': 'x',
    'constructor.prototype.bad': 'x',
    prototype: 'x',
  } as Record<string, unknown>);

  expect(collection.find).toHaveBeenCalledWith({ 'data.watcher': 'safe-watcher' });
});

test('getContainers should reuse cache for equivalent queries with different key order', async () => {
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

  container.getContainers({ watcher: 'watcher-1', status: 'running' });
  container.getContainers({ status: 'running', watcher: 'watcher-1' });

  expect(collection.find).toHaveBeenCalledTimes(1);
});

test('getContainers cache invalidation should safely handle query paths that traverse non-objects', async () => {
  const collection = createFilterableCollection([
    {
      data: createContainerFixture({
        id: 'container-path-traversal',
        name: 'container-path-traversal',
      }),
    },
  ]);
  const db = {
    getCollection: () => collection,
    addCollection: () => null,
  };
  container.createCollections(db);

  container.getContainers({ 'name.value': 'never-matches' });
  const readCountAfterWarm = collection.find.mock.calls.length;
  container.getContainers({ 'name.value': 'never-matches' });
  expect(collection.find.mock.calls.length).toBe(readCountAfterWarm);

  container.updateContainer(
    createContainerFixture({
      id: 'container-path-traversal',
      name: 'container-path-traversal',
      status: 'running',
    }),
  );

  container.getContainers({ 'name.value': 'never-matches' });
  expect(collection.find.mock.calls.length).toBe(readCountAfterWarm);
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

test('cacheSecurityState should refresh existing cache entries', async () => {
  container.clearAllCachedSecurityState();
  container.cacheSecurityState('refresh', 'entry', { status: 'old' });
  container.cacheSecurityState('refresh', 'entry', { status: 'new' });

  expect(container.getCachedSecurityState('refresh', 'entry')).toEqual({ status: 'new' });
  container.clearCachedSecurityState('refresh', 'entry');
});

test('cacheSecurityState should avoid full-map prune on each write', async () => {
  container.clearAllCachedSecurityState();
  const entriesSpy = vi.spyOn(Map.prototype, 'entries');
  const callsBeforeWrites = entriesSpy.mock.calls.length;

  try {
    for (let index = 0; index < 5; index += 1) {
      container.cacheSecurityState('counter-prune', `entry-${index}`, { status: 'ok', index });
    }

    expect(entriesSpy.mock.calls.length - callsBeforeWrites).toBe(0);
  } finally {
    entriesSpy.mockRestore();
    container.clearAllCachedSecurityState();
  }
});

test('cacheSecurityState should prune expired entries before adding fresh entries', async () => {
  vi.useFakeTimers();
  try {
    container.clearAllCachedSecurityState();
    vi.setSystemTime(new Date('2026-02-01T00:00:00.000Z'));
    container.cacheSecurityState('ttl-prune', 'stale', { status: 'old' });
    vi.advanceTimersByTime(container.SECURITY_STATE_CACHE_TTL_MS + 1);
    container.cacheSecurityState('ttl-prune', 'fresh', { status: 'new' });

    expect(container.getCachedSecurityState('ttl-prune', 'stale')).toBeUndefined();
    expect(container.getCachedSecurityState('ttl-prune', 'fresh')).toEqual({ status: 'new' });
  } finally {
    vi.useRealTimers();
    container.clearAllCachedSecurityState();
  }
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

test('getContainers should retain unaffected query caches across inserts', async () => {
  const collection = createFilterableCollection([
    {
      data: createContainerFixture({
        id: 'watcher-a-1',
        name: 'watcher-a-1',
        watcher: 'watcher-a',
      }),
    },
    {
      data: createContainerFixture({
        id: 'watcher-b-1',
        name: 'watcher-b-1',
        watcher: 'watcher-b',
      }),
    },
  ]);
  const db = {
    getCollection: () => collection,
    addCollection: () => null,
  };
  container.createCollections(db);

  container.getContainers({ watcher: 'watcher-a' });
  container.getContainers({ watcher: 'watcher-b' });
  const readCountAfterWarm = collection.find.mock.calls.length;
  container.getContainers({ watcher: 'watcher-b' });
  expect(collection.find.mock.calls.length).toBe(readCountAfterWarm);

  container.insertContainer(
    createContainerFixture({
      id: 'watcher-a-2',
      name: 'watcher-a-2',
      watcher: 'watcher-a',
    }),
  );
  const readCountBeforeAffectedAndUnaffectedReads = collection.find.mock.calls.length;

  container.getContainers({ watcher: 'watcher-b' });
  expect(collection.find.mock.calls.length).toBe(readCountBeforeAffectedAndUnaffectedReads);

  container.getContainers({ watcher: 'watcher-a' });
  expect(collection.find.mock.calls.length).toBe(readCountBeforeAffectedAndUnaffectedReads + 1);
});

test('getContainers should retain unaffected query caches across updates', async () => {
  const collection = createFilterableCollection([
    {
      data: createContainerFixture({
        id: 'watcher-a-1',
        name: 'watcher-a-1',
        watcher: 'watcher-a',
      }),
    },
    {
      data: createContainerFixture({
        id: 'watcher-b-1',
        name: 'watcher-b-1',
        watcher: 'watcher-b',
      }),
    },
  ]);
  const db = {
    getCollection: () => collection,
    addCollection: () => null,
  };
  container.createCollections(db);

  container.getContainers({ watcher: 'watcher-a' });
  container.getContainers({ watcher: 'watcher-b' });
  const readCountAfterWarm = collection.find.mock.calls.length;
  container.getContainers({ watcher: 'watcher-b' });
  expect(collection.find.mock.calls.length).toBe(readCountAfterWarm);

  container.updateContainer(
    createContainerFixture({
      id: 'watcher-a-1',
      name: 'watcher-a-1',
      watcher: 'watcher-a',
      status: 'running',
    }),
  );
  const readCountBeforeAffectedAndUnaffectedReads = collection.find.mock.calls.length;

  container.getContainers({ watcher: 'watcher-b' });
  expect(collection.find.mock.calls.length).toBe(readCountBeforeAffectedAndUnaffectedReads);

  container.getContainers({ watcher: 'watcher-a' });
  expect(collection.find.mock.calls.length).toBe(readCountBeforeAffectedAndUnaffectedReads + 1);
});

test('getContainers should retain unaffected query caches across deletes', async () => {
  const collection = createFilterableCollection([
    {
      data: createContainerFixture({
        id: 'watcher-a-1',
        name: 'watcher-a-1',
        watcher: 'watcher-a',
      }),
    },
    {
      data: createContainerFixture({
        id: 'watcher-b-1',
        name: 'watcher-b-1',
        watcher: 'watcher-b',
      }),
    },
  ]);
  const db = {
    getCollection: () => collection,
    addCollection: () => null,
  };
  container.createCollections(db);

  container.getContainers({ watcher: 'watcher-a' });
  container.getContainers({ watcher: 'watcher-b' });
  const readCountAfterWarm = collection.find.mock.calls.length;
  container.getContainers({ watcher: 'watcher-b' });
  expect(collection.find.mock.calls.length).toBe(readCountAfterWarm);

  container.deleteContainer('watcher-a-1');
  const readCountBeforeAffectedAndUnaffectedReads = collection.find.mock.calls.length;

  container.getContainers({ watcher: 'watcher-b' });
  expect(collection.find.mock.calls.length).toBe(readCountBeforeAffectedAndUnaffectedReads);

  container.getContainers({ watcher: 'watcher-a' });
  expect(collection.find.mock.calls.length).toBe(readCountBeforeAffectedAndUnaffectedReads + 1);
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

test('getContainers should isolate nested objects from cached query results', async () => {
  const containerExample = createContainerFixture();
  const collection = {
    find: vi.fn(() => [{ data: containerExample }]),
  };
  const db = {
    getCollection: () => collection,
    addCollection: () => null,
  };
  container.createCollections(db);

  const firstRead = container.getContainers();
  firstRead[0].image.tag.value = 'tampered';

  const secondRead = container.getContainers();

  expect(collection.find).toHaveBeenCalledTimes(1);
  expect(secondRead[0].image.tag.value).toBe('version');
});

test('security state prune should remove expired entries and trim oldest active entries', () => {
  const nowMs = Date.now();
  const maxEntries = container.SECURITY_STATE_CACHE_MAX_ENTRIES;
  container._setSecurityStateCacheEntryForTests('expired_entry', {
    security: { stale: true },
    expiresAt: nowMs - 1,
  });
  for (let index = 0; index <= maxEntries; index += 1) {
    container._setSecurityStateCacheEntryForTests(`active_${index}`, {
      security: { index },
      expiresAt: nowMs + 60_000,
    });
  }

  container._pruneSecurityStateCacheForTests(nowMs);

  expect(container.getCachedSecurityState('expired', 'entry')).toBeUndefined();
  expect(container.getCachedSecurityState('active', '0')).toBeUndefined();
  expect(container.getCachedSecurityState('active', `${maxEntries}`)).toEqual({
    index: maxEntries,
  });
});

test('security state size enforcement should stop when iterator returns undefined keys', () => {
  const maxEntries = container.SECURITY_STATE_CACHE_MAX_ENTRIES;
  for (let index = 0; index <= maxEntries; index += 1) {
    container._setSecurityStateCacheEntryForTests(`edge_${index}`, {
      security: { index },
      expiresAt: Date.now() + 60_000,
    });
  }

  const securityCache = container._getSecurityStateCacheForTests();
  const keysSpy = vi.spyOn(securityCache, 'keys').mockImplementation(
    () =>
      ({
        next: () => ({ done: false, value: undefined }),
        [Symbol.iterator]() {
          return this;
        },
      }) as IterableIterator<string>,
  );

  try {
    container._enforceSecurityStateCacheSizeLimitForTests();
    expect(securityCache.size).toBe(maxEntries + 1);
  } finally {
    keysSpy.mockRestore();
  }
});

test('container query cache invalidation should tolerate malformed cache keys', () => {
  container._setContainersQueryCacheEntriesForTests([
    ['{"invalid":"shape"}', []],
    ['[["watcher","test"],["broken-entry"]]', []],
    ['{invalid-json', []],
  ]);

  expect(() => container._invalidateContainersCacheForMutationForTests({}, {})).not.toThrow();
  expect(container._getContainersQueryCacheForTests().size).toBe(0);
});

test('getValueByPath helper should reject unsafe and invalid traversal paths', () => {
  expect(
    container._getValueByPathForTests({ safe: { value: 'ok' } }, '__proto__.polluted'),
  ).toBeUndefined();
  expect(container._getValueByPathForTests({ name: 'plain-string' }, 'name.value')).toBeUndefined();
});
