import { describe, expect, test, vi } from 'vitest';

import { initCollection } from './util.js';

vi.mock('../log/index.js', () => ({
  default: {
    child: vi.fn(() => ({
      info: vi.fn(),
    })),
  },
}));

describe('store util initCollection', () => {
  test('returns existing collection and does not recreate it', () => {
    const existing = {
      ensureIndex: vi.fn(),
    };
    const db = {
      getCollection: vi.fn(() => existing),
      addCollection: vi.fn(),
    };

    const result = initCollection(db as any, 'settings');

    expect(result).toBe(existing);
    expect(db.addCollection).not.toHaveBeenCalled();
  });

  test('creates collection with options and ensures indices when provided', () => {
    const collection = {
      ensureIndex: vi.fn(),
    };
    const db = {
      getCollection: vi.fn(() => null),
      addCollection: vi.fn(() => collection),
    };

    const result = initCollection(db as any, 'updateOperations', {
      indices: ['data.id', 'data.status'],
    });

    expect(result).toBe(collection);
    expect(db.addCollection).toHaveBeenCalledWith('updateOperations', {
      indices: ['data.id', 'data.status'],
    });
    expect(collection.ensureIndex).toHaveBeenCalledWith('data.id');
    expect(collection.ensureIndex).toHaveBeenCalledWith('data.status');
  });

  test('normalizes binaryIndices into Loki indices and ensures them', () => {
    const collection = {
      ensureIndex: vi.fn(),
    };
    const db = {
      getCollection: vi.fn(() => null),
      addCollection: vi.fn(() => collection),
    };

    const result = initCollection(db as any, 'notificationOutbox', {
      indices: ['data.id'],
      binaryIndices: ['data.status', 'data.nextAttemptAt'],
    });

    expect(result).toBe(collection);
    expect(db.addCollection).toHaveBeenCalledWith('notificationOutbox', {
      indices: ['data.id', 'data.status', 'data.nextAttemptAt'],
      binaryIndices: ['data.status', 'data.nextAttemptAt'],
    });
    expect(collection.ensureIndex).toHaveBeenCalledWith('data.id');
    expect(collection.ensureIndex).toHaveBeenCalledWith('data.status');
    expect(collection.ensureIndex).toHaveBeenCalledWith('data.nextAttemptAt');
  });

  test('normalizes string index options into Loki indices and ensures them', () => {
    const collection = {
      ensureIndex: vi.fn(),
    };
    const db = {
      getCollection: vi.fn(() => null),
      addCollection: vi.fn(() => collection),
    };

    const result = initCollection(db as any, 'notificationOutbox', {
      indices: 'data.id',
      binaryIndices: 'data.status',
    });

    expect(result).toBe(collection);
    expect(db.addCollection).toHaveBeenCalledWith('notificationOutbox', {
      indices: ['data.id', 'data.status'],
      binaryIndices: 'data.status',
    });
    expect(collection.ensureIndex).toHaveBeenCalledWith('data.id');
    expect(collection.ensureIndex).toHaveBeenCalledWith('data.status');
  });

  test('creates collection without options and skips index wiring when unavailable', () => {
    const collectionWithoutEnsureIndex = {};
    const db = {
      getCollection: vi.fn(() => null),
      addCollection: vi.fn(() => collectionWithoutEnsureIndex),
    };

    const result = initCollection(db as any, 'settings', {
      indices: ['data.id'],
    });

    expect(result).toBe(collectionWithoutEnsureIndex);
    expect(db.addCollection).toHaveBeenCalledWith('settings', {
      indices: ['data.id'],
    });

    const dbNoOptions = {
      getCollection: vi.fn(() => null),
      addCollection: vi.fn(() => ({ ensureIndex: vi.fn() })),
    };

    initCollection(dbNoOptions as any, 'audit');
    expect(dbNoOptions.addCollection).toHaveBeenCalledWith('audit');
  });
});
