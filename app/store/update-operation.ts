// @ts-nocheck
import crypto from 'node:crypto';
import { initCollection } from './util.js';

let updateOperationCollection;

/**
 * Create update operation collection.
 * @param db
 */
export function createCollections(db) {
  updateOperationCollection = initCollection(db, 'updateOperations');
}

/**
 * Insert a persisted container-update operation.
 */
export function insertOperation(operation) {
  const now = new Date().toISOString();
  const operationToSave = {
    ...operation,
    id: operation.id || crypto.randomUUID(),
    status: operation.status || 'in-progress',
    phase: operation.phase || 'prepare',
    createdAt: operation.createdAt || now,
    updatedAt: now,
  };

  if (updateOperationCollection) {
    updateOperationCollection.insert({ data: operationToSave });
  }

  return operationToSave;
}

/**
 * Update an operation by id.
 */
export function updateOperation(id, patch = {}) {
  if (!updateOperationCollection) {
    return undefined;
  }

  const existingDoc = updateOperationCollection.find().find((item) => item.data.id === id);
  if (!existingDoc) {
    return undefined;
  }

  const updated = {
    ...existingDoc.data,
    ...patch,
    id: existingDoc.data.id,
    updatedAt: new Date().toISOString(),
  };

  updateOperationCollection.remove(existingDoc);
  updateOperationCollection.insert({ data: updated });

  return updated;
}

/**
 * Return the latest in-progress operation for a container name.
 */
export function getInProgressOperationByContainerName(containerName) {
  if (!updateOperationCollection) {
    return undefined;
  }

  const operations = updateOperationCollection
    .find()
    .map((item) => item.data)
    .filter((operation) => {
      return operation.containerName === containerName && operation.status === 'in-progress';
    })
    .sort((a, b) => {
      const left = new Date(b.updatedAt || b.createdAt).getTime();
      const right = new Date(a.updatedAt || a.createdAt).getTime();
      return left - right;
    });

  return operations.at(0);
}

export function getOperationsByContainerName(containerName) {
  if (!updateOperationCollection) {
    return [];
  }

  return updateOperationCollection
    .find()
    .map((item) => item.data)
    .filter((operation) => operation.containerName === containerName)
    .sort((a, b) => {
      const left = new Date(b.updatedAt || b.createdAt).getTime();
      const right = new Date(a.updatedAt || a.createdAt).getTime();
      return left - right;
    });
}
