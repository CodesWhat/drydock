// @ts-nocheck
import * as updateOperation from './update-operation.js';

function createDb() {
  const collections = {};
  return {
    getCollection: (name) => collections[name] || null,
    addCollection: (name) => {
      const docs = [];
      collections[name] = {
        insert: (doc) => {
          doc.$loki = docs.length;
          docs.push(doc);
        },
        find: () => [...docs],
        remove: (doc) => {
          const idx = docs.indexOf(doc);
          if (idx >= 0) docs.splice(idx, 1);
        },
      };
      return collections[name];
    },
  };
}

describe('Update Operation Store', () => {
  beforeEach(() => {
    updateOperation.createCollections(createDb());
  });

  test('createCollections should create updateOperations collection when missing', () => {
    const db = {
      getCollection: () => null,
      addCollection: vi.fn(() => ({ insert: vi.fn(), find: vi.fn(), remove: vi.fn() })),
    };
    updateOperation.createCollections(db);
    expect(db.addCollection).toHaveBeenCalledWith('updateOperations');
  });

  test('insertOperation should default to in-progress prepare state', () => {
    const inserted = updateOperation.insertOperation({
      containerName: 'web',
      containerId: 'abc',
      triggerName: 'docker.update',
      oldName: 'web',
      tempName: 'web-old-1',
    });

    expect(inserted.id).toBeDefined();
    expect(inserted.status).toBe('in-progress');
    expect(inserted.phase).toBe('prepare');
    expect(inserted.createdAt).toBeDefined();
    expect(inserted.updatedAt).toBeDefined();
  });

  test('updateOperation should merge patch and refresh updatedAt', () => {
    const inserted = updateOperation.insertOperation({
      containerName: 'web',
      containerId: 'abc',
      triggerName: 'docker.update',
      oldName: 'web',
      tempName: 'web-old-1',
    });

    const updated = updateOperation.updateOperation(inserted.id, {
      phase: 'new-started',
      status: 'in-progress',
      newContainerId: 'new-123',
    });

    expect(updated.phase).toBe('new-started');
    expect(updated.newContainerId).toBe('new-123');
    expect(updated.status).toBe('in-progress');
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(inserted.updatedAt).getTime(),
    );
  });

  test('getInProgressOperationByContainerName should return latest in-progress operation', () => {
    const older = updateOperation.insertOperation({
      containerName: 'web',
      containerId: 'abc',
      triggerName: 'docker.update',
      oldName: 'web',
      tempName: 'web-old-1',
      createdAt: '2026-02-23T00:00:00.000Z',
      updatedAt: '2026-02-23T00:00:00.000Z',
    });
    updateOperation.updateOperation(older.id, {
      status: 'rolled-back',
      updatedAt: '2026-02-23T00:01:00.000Z',
    });

    const newer = updateOperation.insertOperation({
      containerName: 'web',
      containerId: 'abc',
      triggerName: 'docker.update',
      oldName: 'web',
      tempName: 'web-old-2',
    });

    const active = updateOperation.getInProgressOperationByContainerName('web');
    expect(active.id).toBe(newer.id);
    expect(active.status).toBe('in-progress');
  });

  test('getInProgressOperationByContainerName should return undefined when uninitialized', async () => {
    vi.resetModules();
    const fresh = await import('./update-operation.js');
    expect(fresh.getInProgressOperationByContainerName('web')).toBeUndefined();
  });
});
