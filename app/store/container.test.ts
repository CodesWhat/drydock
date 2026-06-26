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
      status: 'running',
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
    status: 'stopped',
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

test('updateContainer should preserve updateRollback when omitted from payload', async () => {
  const existingContainer = {
    data: createContainerFixture({
      updateRollback: {
        recordedAt: '2026-04-01T00:00:00.000Z',
        targetDigest: '3.13.7-alpine',
        reason: 'start_new_failed',
        lastError: 'container exited',
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
  expect(updated.updateRollback).toEqual({
    recordedAt: '2026-04-01T00:00:00.000Z',
    targetDigest: '3.13.7-alpine',
    reason: 'start_new_failed',
    lastError: 'container exited',
  });
});

test('updateContainer should clear updateRollback when explicitly set to undefined', async () => {
  const existingContainer = {
    data: createContainerFixture({
      updateRollback: {
        recordedAt: '2026-04-01T00:00:00.000Z',
        targetDigest: '3.13.7-alpine',
        reason: 'start_new_failed',
        lastError: 'container exited',
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
  const containerToSave = createContainerFixture({ updateRollback: undefined });

  container.createCollections(db);
  const updated = container.updateContainer(containerToSave);
  expect(updated.updateRollback).toBeUndefined();
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

test('insertContainer should stamp firstSeenAt when update is available', async () => {
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

  expect(typeof inserted.firstSeenAt).toBe('string');
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

test('updateContainer should preserve firstSeenAt when update has not changed', async () => {
  const existingFirstSeenAt = '2026-02-24T09:15:00.000Z';
  const existingFixture = createContainerFixture();
  const existingContainer = {
    data: {
      ...existingFixture,
      image: {
        ...existingFixture.image,
        tag: { ...existingFixture.image.tag, value: '1.0.0' },
      },
      result: { tag: '2.0.0' },
      firstSeenAt: existingFirstSeenAt,
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

  expect(updated.firstSeenAt).toBe(existingFirstSeenAt);
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

test('updateContainer should refresh firstSeenAt when update result changes', async () => {
  const existingFirstSeenAt = '2026-02-24T09:15:00.000Z';
  const existingFixture = createContainerFixture();
  const existingContainer = {
    data: {
      ...existingFixture,
      image: {
        ...existingFixture.image,
        tag: { ...existingFixture.image.tag, value: '1.0.0' },
      },
      result: { tag: '2.0.0' },
      firstSeenAt: existingFirstSeenAt,
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

  expect(updated.firstSeenAt).toBeDefined();
  expect(updated.firstSeenAt).not.toBe(existingFirstSeenAt);
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

test('updateContainer should clear firstSeenAt when update is no longer available', async () => {
  const existingFixture = createContainerFixture();
  const existingContainer = {
    data: {
      ...existingFixture,
      image: {
        ...existingFixture.image,
        tag: { ...existingFixture.image.tag, value: '1.0.0' },
      },
      result: { tag: '2.0.0' },
      firstSeenAt: '2026-02-24T09:15:00.000Z',
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

  expect(updated.firstSeenAt).toBeUndefined();
});

test('insertContainer should stamp updateDetectedAt when raw update exists under mature mode', async () => {
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
    updatePolicy: { maturityMode: 'mature', maturityMinAgeDays: 1 },
  };

  container.createCollections(db);
  const inserted = container.insertContainer(containerWithUpdate);

  // Raw update exists (1.0.0 → 2.0.0) so updateDetectedAt must be stamped,
  // even though maturity suppression makes updateAvailable false.
  expect(typeof inserted.updateDetectedAt).toBe('string');
});

test('updateContainer should preserve updateDetectedAt while update is suppressed by mature mode', async () => {
  const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
  const existingFixture = createContainerFixture();
  const existingContainer = {
    data: {
      ...existingFixture,
      image: {
        ...existingFixture.image,
        tag: { ...existingFixture.image.tag, value: '1.0.0' },
      },
      result: { tag: '2.0.0' },
      updateDetectedAt: twelveHoursAgo,
      updatePolicy: { maturityMode: 'mature', maturityMinAgeDays: 1 },
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
    updatePolicy: { maturityMode: 'mature', maturityMinAgeDays: 1 },
  };

  container.createCollections(db);
  const updated = container.updateContainer(containerToSave);

  // The raw update (1.0.0 → 2.0.0) is unchanged; the 12-hour-old timestamp must
  // be preserved so the maturity clock keeps ticking. Before the fix it was wiped
  // to undefined because updateAvailable is false while still suppressed.
  expect(updated.updateDetectedAt).toBe(twelveHoursAgo);
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

test('getContainerCount should return filtered totals and reuse cached query results', async () => {
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
        id: 'watcher-a-2',
        name: 'watcher-a-2',
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

  const total = container.getContainerCount({ watcher: 'watcher-a' });
  expect(total).toBe(2);
  expect(collection.find).toHaveBeenCalledTimes(1);

  const pagedResults = container.getContainers({ watcher: 'watcher-a' }, { limit: 1, offset: 0 });
  expect(pagedResults).toHaveLength(1);
  expect(collection.find).toHaveBeenCalledTimes(1);

  const cachedTotal = container.getContainerCount({ watcher: 'watcher-a' });
  expect(cachedTotal).toBe(2);
  expect(collection.find).toHaveBeenCalledTimes(1);
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

test('getContainersRaw should reuse cached raw objects without cloning after cache hit', async () => {
  const containerExample = createContainerFixture();
  const collection = {
    find: vi.fn(() => [{ data: containerExample }]),
  };
  const db = {
    getCollection: () => collection,
    addCollection: () => ({
      findOne: () => {},
      insert: () => {},
    }),
  };
  container.createCollections(db);

  const firstResult = container.getContainersRaw({});
  const secondResult = container.getContainersRaw({});

  expect(collection.find).toHaveBeenCalledTimes(1);
  expect(secondResult[0]).toBe(firstResult[0]);
});

test('getContainersRaw should preserve Date and RegExp values', async () => {
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

test('getContainersForStats should return projected stat fields only', async () => {
  const containerExample = createContainerFixture({
    agent: 'edge-agent',
    result: { tag: 'newer' },
    security: {
      scan: {
        scanner: 'trivy',
        image: 'org/img:v1',
        scannedAt: '2026-01-01T00:00:00.000Z',
        status: 'passed',
        blockSeverities: [],
        blockingCount: 0,
        summary: { unknown: 0, low: 0, medium: 0, high: 0, critical: 0 },
        vulnerabilities: [
          {
            id: 'CVE-2025-0001',
            severity: 'HIGH',
            title: 'test vuln',
            primaryUrl: 'https://cve.mitre.org/cgi-bin/cvename.cgi?name=CVE-2025-0001',
          },
        ],
      },
    },
    details: {
      ports: ['80/tcp'],
      volumes: ['/data:/data'],
      env: [{ key: 'SECRET', value: 'my-secret' }],
    },
  });
  const containers = [{ data: containerExample }];
  const collection = { find: () => containers };
  const db = {
    getCollection: () => collection,
    addCollection: () => ({ findOne: () => {}, insert: () => {} }),
  };
  container.createCollections(db);

  const result = container.getContainersForStats({});

  expect(result).toHaveLength(1);
  const projection = result[0];

  // Required stat fields are present
  expect(projection.id).toBe(containerExample.id);
  expect(projection.watcher).toBe(containerExample.watcher);
  expect(projection.agent).toBe('edge-agent');
  expect(projection.status).toBe('unknown');
  expect(typeof projection.updateAvailable).toBe('boolean');
  expect(projection.image.id).toBe(containerExample.image.id);
  expect(projection.image.name).toBe(containerExample.image.name);

  // Heavy fields are NOT present on the projection
  expect((projection as Record<string, unknown>).security).toBeUndefined();
  expect((projection as Record<string, unknown>).details).toBeUndefined();
  expect((projection as Record<string, unknown>).labels).toBeUndefined();
  expect((projection as Record<string, unknown>).result).toBeUndefined();
});

test('getContainersForStats should reflect live updateAvailable from stored container', async () => {
  const containerExample = createContainerFixture({
    result: { tag: 'newer-tag' },
  });
  // image.tag.value is 'version', result.tag is 'newer-tag' => updateAvailable true
  const containers = [{ data: containerExample }];
  const collection = { find: () => containers };
  const db = {
    getCollection: () => collection,
    addCollection: () => ({ findOne: () => {}, insert: () => {} }),
  };
  container.createCollections(db);

  const result = container.getContainersForStats({});

  expect(result[0].updateAvailable).toBe(true);
});

test('getContainersForStats should return empty array when collection is not initialized', async () => {
  vi.resetModules();
  const freshContainer = await import('./container.js');
  const result = freshContainer.getContainersForStats();
  expect(result).toEqual([]);
});

test('getContainersForStats mutation isolation: mutating projection does not affect store', async () => {
  const containerExample = createContainerFixture();
  const containers = [{ data: containerExample }];
  const collection = {
    find: vi.fn(() => containers),
    findOne: vi.fn(() => null),
  };
  const db = {
    getCollection: () => collection,
    addCollection: () => ({ findOne: () => {}, insert: () => {} }),
  };
  container.createCollections(db);

  const result = container.getContainersForStats({});
  const projection = result[0];

  // Mutate the projected image sub-object
  (projection.image as Record<string, unknown>).id = 'MUTATED';
  (projection.image as Record<string, unknown>).name = 'MUTATED';
  projection.watcher = 'MUTATED';

  // The stored container's values are unchanged — re-fetch to confirm
  const rawResult = container.getContainersRaw({});
  expect(rawResult[0].image.id).toBe(containerExample.image.id);
  expect(rawResult[0].image.name).toBe(containerExample.image.name);
  expect(rawResult[0].watcher).toBe(containerExample.watcher);
});

test('getContainersForStats should return undefined agent for containers without agent field', async () => {
  const containerExample = createContainerFixture();
  // No agent field
  const containers = [{ data: containerExample }];
  const collection = { find: () => containers };
  const db = {
    getCollection: () => collection,
    addCollection: () => ({ findOne: () => {}, insert: () => {} }),
  };
  container.createCollections(db);

  const result = container.getContainersForStats({});

  expect(result[0].agent).toBeUndefined();
});

test('getContainers should preserve Map values when cloning', async () => {
  const metadataByKey = new Map([['release', '2026.03.05']]);
  const containerExample = createContainerFixture();
  containerExample.labels = {
    metadataByKey,
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

  const result = container.getContainers({});

  expect(result[0].labels.metadataByKey).toBeInstanceOf(Map);
  expect((result[0].labels.metadataByKey as unknown as Map<string, string>).get('release')).toBe(
    '2026.03.05',
  );
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

test('getContainers should exclude temporary rollback containers when requested by internal query flag', async () => {
  const collection = createFilterableCollection([
    {
      data: createContainerFixture({
        id: 'visible-container',
        name: 'service',
      }),
    },
    {
      data: createContainerFixture({
        id: 'rollback-container',
        name: 'service-old-1773933154786',
      }),
    },
  ]);
  const db = {
    getCollection: () => collection,
    addCollection: () => null,
  };
  container.createCollections(db);

  const results = container.getContainers({ excludeRollbackContainers: true });
  const total = container.getContainerCount({ excludeRollbackContainers: true });

  expect(collection.find).toHaveBeenCalledWith({});
  expect(results.map((item) => item.name)).toEqual(['service']);
  expect(total).toBe(1);
});

test('getContainers should invalidate excludeRollbackContainers query caches after rollback-name transitions', async () => {
  const collection = createFilterableCollection([
    {
      data: createContainerFixture({
        id: 'transitioning-container',
        name: 'service',
      }),
    },
  ]);
  const db = {
    getCollection: () => collection,
    addCollection: () => null,
  };
  container.createCollections(db);

  expect(container.getContainerCount({ excludeRollbackContainers: true })).toBe(1);
  const readCountAfterWarm = collection.find.mock.calls.length;

  expect(container.getContainerCount({ excludeRollbackContainers: true })).toBe(1);
  expect(collection.find.mock.calls.length).toBe(readCountAfterWarm);

  container.updateContainer(
    createContainerFixture({
      id: 'transitioning-container',
      name: 'service-old-1773933154786',
    }),
  );

  expect(container.getContainerCount({ excludeRollbackContainers: true })).toBe(0);
  expect(collection.find.mock.calls.length).toBeGreaterThan(readCountAfterWarm);
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

test('deleteContainer should forward replacementExpected on the remove event payload', async () => {
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
  container.deleteContainer(containerExample, { replacementExpected: true });
  expect(spyEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      id: containerExample.data.id,
      replacementExpected: true,
    }),
  );
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

test('cacheSecurityState should bound prune work per write', async () => {
  container.clearAllCachedSecurityState();
  const originalEntries = Map.prototype.entries;
  let totalEntrySteps = 0;
  let maxEntryStepsPerWrite = 0;

  const entriesSpy = vi.spyOn(Map.prototype, 'entries').mockImplementation(function () {
    const iterator = originalEntries.call(this);
    return {
      next() {
        totalEntrySteps += 1;
        return iterator.next();
      },
      [Symbol.iterator]() {
        return this;
      },
    } as IterableIterator<[unknown, unknown]>;
  });

  try {
    for (let index = 0; index < 30; index += 1) {
      const entryStepsBeforeWrite = totalEntrySteps;
      container.cacheSecurityState('counter-prune', `entry-${index}`, { status: 'ok', index });
      maxEntryStepsPerWrite = Math.max(
        maxEntryStepsPerWrite,
        totalEntrySteps - entryStepsBeforeWrite,
      );
    }

    expect(maxEntryStepsPerWrite).toBeLessThanOrEqual(12);
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

// #386: security-state cache must not cross-contaminate between controller-local and agent containers
test('insertContainer local container (no agent) should still consume cached security state', async () => {
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
  container.cacheSecurityState('local', 'nginx', securityData);
  const result = container.insertContainer(
    createContainerFixture({ watcher: 'local', name: 'nginx', agent: undefined }),
  );
  expect(result.security).toEqual(securityData);
  expect(container.getCachedSecurityState('local', 'nginx')).toBeUndefined();
});

test('insertContainer agent container should NOT consume or clear cached security state for same watcher+name', async () => {
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
  container.cacheSecurityState('local', 'nginx', securityData);
  const result = container.insertContainer(
    createContainerFixture({ watcher: 'local', name: 'nginx', agent: 'ml' }),
  );
  // agent container must NOT receive the controller's cached security state
  expect(result.security).toBeUndefined();
  // controller's local cache entry must remain intact
  expect(container.getCachedSecurityState('local', 'nginx')).toEqual(securityData);
  container.clearCachedSecurityState('local', 'nginx');
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

test('getContainers query cache eviction should happen before inserting new entries at capacity', () => {
  const collection = {
    find: vi.fn(() => [{ data: createContainerFixture() }]),
  };
  const db = {
    getCollection: () => collection,
    addCollection: () => null,
  };
  container.createCollections(db);
  collection.find.mockClear();

  const maxEntries = container.CONTAINERS_QUERY_CACHE_MAX_ENTRIES;
  for (let index = 0; index < maxEntries; index += 1) {
    container.getContainers({ watcher: `pre-evict-${index}` });
  }

  const queryCache = container._getContainersQueryCacheForTests();
  const originalSet = queryCache.set.bind(queryCache);
  const cacheSizesBeforeSet: number[] = [];
  const setSpy = vi.spyOn(queryCache, 'set').mockImplementation((cacheKey, cacheValue) => {
    cacheSizesBeforeSet.push(queryCache.size);
    return originalSet(cacheKey, cacheValue);
  });

  try {
    container.getContainers({ watcher: 'pre-evict-next' });
    expect(cacheSizesBeforeSet).toEqual([maxEntries - 1]);
  } finally {
    setSpy.mockRestore();
  }
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

test('getContainers should clone cached cyclic structures without throwing', () => {
  const containerExample = createContainerFixture();
  const cyclicLabels: Record<string, unknown> = { key: 'value' };
  cyclicLabels.self = cyclicLabels;
  containerExample.labels = cyclicLabels as Record<string, string>;

  const collection = {
    find: vi.fn(() => []),
  };
  const db = {
    getCollection: () => collection,
    addCollection: () => null,
  };
  container.createCollections(db);
  container._setContainersQueryCacheEntriesForTests([['[]', [containerExample]]]);

  let result: ReturnType<typeof container.getContainers> = [];
  expect(() => {
    result = container.getContainers({});
  }).not.toThrow();

  const clonedLabels = result[0].labels as Record<string, unknown>;
  expect(clonedLabels).not.toBe(containerExample.labels);
  expect(clonedLabels.self).toBe(clonedLabels);
});

test('security state prune should remove expired entries and trim oldest active entries', () => {
  const nowMs = Date.now();
  const maxEntries = container.SECURITY_STATE_CACHE_MAX_ENTRIES;
  container._setSecurityStateCacheEntryForTests('expired::entry', {
    security: { stale: true },
    expiresAt: nowMs - 1,
  });
  for (let index = 0; index <= maxEntries; index += 1) {
    container._setSecurityStateCacheEntryForTests(`active::${index}`, {
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

test('container query cache invalidation should avoid parsing cache keys during mutation lookups', () => {
  const watcherAKey = '[["watcher","watcher-a"]]';
  const watcherBKey = '[["watcher","watcher-b"]]';
  container._setContainersQueryCacheEntriesForTests([
    [watcherAKey, []],
    [watcherBKey, []],
  ]);

  const parseSpy = vi.spyOn(JSON, 'parse');
  try {
    parseSpy.mockClear();
    container._invalidateContainersCacheForMutationForTests(undefined, { watcher: 'watcher-a' });

    expect(parseSpy).not.toHaveBeenCalled();
    expect(container._getContainersQueryCacheForTests().has(watcherAKey)).toBe(false);
    expect(container._getContainersQueryCacheForTests().has(watcherBKey)).toBe(true);
  } finally {
    parseSpy.mockRestore();
  }
});

test('container query cache indexing should reuse existing reverse-index sets for shared values', () => {
  const cacheKeyOne = '[["watcher","watcher-a"],["status","running"]]';
  const cacheKeyTwo = '[["watcher","watcher-a"],["name","api"]]';
  container._setContainersQueryCacheEntriesForTests([
    [cacheKeyOne, []],
    [cacheKeyTwo, []],
  ]);

  const watcherValueSet = container
    ._getContainersQueryCacheReverseIndexForTests()
    .get('watcher')
    ?.get(JSON.stringify('watcher-a'));
  expect(watcherValueSet?.has(cacheKeyOne)).toBe(true);
  expect(watcherValueSet?.has(cacheKeyTwo)).toBe(true);

  container._deleteContainersQueryCacheEntryForTests(cacheKeyOne);
  expect(watcherValueSet?.has(cacheKeyTwo)).toBe(true);
});

test('container query cache invalidation should keep candidate entries when full query does not match', () => {
  const cacheKey = '[["watcher","watcher-a"],["status","paused"]]';
  container._setContainersQueryCacheEntriesForTests([[cacheKey, []]]);

  container._invalidateContainersCacheForMutationForTests(undefined, {
    watcher: 'watcher-a',
    status: 'running',
  });

  expect(container._getContainersQueryCacheForTests().has(cacheKey)).toBe(true);
});

test('security state incremental prune should reset iterator when cache is empty', () => {
  const nowMs = Date.now();
  container._setSecurityStateCacheEntryForTests('incremental_seed', {
    security: { seeded: true },
    expiresAt: nowMs + 60_000,
  });
  container._pruneSecurityStateCacheIncrementallyForTests(nowMs);
  container.clearAllCachedSecurityState();

  expect(() => container._pruneSecurityStateCacheIncrementallyForTests(nowMs)).not.toThrow();
});

test('container query cache indexing should tolerate non-serializable query values', () => {
  const originalStringify = JSON.stringify;
  const stringifySpy = vi.spyOn(JSON, 'stringify').mockImplementation((value, replacer, space) => {
    if (value === 'trigger-nonjson') {
      throw new Error('cannot stringify');
    }
    return originalStringify(value as never, replacer as never, space as never);
  });

  try {
    const cacheKey = '[["watcher","trigger-nonjson"]]';
    container._setContainersQueryCacheEntriesForTests([[cacheKey, []]]);
    container._invalidateContainersCacheForMutationForTests(undefined, {
      watcher: 'trigger-nonjson',
    });
    expect(container._getContainersQueryCacheForTests().has(cacheKey)).toBe(false);
  } finally {
    stringifySpy.mockRestore();
  }
});

test('container query cache entry delete should ignore orphan cache metadata misses', () => {
  const cache = container._getContainersQueryCacheForTests();
  cache.set('orphan-cache-key', []);

  expect(() =>
    container._deleteContainersQueryCacheEntryForTests('orphan-cache-key'),
  ).not.toThrow();
  expect(cache.has('orphan-cache-key')).toBe(false);
});

test('container query cache entry delete should tolerate missing reverse-index path maps', () => {
  const cacheKey = '[["watcher","watcher-a"]]';
  container._setContainersQueryCacheEntriesForTests([[cacheKey, []]]);
  container._getContainersQueryCacheReverseIndexForTests().delete('watcher');

  expect(() => container._deleteContainersQueryCacheEntryForTests(cacheKey)).not.toThrow();
  expect(container._getContainersQueryCacheForTests().has(cacheKey)).toBe(false);
});

test('container query cache entry delete should tolerate missing reverse-index value sets', () => {
  const cacheKey = '[["watcher","watcher-a"]]';
  container._setContainersQueryCacheEntriesForTests([[cacheKey, []]]);
  const pathValueMap = container._getContainersQueryCacheReverseIndexForTests().get('watcher');
  pathValueMap?.delete(JSON.stringify('watcher-a'));

  expect(() => container._deleteContainersQueryCacheEntryForTests(cacheKey)).not.toThrow();
  expect(container._getContainersQueryCacheForTests().has(cacheKey)).toBe(false);
});

test('container query cache invalidation should evict candidate keys with missing parsed entries', () => {
  const cacheKey = '[["watcher","watcher-a"]]';
  container._setContainersQueryCacheEntriesForTests([[cacheKey, []]]);
  container._getContainersQueryCacheParsedEntriesForTests().delete(cacheKey);

  container._invalidateContainersCacheForMutationForTests(undefined, { watcher: 'watcher-a' });

  expect(container._getContainersQueryCacheForTests().has(cacheKey)).toBe(false);
});

test('getContainers query cache eviction should stop when iterator returns undefined keys', () => {
  const collection = {
    find: vi.fn(() => [{ data: createContainerFixture() }]),
  };
  const db = {
    getCollection: () => collection,
    addCollection: () => null,
  };
  container.createCollections(db);
  collection.find.mockClear();

  const maxEntries = container.CONTAINERS_QUERY_CACHE_MAX_ENTRIES;
  for (let index = 0; index <= maxEntries; index += 1) {
    container.getContainers({ watcher: `evict-${index}` });
  }

  const queryCache = container._getContainersQueryCacheForTests();
  const keysSpy = vi.spyOn(queryCache, 'keys').mockImplementation(
    () =>
      ({
        next: () => ({ done: false, value: undefined }),
        [Symbol.iterator]() {
          return this;
        },
      }) as IterableIterator<string>,
  );
  try {
    container.getContainers({ watcher: 'evict-extra' });
    expect(queryCache.size).toBe(maxEntries + 1);
  } finally {
    keysSpy.mockRestore();
  }
});

test('getContainers defensive cache eviction should remove oldest key after a transient iterator miss', () => {
  const collection = {
    find: vi.fn(() => [{ data: createContainerFixture() }]),
  };
  const db = {
    getCollection: () => collection,
    addCollection: () => null,
  };
  container.createCollections(db);
  collection.find.mockClear();

  const maxEntries = container.CONTAINERS_QUERY_CACHE_MAX_ENTRIES;
  for (let index = 0; index < maxEntries; index += 1) {
    container.getContainers({ watcher: `defensive-${index}` });
  }

  const queryCache = container._getContainersQueryCacheForTests();
  const oldestKey = '[["watcher","defensive-0"]]';
  const originalKeys = queryCache.keys.bind(queryCache);
  const keysSpy = vi
    .spyOn(queryCache, 'keys')
    .mockImplementationOnce(
      () =>
        ({
          next: () => ({ done: false, value: undefined }),
          [Symbol.iterator]() {
            return this;
          },
        }) as IterableIterator<string>,
    )
    .mockImplementation(() => originalKeys());

  try {
    container.getContainers({ watcher: 'defensive-next' });

    expect(queryCache.size).toBe(maxEntries);
    expect(queryCache.has(oldestKey)).toBe(false);
  } finally {
    keysSpy.mockRestore();
  }
});

test('getValueByPath helper should reject unsafe and invalid traversal paths', () => {
  expect(
    container._getValueByPathForTests({ safe: { value: 'ok' } }, '__proto__.polluted'),
  ).toBeUndefined();
  expect(container._getValueByPathForTests({ name: 'plain-string' }, 'name.value')).toBeUndefined();
});

describe('hasContainerChanged', () => {
  test('should return false for identical containers', () => {
    const a = createContainerFixture();
    const b = createContainerFixture();
    expect(container.hasContainerChanged(a, b)).toBe(false);
  });

  test('should return true when updateAvailable changes', () => {
    const a = createContainerFixture({ updateAvailable: false });
    const b = createContainerFixture({ updateAvailable: true });
    expect(container.hasContainerChanged(a, b)).toBe(true);
  });

  test('should return true when result.tag changes', () => {
    const a = createContainerFixture({ result: { tag: '1.0.0' } });
    const b = createContainerFixture({ result: { tag: '2.0.0' } });
    expect(container.hasContainerChanged(a, b)).toBe(true);
  });

  test('should return true when result.digest changes', () => {
    const a = createContainerFixture({ result: { tag: 'v1', digest: 'sha256:aaa' } });
    const b = createContainerFixture({ result: { tag: 'v1', digest: 'sha256:bbb' } });
    expect(container.hasContainerChanged(a, b)).toBe(true);
  });

  test('should return true when status changes', () => {
    const a = createContainerFixture({ status: 'running' });
    const b = createContainerFixture({ status: 'stopped' });
    expect(container.hasContainerChanged(a, b)).toBe(true);
  });

  test('should return true when error appears', () => {
    const a = createContainerFixture();
    const b = createContainerFixture({ error: { message: 'connection refused' } });
    expect(container.hasContainerChanged(a, b)).toBe(true);
  });

  test('should return true when error is cleared', () => {
    const a = createContainerFixture({ error: { message: 'connection refused' } });
    const b = createContainerFixture();
    expect(container.hasContainerChanged(a, b)).toBe(true);
  });

  test('should return true when image.tag.value changes', () => {
    const a = createContainerFixture();
    const imageB = {
      ...createContainerFixture().image,
      tag: { value: 'new-version', semver: false },
    };
    const b = createContainerFixture({ image: imageB });
    expect(container.hasContainerChanged(a, b)).toBe(true);
  });

  test('should return true when security state changes', () => {
    const a = createContainerFixture({ security: undefined });
    const b = createContainerFixture({
      security: { scan: { scanner: 'trivy', status: 'passed' } },
    });
    expect(container.hasContainerChanged(a, b)).toBe(true);
  });

  test('should return false when security has same data in different key order', () => {
    const a = createContainerFixture({
      security: {
        scan: {
          scanner: 'trivy',
          image: 'registry/image:1.2.3',
          scannedAt: '2024-01-01T00:00:00.000Z',
          status: 'passed',
          blockSeverities: [],
          blockingCount: 0,
          summary: {
            unknown: 0,
            low: 0,
            medium: 0,
            high: 0,
            critical: 0,
          },
          vulnerabilities: [],
        },
      },
    });
    const b = createContainerFixture({
      security: {
        scan: {
          vulnerabilities: [],
          summary: {
            critical: 0,
            high: 0,
            medium: 0,
            low: 0,
            unknown: 0,
          },
          blockingCount: 0,
          blockSeverities: [],
          status: 'passed',
          scannedAt: '2024-01-01T00:00:00.000Z',
          image: 'registry/image:1.2.3',
          scanner: 'trivy',
        },
      },
    });

    expect(container.hasContainerChanged(a, b)).toBe(false);
  });

  test('should reuse cached security hashes across repeated comparisons', () => {
    let securityOwnKeysCount = 0;
    const security = new Proxy(
      {
        scan: {
          scanner: 'trivy',
          image: 'registry/image:1.2.3',
          scannedAt: '2024-01-01T00:00:00.000Z',
          status: 'passed',
          blockSeverities: [],
          blockingCount: 0,
          summary: {
            unknown: 0,
            low: 0,
            medium: 0,
            high: 0,
            critical: 0,
          },
          vulnerabilities: [],
        },
      },
      {
        ownKeys(target) {
          securityOwnKeysCount += 1;
          return Reflect.ownKeys(target);
        },
      },
    );
    const a = createContainerFixture({
      id: 'container-security-hash-cache',
      security,
    });
    const b = createContainerFixture({
      id: 'container-security-hash-cache',
      security: {
        scan: {
          vulnerabilities: [],
          summary: {
            critical: 0,
            high: 0,
            medium: 0,
            low: 0,
            unknown: 0,
          },
          blockingCount: 0,
          blockSeverities: [],
          status: 'passed',
          scannedAt: '2024-01-01T00:00:00.000Z',
          image: 'registry/image:1.2.3',
          scanner: 'trivy',
        },
      },
    });

    expect(container.hasContainerChanged(a, b)).toBe(false);
    const initialSecurityOwnKeysCount = securityOwnKeysCount;
    expect(initialSecurityOwnKeysCount).toBeGreaterThan(0);

    expect(container.hasContainerChanged(a, b)).toBe(false);
    expect(securityOwnKeysCount).toBe(initialSecurityOwnKeysCount);
  });

  test('updateContainer should reuse the stored security hash when the next payload omits security', () => {
    const collection = createFilterableCollection([]);
    const db = {
      getCollection: () => collection,
      addCollection: () => null,
    };
    container.createCollections(db);

    let securityOwnKeysCount = 0;
    const security = new Proxy(
      {
        scan: {
          vulnerabilities: [],
          summary: {
            critical: 0,
            high: 0,
            medium: 0,
            low: 0,
            unknown: 0,
          },
          blockingCount: 0,
          blockSeverities: [],
          status: 'passed',
          scannedAt: '2024-01-01T00:00:00.000Z',
          image: 'registry/image:1.2.3',
          scanner: 'trivy',
        },
      },
      {
        ownKeys(target) {
          securityOwnKeysCount += 1;
          return Reflect.ownKeys(target);
        },
      },
    );
    const existingContainer = createContainerFixture({
      id: 'stored-security-hash-cache',
      updateAvailable: false,
      security,
    });

    container.insertContainer(existingContainer);
    const initialSecurityOwnKeysCount = securityOwnKeysCount;
    expect(initialSecurityOwnKeysCount).toBeGreaterThan(0);

    const updatedContainer = container.updateContainer({
      ...existingContainer,
      updateAvailable: true,
      security: undefined,
    });

    expect(updatedContainer).toBeDefined();
    expect(securityOwnKeysCount).toBe(initialSecurityOwnKeysCount);
  });

  test('should compare primitive security values without object hashing', () => {
    const a = createContainerFixture({ security: false as any });
    const b = createContainerFixture({ security: false as any });
    const c = createContainerFixture({ security: true as any });

    expect(container.hasContainerChanged(a, b)).toBe(false);
    expect(container.hasContainerChanged(a, c)).toBe(true);
  });

  test('should return false when only timestamp-like metadata differs', () => {
    const a = createContainerFixture({ updateDetectedAt: '2024-01-01T00:00:00Z' });
    const b = createContainerFixture({ updateDetectedAt: '2024-12-31T23:59:59Z' });
    expect(container.hasContainerChanged(a, b)).toBe(false);
  });
});

test('updateContainer should not emit when container data is unchanged', async () => {
  const existingContainer = {
    data: createContainerFixture({
      id: 'unchanged-container',
      status: 'running',
      updateAvailable: false,
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
    id: 'unchanged-container',
    status: 'running',
    updateAvailable: false,
  });
  const spyEvent = vi.spyOn(event, 'emitContainerUpdated');
  container.createCollections(db);

  container.updateContainer(containerToSave);

  expect(collection.update).toHaveBeenCalledTimes(1);
  expect(spyEvent).not.toHaveBeenCalled();
});

test('pending fresh state helpers should ignore invalid container identities', () => {
  container.markPendingFreshStateAfterManualUpdate({}, 100);
  container.markPendingFreshStateAfterManualUpdate({ watcher: '', name: 'nginx' }, 200);

  expect(container.getPendingFreshStateAfterManualUpdateAt({ watcher: 'docker', name: '' })).toBe(
    undefined,
  );
  expect(container._getPendingFreshStateAfterManualUpdateForTests().size).toBe(0);

  container.clearPendingFreshStateAfterManualUpdate({ watcher: 'docker', name: '' });
  expect(container._getPendingFreshStateAfterManualUpdateForTests().size).toBe(0);
});

test('pending fresh state helpers should store and clear agent-qualified keys', () => {
  container.markPendingFreshStateAfterManualUpdate(
    { agent: 'edge-a', watcher: 'docker', name: 'nginx' },
    123,
  );
  container.markPendingFreshStateAfterManualUpdate({ watcher: 'docker', name: 'redis' }, 456);

  expect(
    container.getPendingFreshStateAfterManualUpdateAt({
      agent: 'edge-a',
      watcher: 'docker',
      name: 'nginx',
    }),
  ).toBe(123);
  expect(
    container.getPendingFreshStateAfterManualUpdateAt({ watcher: 'docker', name: 'redis' }),
  ).toBe(456);
  expect([...container._getPendingFreshStateAfterManualUpdateForTests().entries()]).toEqual([
    ['edge-a::docker::nginx', 123],
    ['::docker::redis', 456],
  ]);

  container.clearPendingFreshStateAfterManualUpdate({
    agent: 'edge-a',
    watcher: 'docker',
    name: 'nginx',
  });
  container.clearPendingFreshStateAfterManualUpdate({ watcher: 'docker', name: 'redis' });

  expect(container._getPendingFreshStateAfterManualUpdateForTests().size).toBe(0);
});

// Rollback container SSE suppression tests

test('insertContainer with a rollback-named container should NOT emit emitContainerAdded', () => {
  const collection = {
    findOne: () => {},
    insert: () => {},
  };
  const db = {
    getCollection: () => collection,
    addCollection: () => null,
  };
  const spyAdded = vi.spyOn(event, 'emitContainerAdded');
  container.createCollections(db);
  container.insertContainer(createContainerFixture({ name: 'service-old-1773933154786' }));
  expect(spyAdded).not.toHaveBeenCalled();
});

test('insertContainer with a normal container name DOES emit emitContainerAdded', () => {
  const collection = {
    findOne: () => {},
    insert: () => {},
  };
  const db = {
    getCollection: () => collection,
    addCollection: () => null,
  };
  const spyAdded = vi.spyOn(event, 'emitContainerAdded');
  container.createCollections(db);
  container.insertContainer(createContainerFixture({ name: 'service' }));
  expect(spyAdded).toHaveBeenCalledTimes(1);
});

test('updateContainer where the resulting name matches the rollback pattern does NOT emit emitContainerUpdated', () => {
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
  const spyUpdated = vi.spyOn(event, 'emitContainerUpdated');
  container.createCollections(db);
  container.updateContainer(createContainerFixture({ name: 'api-old-1773933154786' }));
  expect(spyUpdated).not.toHaveBeenCalled();
});

test('updateContainer where a rollback-named container is renamed back to a normal name DOES emit emitContainerUpdated', () => {
  const rollbackFixture = createContainerFixture({
    id: 'un-rollback-container',
    name: 'service-old-1773933154786',
    status: 'running',
  });
  const existingDoc = { data: rollbackFixture };
  const collection = {
    findOne: () => existingDoc,
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
  const spyUpdated = vi.spyOn(event, 'emitContainerUpdated');
  container.createCollections(db);

  // Simulate rollback monitor restoring the original name — the final name is no longer rollback-patterned
  container.updateContainer(
    createContainerFixture({
      id: 'un-rollback-container',
      name: 'service',
      status: 'running',
    }),
  );

  expect(spyUpdated).toHaveBeenCalledTimes(1);
  expect(spyUpdated.mock.calls[0][0]).toMatchObject({ name: 'service' });
});

test('deleteContainer with a rollback-named container does NOT emit emitContainerRemoved', () => {
  const rollbackFixture = createContainerFixture({
    id: 'rollback-to-delete',
    name: 'worker-old-1773933154786',
  });
  const collection = {
    findOne: () => ({ data: rollbackFixture }),
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
  const spyRemoved = vi.spyOn(event, 'emitContainerRemoved');
  container.createCollections(db);
  container.deleteContainer('rollback-to-delete');
  expect(spyRemoved).not.toHaveBeenCalled();
});

test('deleteContainer with a normal container name DOES emit emitContainerRemoved', () => {
  const normalFixture = createContainerFixture({
    id: 'normal-to-delete',
    name: 'worker',
  });
  const collection = {
    findOne: () => ({ data: normalFixture }),
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
  const spyRemoved = vi.spyOn(event, 'emitContainerRemoved');
  container.createCollections(db);
  container.deleteContainer('normal-to-delete');
  expect(spyRemoved).toHaveBeenCalledTimes(1);
});

// ─── Operator-injection / ReDoS guard (I-4) ──────────────────────────────────

describe('getSafeContainerQueryEntries / operator injection guard', () => {
  test('drops entry whose value is an operator object ($regex)', () => {
    const collection = createFilterableCollection([
      { data: createContainerFixture({ id: 'c1', watcher: 'docker' }) },
    ]);
    const db = { getCollection: () => collection, addCollection: () => null };
    container.createCollections(db);

    // A $regex operator object must not reach LokiJS
    container.getContainers({ watcher: { $regex: '.*' } } as Record<string, unknown>);
    // No filter was applied — collection.find was called with an empty filter (only the
    // operator-bearing entry was dropped). The important guarantee is that the
    // operator object was NOT forwarded to LokiJS, so re2js's ReDoS guarantee holds.
    expect(collection.find).toHaveBeenCalledWith({});
  });

  test('drops entry whose value is an operator object ($ne)', () => {
    const collection = createFilterableCollection([
      { data: createContainerFixture({ id: 'c1', status: 'running' }) },
    ]);
    const db = { getCollection: () => collection, addCollection: () => null };
    container.createCollections(db);

    container.getContainers({ status: { $ne: null } } as Record<string, unknown>);
    expect(collection.find).toHaveBeenCalledWith({});
  });

  test('drops entry whose value is an array', () => {
    const collection = createFilterableCollection([
      { data: createContainerFixture({ id: 'c1', watcher: 'docker' }) },
    ]);
    const db = { getCollection: () => collection, addCollection: () => null };
    container.createCollections(db);

    container.getContainers({ watcher: ['docker', 'podman'] } as Record<string, unknown>);
    expect(collection.find).toHaveBeenCalledWith({});
  });

  test('operator-object entry does NOT appear in cache key', () => {
    const collection = createFilterableCollection([
      { data: createContainerFixture({ id: 'c1', watcher: 'docker' }) },
    ]);
    const db = { getCollection: () => collection, addCollection: () => null };
    container.createCollections(db);

    // First call with operator value
    container.getContainers({ watcher: { $regex: 'dock.*' } } as Record<string, unknown>);
    const cacheAfterOperator = container._getContainersQueryCacheForTests();
    // Cache key must be the same as an empty-query call (no watcher entry serialised)
    const emptyQueryKey = JSON.stringify([]);
    expect(cacheAfterOperator.has(emptyQueryKey)).toBe(true);
  });

  test('string value passes through and filters correctly', () => {
    const collection = createFilterableCollection([
      { data: createContainerFixture({ id: 'c1', watcher: 'docker' }) },
      { data: createContainerFixture({ id: 'c2', watcher: 'podman' }) },
    ]);
    const db = { getCollection: () => collection, addCollection: () => null };
    container.createCollections(db);

    const result = container.getContainers({ watcher: 'docker' });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('c1');
    expect(collection.find).toHaveBeenCalledWith({ 'data.watcher': 'docker' });
  });

  test('boolean value passes through and filters correctly', () => {
    const collection = createFilterableCollection([
      { data: createContainerFixture({ id: 'c1', updateAvailable: true }) },
      { data: createContainerFixture({ id: 'c2', updateAvailable: false }) },
    ]);
    const db = { getCollection: () => collection, addCollection: () => null };
    container.createCollections(db);

    const result = container.getContainers({ updateAvailable: true });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('c1');
    expect(collection.find).toHaveBeenCalledWith({ 'data.updateAvailable': true });
  });

  test('number value passes through', () => {
    const collection = createFilterableCollection([
      { data: createContainerFixture({ id: 'c1', watcher: 'docker' }) },
    ]);
    const db = { getCollection: () => collection, addCollection: () => null };
    container.createCollections(db);

    container.getContainers({ someNumericField: 42 } as Record<string, unknown>);
    expect(collection.find).toHaveBeenCalledWith({ 'data.someNumericField': 42 });
  });

  test('null value passes through (literal null match)', () => {
    const collection = createFilterableCollection([
      { data: createContainerFixture({ id: 'c1', watcher: 'docker' }) },
    ]);
    const db = { getCollection: () => collection, addCollection: () => null };
    container.createCollections(db);

    container.getContainers({ someField: null } as Record<string, unknown>);
    expect(collection.find).toHaveBeenCalledWith({ 'data.someField': null });
  });

  test('undefined value passes through (literal undefined match)', () => {
    const collection = createFilterableCollection([
      { data: createContainerFixture({ id: 'c1', watcher: 'docker' }) },
    ]);
    const db = { getCollection: () => collection, addCollection: () => null };
    container.createCollections(db);

    container.getContainers({ someField: undefined } as Record<string, unknown>);
    expect(collection.find).toHaveBeenCalledWith({ 'data.someField': undefined });
  });

  test('proto-pollution key guard still drops __proto__ keys', () => {
    const collection = createFilterableCollection([
      { data: createContainerFixture({ id: 'c1', watcher: 'docker' }) },
    ]);
    const db = { getCollection: () => collection, addCollection: () => null };
    container.createCollections(db);

    // JSON.parse creates an own enumerable '__proto__' data property without
    // mutating Object.prototype (it bypasses the __proto__ setter).
    const query = JSON.parse('{"watcher":"docker","__proto__":"bad"}') as Record<string, unknown>;
    container.getContainers(query);
    // Only the safe 'watcher' key should appear in the filter
    expect(collection.find).toHaveBeenCalledWith({ 'data.watcher': 'docker' });
  });

  test('proto-pollution key guard still drops prototype and constructor keys', () => {
    const collection = createFilterableCollection([
      { data: createContainerFixture({ id: 'c1', watcher: 'docker' }) },
    ]);
    const db = { getCollection: () => collection, addCollection: () => null };
    container.createCollections(db);

    container.getContainers({
      'foo.prototype.bar': 'x',
      'baz.constructor.qux': 'y',
      watcher: 'docker',
    } as Record<string, unknown>);
    expect(collection.find).toHaveBeenCalledWith({ 'data.watcher': 'docker' });
  });

  test('getContainersRaw with operator value does not forward the operator', () => {
    const collection = createFilterableCollection([
      { data: createContainerFixture({ id: 'c1', watcher: 'docker' }) },
    ]);
    const db = { getCollection: () => collection, addCollection: () => null };
    container.createCollections(db);

    container.getContainersRaw({ watcher: { $regex: 'dock.*' } } as Record<string, unknown>);
    expect(collection.find).toHaveBeenCalledWith({});
  });

  test('getContainerCount with operator value counts all (operator neutralised)', () => {
    const collection = createFilterableCollection([
      { data: createContainerFixture({ id: 'c1', watcher: 'docker' }) },
      { data: createContainerFixture({ id: 'c2', watcher: 'podman' }) },
    ]);
    const db = { getCollection: () => collection, addCollection: () => null };
    container.createCollections(db);

    // Operator is dropped → filter is empty → all containers returned
    const count = container.getContainerCount({ watcher: { $regex: '.*' } } as Record<
      string,
      unknown
    >);
    expect(count).toBe(2);
    expect(collection.find).toHaveBeenCalledWith({});
  });

  test('getContainersForStats with operator value does not forward the operator', () => {
    const collection = createFilterableCollection([
      { data: createContainerFixture({ id: 'c1', watcher: 'docker' }) },
    ]);
    const db = { getCollection: () => collection, addCollection: () => null };
    container.createCollections(db);

    container.getContainersForStats({ watcher: { $ne: 'docker' } } as Record<string, unknown>);
    expect(collection.find).toHaveBeenCalledWith({});
  });
});

describe('updateLifecycleCache carry-forward', () => {
  function makeDigestUpdateFixture(overrides: Record<string, unknown> = {}) {
    const base = createContainerFixture();
    return {
      ...base,
      watcher: 'local',
      name: 'myapp',
      image: {
        ...base.image,
        digest: { watch: true, value: 'sha256:old', repo: undefined },
      },
      result: { tag: 'version', digest: 'sha256:new' },
      ...overrides,
    };
  }

  test('carries forward updateDetectedAt and firstSeenAt on container recreation', () => {
    const twelveHoursAgo = new Date(Date.now() - 12 * 3600 * 1000).toISOString();
    const oldFixture = makeDigestUpdateFixture({
      id: 'lifecycle-old-1',
      updateDetectedAt: twelveHoursAgo,
      firstSeenAt: twelveHoursAgo,
    });
    const collection = createFilterableCollection([{ data: oldFixture }]);
    const db = { getCollection: () => collection, addCollection: () => null };
    container.createCollections(db);
    container.deleteContainer('lifecycle-old-1', { replacementExpected: true });
    const newFixture = makeDigestUpdateFixture({ id: 'lifecycle-new-1' });
    const inserted = container.insertContainer(newFixture);
    expect(inserted.updateDetectedAt).toBe(twelveHoursAgo);
    expect(inserted.firstSeenAt).toBe(twelveHoursAgo);
  });

  test('does not carry forward when the update result changed', () => {
    const twelveHoursAgo = new Date(Date.now() - 12 * 3600 * 1000).toISOString();
    const oldFixture = makeDigestUpdateFixture({
      id: 'lifecycle-old-2',
      updateDetectedAt: twelveHoursAgo,
      firstSeenAt: twelveHoursAgo,
    });
    const collection = createFilterableCollection([{ data: oldFixture }]);
    const db = { getCollection: () => collection, addCollection: () => null };
    container.createCollections(db);
    container.deleteContainer('lifecycle-old-2', { replacementExpected: true });
    const newFixture = makeDigestUpdateFixture({
      id: 'lifecycle-new-2',
      result: { tag: 'version', digest: 'sha256:completely-different' },
    });
    const inserted = container.insertContainer(newFixture);
    expect(inserted.updateDetectedAt).not.toBe(twelveHoursAgo);
    expect(typeof inserted.updateDetectedAt).toBe('string');
  });

  test('does not cache when deleteContainer is called without replacementExpected', () => {
    const twelveHoursAgo = new Date(Date.now() - 12 * 3600 * 1000).toISOString();
    const oldFixture = makeDigestUpdateFixture({
      id: 'lifecycle-old-3',
      updateDetectedAt: twelveHoursAgo,
      firstSeenAt: twelveHoursAgo,
    });
    const collection = createFilterableCollection([{ data: oldFixture }]);
    const db = { getCollection: () => collection, addCollection: () => null };
    container.createCollections(db);
    container.deleteContainer('lifecycle-old-3');
    const newFixture = makeDigestUpdateFixture({ id: 'lifecycle-new-3' });
    const inserted = container.insertContainer(newFixture);
    expect(inserted.updateDetectedAt).not.toBe(twelveHoursAgo);
  });

  test('does not carry forward when new container has no raw update', () => {
    const twelveHoursAgo = new Date(Date.now() - 12 * 3600 * 1000).toISOString();
    const oldFixture = makeDigestUpdateFixture({
      id: 'lifecycle-old-4',
      updateDetectedAt: twelveHoursAgo,
      firstSeenAt: twelveHoursAgo,
    });
    const collection = createFilterableCollection([{ data: oldFixture }]);
    const db = { getCollection: () => collection, addCollection: () => null };
    container.createCollections(db);
    container.deleteContainer('lifecycle-old-4', { replacementExpected: true });
    const base = createContainerFixture();
    const newFixture = {
      ...base,
      id: 'lifecycle-new-4',
      watcher: 'local',
      name: 'myapp',
      image: {
        ...base.image,
        digest: { watch: true, value: 'sha256:new', repo: undefined },
      },
      result: { tag: 'version', digest: 'sha256:new' },
    };
    const inserted = container.insertContainer(newFixture);
    expect(inserted.updateDetectedAt).toBeUndefined();
  });

  test('treats the lifecycle cache entry as absent when it has expired', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-06-01T00:00:00.000Z'));
      const twelveHoursAgo = new Date(Date.now() - 12 * 3600 * 1000).toISOString();
      const oldFixture = makeDigestUpdateFixture({
        id: 'lifecycle-old-5',
        updateDetectedAt: twelveHoursAgo,
        firstSeenAt: twelveHoursAgo,
      });
      const collection = createFilterableCollection([{ data: oldFixture }]);
      container.createCollections({ getCollection: () => collection, addCollection: () => null });
      container.deleteContainer('lifecycle-old-5', { replacementExpected: true });
      vi.advanceTimersByTime(container.UPDATE_LIFECYCLE_CACHE_TTL_MS + 1);
      const newFixture = makeDigestUpdateFixture({ id: 'lifecycle-new-5' });
      const inserted = container.insertContainer(newFixture);
      expect(inserted.updateDetectedAt).not.toBe(twelveHoursAgo);
      expect(typeof inserted.updateDetectedAt).toBe('string');
    } finally {
      vi.useRealTimers();
    }
  });

  test('does not write cache when old container has no updateDetectedAt', () => {
    const oldFixture = makeDigestUpdateFixture({ id: 'lifecycle-old-6' });
    const collection = createFilterableCollection([{ data: oldFixture }]);
    const db = { getCollection: () => collection, addCollection: () => null };
    container.createCollections(db);
    container.deleteContainer('lifecycle-old-6', { replacementExpected: true });
    // No updateDetectedAt on the old container → no cache entry written
    const lifecycleCache = container._getUpdateLifecycleCacheForTests();
    expect(lifecycleCache.has('local::myapp')).toBe(false);
    const newFixture = makeDigestUpdateFixture({ id: 'lifecycle-new-6' });
    const inserted = container.insertContainer(newFixture);
    expect(typeof inserted.updateDetectedAt).toBe('string');
  });

  test('carries forward updateDetectedAt but not firstSeenAt when old container had no firstSeenAt', () => {
    const twelveHoursAgo = new Date(Date.now() - 12 * 3600 * 1000).toISOString();
    const oldFixture = makeDigestUpdateFixture({
      id: 'lifecycle-old-7',
      updateDetectedAt: twelveHoursAgo,
    });
    const collection = createFilterableCollection([{ data: oldFixture }]);
    const db = { getCollection: () => collection, addCollection: () => null };
    container.createCollections(db);
    container.deleteContainer('lifecycle-old-7', { replacementExpected: true });
    const newFixture = makeDigestUpdateFixture({ id: 'lifecycle-new-7' });
    const inserted = container.insertContainer(newFixture);
    expect(inserted.updateDetectedAt).toBe(twelveHoursAgo);
    expect(inserted.firstSeenAt).not.toBeUndefined();
    expect(typeof inserted.firstSeenAt).toBe('string');
  });

  test('does not overwrite existing incoming updateDetectedAt with cached value', () => {
    const twelveHoursAgo = new Date(Date.now() - 12 * 3600 * 1000).toISOString();
    const oldFixture = makeDigestUpdateFixture({
      id: 'lifecycle-old-8',
      updateDetectedAt: twelveHoursAgo,
      firstSeenAt: twelveHoursAgo,
    });
    const collection = createFilterableCollection([{ data: oldFixture }]);
    const db = { getCollection: () => collection, addCollection: () => null };
    container.createCollections(db);
    container.deleteContainer('lifecycle-old-8', { replacementExpected: true });
    const newFixture = makeDigestUpdateFixture({
      id: 'lifecycle-new-8',
      updateDetectedAt: '2026-01-01T00:00:00.000Z',
    });
    const inserted = container.insertContainer(newFixture);
    expect(inserted.updateDetectedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  test('evicts oldest lifecycle cache entries when size cap is exceeded', () => {
    const maxEntries = container.UPDATE_LIFECYCLE_CACHE_MAX_ENTRIES;
    const fixtures = [];
    const oldTimestamp = new Date(Date.now() - 1000).toISOString();
    for (let i = 0; i <= maxEntries; i++) {
      fixtures.push({
        data: makeDigestUpdateFixture({
          id: `lifecycle-evict-${i}`,
          name: `evict-app-${i}`,
          updateDetectedAt: oldTimestamp,
          firstSeenAt: oldTimestamp,
        }),
      });
    }
    const collection = createFilterableCollection(fixtures);
    container.createCollections({ getCollection: () => collection, addCollection: () => null });
    for (let i = 0; i <= maxEntries; i++) {
      container.deleteContainer(`lifecycle-evict-${i}`, { replacementExpected: true });
    }
    const lifecycleCache = container._getUpdateLifecycleCacheForTests();
    expect(lifecycleCache.size).toBeLessThanOrEqual(maxEntries);
    expect(lifecycleCache.has('local::evict-app-0')).toBe(false);
  });

  test('getResultSignature handles missing result tag and digest fields', () => {
    // Exercise the ?? null branches in getResultSignature for tag and digest
    const oldTimestamp = new Date(Date.now() - 1000).toISOString();
    const base = createContainerFixture();
    const oldFixture = {
      ...base,
      id: 'lifecycle-sig-old',
      watcher: 'local',
      name: 'myapp-sig',
      image: {
        ...base.image,
        digest: { watch: true, value: 'sha256:old', repo: undefined },
      },
      result: { digest: 'sha256:new' }, // no 'tag' field
      updateDetectedAt: oldTimestamp,
      firstSeenAt: oldTimestamp,
    };
    const collection = createFilterableCollection([{ data: oldFixture }]);
    container.createCollections({ getCollection: () => collection, addCollection: () => null });
    container.deleteContainer('lifecycle-sig-old', { replacementExpected: true });
    // Insert new fixture with same result signature (no tag field, same digest)
    const newFixture = {
      ...base,
      id: 'lifecycle-sig-new',
      watcher: 'local',
      name: 'myapp-sig',
      image: {
        ...base.image,
        digest: { watch: true, value: 'sha256:old', repo: undefined },
      },
      result: { digest: 'sha256:new' }, // no 'tag' field — matches old
    };
    const inserted = container.insertContainer(newFixture);
    expect(inserted.updateDetectedAt).toBe(oldTimestamp);
  });

  test('getResultSignature handles missing result digest field (null-digest branch)', () => {
    const oldTimestamp = new Date(Date.now() - 1000).toISOString();
    const base = createContainerFixture();
    const oldFixture = {
      ...base,
      id: 'lifecycle-sig-digest-old',
      watcher: 'local',
      name: 'myapp-sig-digest',
      image: {
        ...base.image,
        digest: { watch: true, value: 'sha256:old', repo: undefined },
      },
      result: { tag: 'v1.0.0' }, // no 'digest' field
      updateDetectedAt: oldTimestamp,
      firstSeenAt: oldTimestamp,
    };
    const collection = createFilterableCollection([{ data: oldFixture }]);
    container.createCollections({ getCollection: () => collection, addCollection: () => null });
    container.deleteContainer('lifecycle-sig-digest-old', { replacementExpected: true });
    const newFixture = {
      ...base,
      id: 'lifecycle-sig-digest-new',
      watcher: 'local',
      name: 'myapp-sig-digest',
      image: {
        ...base.image,
        digest: { watch: true, value: 'sha256:old', repo: undefined },
      },
      result: { tag: 'v1.0.0' }, // matches old — no digest in either
    };
    const inserted = container.insertContainer(newFixture);
    expect(inserted.updateDetectedAt).toBe(oldTimestamp);
  });

  test('_setUpdateLifecycleCacheEntryForTests writes an entry into the lifecycle cache', () => {
    const cache = container._getUpdateLifecycleCacheForTests();
    container._setUpdateLifecycleCacheEntryForTests('test_key', {
      updateDetectedAt: '2026-01-01T00:00:00.000Z',
      firstSeenAt: '2026-01-01T00:00:00.000Z',
      resultSignature: '{}',
      expiresAt: Date.now() + 60_000,
    });
    expect(cache.has('test_key')).toBe(true);
    expect(cache.get('test_key')?.updateDetectedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  test('lifecycle cache eviction stays within max after overflow without mocking Map internals', () => {
    const maxEntries = container.UPDATE_LIFECYCLE_CACHE_MAX_ENTRIES;
    const oldTimestamp = new Date(Date.now() - 1000).toISOString();
    const fixtures = [];
    for (let i = 0; i <= maxEntries; i++) {
      fixtures.push({
        data: makeDigestUpdateFixture({
          id: `lifecycle-overflow-${i}`,
          name: `overflow-app-${i}`,
          updateDetectedAt: oldTimestamp,
          firstSeenAt: oldTimestamp,
        }),
      });
    }
    const collection = createFilterableCollection(fixtures);
    container.createCollections({ getCollection: () => collection, addCollection: () => null });
    for (let i = 0; i <= maxEntries; i++) {
      container.deleteContainer(`lifecycle-overflow-${i}`, { replacementExpected: true });
    }
    const lifecycleCache = container._getUpdateLifecycleCacheForTests();
    expect(lifecycleCache.size).toBeLessThanOrEqual(maxEntries);
  });

  test('deleteContainer replacementExpected → insertContainer carry-forward with realistic mature-mode fixture', () => {
    const twelveHoursAgo = new Date(Date.now() - 12 * 3600 * 1000).toISOString();
    const oldFixture = makeDigestUpdateFixture({
      id: 'lifecycle-a-old',
      updateDetectedAt: twelveHoursAgo,
      firstSeenAt: twelveHoursAgo,
      updatePolicy: { maturityMode: 'mature', maturityMinAgeDays: 1 },
    });
    const collection = createFilterableCollection([{ data: oldFixture }]);
    const db = { getCollection: () => collection, addCollection: () => null };
    container.createCollections(db);
    container.deleteContainer('lifecycle-a-old', { replacementExpected: true });
    const newFixture = makeDigestUpdateFixture({
      id: 'lifecycle-a-new',
      updatePolicy: { maturityMode: 'mature', maturityMinAgeDays: 1 },
    });
    const inserted = container.insertContainer(newFixture);
    expect(inserted.updateDetectedAt).toBe(twelveHoursAgo);
    expect(inserted.firstSeenAt).toBe(twelveHoursAgo);
  });

  test('insertContainer stamps exact fresh updateDetectedAt when lifecycle cache result changed (pinned clock)', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-06-01T12:00:00.000Z'));
      const oldFixture = makeDigestUpdateFixture({
        id: 'lifecycle-b-old',
        updateDetectedAt: new Date(Date.now() - 12 * 3600 * 1000).toISOString(),
        firstSeenAt: new Date(Date.now() - 12 * 3600 * 1000).toISOString(),
      });
      const collection = createFilterableCollection([{ data: oldFixture }]);
      container.createCollections({ getCollection: () => collection, addCollection: () => null });
      container.deleteContainer('lifecycle-b-old', { replacementExpected: true });
      // Insert with a DIFFERENT digest — signature mismatch → fresh stamp
      const newFixture = makeDigestUpdateFixture({
        id: 'lifecycle-b-new',
        result: { tag: 'version', digest: 'sha256:completely-changed' },
      });
      const inserted = container.insertContainer(newFixture);
      expect(inserted.updateDetectedAt).toBe(new Date().toISOString());
    } finally {
      vi.useRealTimers();
    }
  });

  test('mature-mode soak clock survives container recreation', () => {
    const twelveHoursAgo = new Date(Date.now() - 12 * 3600 * 1000).toISOString();
    const oldFixture = makeDigestUpdateFixture({
      id: 'lifecycle-c-old',
      updateDetectedAt: twelveHoursAgo,
      firstSeenAt: twelveHoursAgo,
      updatePolicy: { maturityMode: 'mature', maturityMinAgeDays: 1 },
    });
    const collection = createFilterableCollection([{ data: oldFixture }]);
    const db = { getCollection: () => collection, addCollection: () => null };
    container.createCollections(db);
    container.deleteContainer('lifecycle-c-old', { replacementExpected: true });
    const newFixture = makeDigestUpdateFixture({
      id: 'lifecycle-c-new',
      updatePolicy: { maturityMode: 'mature', maturityMinAgeDays: 1 },
    });
    const inserted = container.insertContainer(newFixture);
    expect(inserted.updateDetectedAt).toBe(twelveHoursAgo);
  });

  test('BLOCKER-1: firstSeenAt is restored from cache independently when incoming has updateDetectedAt but no firstSeenAt', () => {
    const twelveHoursAgo = new Date(Date.now() - 12 * 3600 * 1000).toISOString();
    const incomingDetectedAt = '2026-01-01T00:00:00.000Z';
    const oldFixture = makeDigestUpdateFixture({
      id: 'blocker1-old',
      updateDetectedAt: twelveHoursAgo,
      firstSeenAt: twelveHoursAgo,
    });
    const collection = createFilterableCollection([{ data: oldFixture }]);
    const db = { getCollection: () => collection, addCollection: () => null };
    container.createCollections(db);
    container.deleteContainer('blocker1-old', { replacementExpected: true });
    const newFixture = makeDigestUpdateFixture({
      id: 'blocker1-new',
      updateDetectedAt: incomingDetectedAt,
      // no firstSeenAt — should be restored from cache
    });
    const inserted = container.insertContainer(newFixture);
    // updateDetectedAt keeps the incoming value (not replaced from cache)
    expect(inserted.updateDetectedAt).toBe(incomingDetectedAt);
    // firstSeenAt is independently restored from cache
    expect(inserted.firstSeenAt).toBe(twelveHoursAgo);
  });

  test('toCacheKey collision is gone: watcher "my_prod"/name "nginx" does not collide with watcher "my"/name "prod_nginx"', () => {
    const twelveHoursAgo = new Date(Date.now() - 12 * 3600 * 1000).toISOString();
    const fixture1 = makeDigestUpdateFixture({
      id: 'collision-old',
      watcher: 'my_prod',
      name: 'nginx',
      updateDetectedAt: twelveHoursAgo,
      firstSeenAt: twelveHoursAgo,
    });
    const collection = createFilterableCollection([{ data: fixture1 }]);
    const db = { getCollection: () => collection, addCollection: () => null };
    container.createCollections(db);
    container.deleteContainer('collision-old', { replacementExpected: true });

    const base = createContainerFixture();
    const fixture2 = {
      ...base,
      id: 'collision-new',
      watcher: 'my',
      name: 'prod_nginx',
      image: {
        ...base.image,
        digest: { watch: true, value: 'sha256:old', repo: undefined },
      },
      result: { tag: 'version', digest: 'sha256:new' },
    };
    const inserted = container.insertContainer(fixture2);
    // With the new :: separator, no collision — cached entry is NOT picked up
    expect(inserted.updateDetectedAt).not.toBe(twelveHoursAgo);
  });

  test('deleteContainer does not write lifecycle cache for agent containers', () => {
    const twelveHoursAgo = new Date(Date.now() - 12 * 3600 * 1000).toISOString();
    const agentFixture = makeDigestUpdateFixture({
      id: 'lifecycle-agent-guard',
      agent: 'remote-agent',
      updateDetectedAt: twelveHoursAgo,
      firstSeenAt: twelveHoursAgo,
    });
    const collection = createFilterableCollection([{ data: agentFixture }]);
    container.createCollections({ getCollection: () => collection, addCollection: () => null });
    const lifecycleCache = container._getUpdateLifecycleCacheForTests();
    const cacheSizeBefore = lifecycleCache.size;
    container.deleteContainer('lifecycle-agent-guard', { replacementExpected: true });
    expect(lifecycleCache.size).toBe(cacheSizeBefore);
  });

  test('deleteContainer does not write lifecycle cache for rollback-named containers', () => {
    const twelveHoursAgo = new Date(Date.now() - 12 * 3600 * 1000).toISOString();
    const rollbackFixture = makeDigestUpdateFixture({
      id: 'lifecycle-rollback-guard',
      name: 'myapp-old-1773933154786',
      updateDetectedAt: twelveHoursAgo,
      firstSeenAt: twelveHoursAgo,
    });
    const collection = createFilterableCollection([{ data: rollbackFixture }]);
    container.createCollections({ getCollection: () => collection, addCollection: () => null });
    const lifecycleCache = container._getUpdateLifecycleCacheForTests();
    const cacheSizeBefore = lifecycleCache.size;
    container.deleteContainer('lifecycle-rollback-guard', { replacementExpected: true });
    expect(lifecycleCache.size).toBe(cacheSizeBefore);
  });

  test('deleteContainer evicts expired lifecycle cache entries before oldest live entries', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-06-01T00:00:00.000Z'));
      const maxEntries = container.UPDATE_LIFECYCLE_CACHE_MAX_ENTRIES;
      const pastTimestamp = new Date(Date.now() - 1000).toISOString();

      // Build maxEntries + 1 fixtures (all in the collection)
      const fixtures = [];
      for (let i = 0; i <= maxEntries; i++) {
        fixtures.push({
          data: makeDigestUpdateFixture({
            id: `lifecycle-expfirst-${i}`,
            name: `expfirst-app-${i}`,
            updateDetectedAt: pastTimestamp,
            firstSeenAt: pastTimestamp,
          }),
        });
      }
      const collection = createFilterableCollection(fixtures);
      container.createCollections({ getCollection: () => collection, addCollection: () => null });

      // Delete the first maxEntries containers → fill cache exactly to the limit
      for (let i = 0; i < maxEntries; i++) {
        container.deleteContainer(`lifecycle-expfirst-${i}`, { replacementExpected: true });
      }
      const lifecycleCache = container._getUpdateLifecycleCacheForTests();
      expect(lifecycleCache.size).toBe(maxEntries);

      // Advance time past TTL so all existing entries expire
      vi.advanceTimersByTime(container.UPDATE_LIFECYCLE_CACHE_TTL_MS + 1);

      // Delete the last container — triggers size check → should evict expired entries first
      container.deleteContainer(`lifecycle-expfirst-${maxEntries}`, { replacementExpected: true });

      // New entry should be present
      expect(lifecycleCache.has(`local::expfirst-app-${maxEntries}`)).toBe(true);
      // All old (now-expired) entries should be gone
      expect(lifecycleCache.has(`local::expfirst-app-0`)).toBe(false);
      // Total size should be 1 (only the fresh entry remains)
      expect(lifecycleCache.size).toBeLessThanOrEqual(maxEntries);
    } finally {
      vi.useRealTimers();
    }
  });

  test('insertContainer does not overwrite existing incoming firstSeenAt with cached value', () => {
    const twelveHoursAgo = new Date(Date.now() - 12 * 3600 * 1000).toISOString();
    const incomingFirstSeenAt = '2026-02-01T00:00:00.000Z';
    const oldFixture = makeDigestUpdateFixture({
      id: 'lifecycle-fseat-old',
      updateDetectedAt: twelveHoursAgo,
      firstSeenAt: twelveHoursAgo,
    });
    const collection = createFilterableCollection([{ data: oldFixture }]);
    const db = { getCollection: () => collection, addCollection: () => null };
    container.createCollections(db);
    container.deleteContainer('lifecycle-fseat-old', { replacementExpected: true });
    const newFixture = makeDigestUpdateFixture({
      id: 'lifecycle-fseat-new',
      firstSeenAt: incomingFirstSeenAt, // pre-set on incoming
    });
    const inserted = container.insertContainer(newFixture);
    // firstSeenAt must not be overwritten by cached value
    expect(inserted.firstSeenAt).toBe(incomingFirstSeenAt);
  });
});
