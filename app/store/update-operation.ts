import crypto from 'node:crypto';
import { getDefaultCacheMaxEntries } from '../configuration/runtime-defaults.js';
import type { ContainerUpdateOperationState } from '../model/container.js';
import type { ContainerUpdateOperationStatus } from '../model/container-update-operation.js';
import { daysToMs } from '../model/maturity-policy.js';
import { toPositiveInteger } from '../util/parse.js';
import { initCollection } from './util.js';

interface UpdateOperation extends ContainerUpdateOperationState {
  id: string;
  containerName: string;
  createdAt: string;
  updatedAt: string;
  containerId?: string;
  triggerName?: string;
  oldContainerId?: string;
  oldName?: string;
  tempName?: string;
  oldContainerWasRunning?: boolean;
  oldContainerStopped?: boolean;
  newContainerId?: string;
  fromVersion?: string;
  toVersion?: string;
  targetImage?: string;
  rollbackReason?: string;
  lastError?: string;
  [key: string]: unknown;
}

interface InsertUpdateOperationInput
  extends Partial<Pick<UpdateOperation, 'id' | 'status' | 'phase' | 'createdAt' | 'updatedAt'>> {
  containerName: string;
  [key: string]: unknown;
}

type UpdateOperationPatch = Partial<Omit<UpdateOperation, 'id' | 'createdAt'>>;

interface UpdateOperationCollectionDocument {
  data: UpdateOperation;
  [key: string]: unknown;
}

type UpdateOperationQuery =
  | { 'data.id': string }
  | { 'data.containerName': string }
  | { 'data.containerName': string; 'data.status': ContainerUpdateOperationStatus };

interface UpdateOperationCollection {
  insert(document: UpdateOperationCollectionDocument): void;
  find(query?: UpdateOperationQuery): UpdateOperationCollectionDocument[];
  findOne(query: { 'data.id': string }): UpdateOperationCollectionDocument | null;
  remove(document: UpdateOperationCollectionDocument): void;
}

interface UpdateOperationCollectionOptions {
  indices?: string[];
}

interface UpdateOperationStoreDb {
  getCollection(name: string): UpdateOperationCollection | null;
  addCollection(
    name: string,
    options?: UpdateOperationCollectionOptions,
  ): UpdateOperationCollection;
}

let updateOperationCollection: UpdateOperationCollection | undefined;
const UPDATE_OPERATION_COLLECTION_INDICES = ['data.id', 'data.containerName', 'data.status'];
const DEFAULT_UPDATE_OPERATION_MAX_ENTRIES = getDefaultCacheMaxEntries();
const DEFAULT_UPDATE_OPERATION_RETENTION_DAYS = 30;
const UPDATE_OPERATION_PRUNE_MUTATION_INTERVAL = 100;
let updateOperationMutationsSincePrune = 0;

const UPDATE_OPERATION_MAX_ENTRIES = toPositiveInteger(
  process.env.DD_UPDATE_OPERATION_MAX_ENTRIES,
  DEFAULT_UPDATE_OPERATION_MAX_ENTRIES,
);
const UPDATE_OPERATION_RETENTION_DAYS = toPositiveInteger(
  process.env.DD_UPDATE_OPERATION_RETENTION_DAYS,
  DEFAULT_UPDATE_OPERATION_RETENTION_DAYS,
);

function getOperationTimestamp(operation: UpdateOperation): number {
  const timestamp = Date.parse(operation.updatedAt || operation.createdAt);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function pruneOperationsForRetention(
  collection: UpdateOperationCollection,
  nowMs = Date.now(),
): number {
  const documents = collection.find();
  if (!Array.isArray(documents) || documents.length === 0) {
    return 0;
  }

  const retentionWindowMs = daysToMs(UPDATE_OPERATION_RETENTION_DAYS);
  const cutoffTimestamp = nowMs - retentionWindowMs;

  const retainedTerminalIds = new Set(
    documents
      .filter((document) => document.data.status !== 'in-progress')
      .filter((document) => getOperationTimestamp(document.data) >= cutoffTimestamp)
      .sort((a, b) => getOperationTimestamp(b.data) - getOperationTimestamp(a.data))
      .slice(0, UPDATE_OPERATION_MAX_ENTRIES)
      .map((document) => document.data.id),
  );

  const toRemove = documents.filter((document) => {
    if (document.data.status === 'in-progress') {
      return false;
    }
    return !retainedTerminalIds.has(document.data.id);
  });

  for (const document of toRemove) {
    collection.remove(document);
  }

  return toRemove.length;
}

function maybePruneOperationsForRetention(collection: UpdateOperationCollection): void {
  updateOperationMutationsSincePrune += 1;
  if (updateOperationMutationsSincePrune >= UPDATE_OPERATION_PRUNE_MUTATION_INTERVAL) {
    pruneOperationsForRetention(collection);
    updateOperationMutationsSincePrune = 0;
  }
}

/**
 * Create update operation collection.
 * @param db
 */
export function createCollections(db: UpdateOperationStoreDb): void {
  updateOperationCollection = initCollection(db, 'updateOperations', {
    indices: UPDATE_OPERATION_COLLECTION_INDICES,
  }) as UpdateOperationCollection;
  updateOperationMutationsSincePrune = 0;
  pruneOperationsForRetention(updateOperationCollection);
}

/**
 * Insert a persisted container-update operation.
 */
export function insertOperation(operation: InsertUpdateOperationInput): UpdateOperation {
  const now = new Date().toISOString();
  const operationToSave: UpdateOperation = {
    ...operation,
    id: operation.id || crypto.randomUUID(),
    status: operation.status || 'in-progress',
    phase: operation.phase || 'prepare',
    createdAt: operation.createdAt || now,
    updatedAt: now,
  };

  if (updateOperationCollection) {
    updateOperationCollection.insert({ data: operationToSave });
    maybePruneOperationsForRetention(updateOperationCollection);
  }

  return operationToSave;
}

/**
 * Update an operation by id.
 */
export function updateOperation(
  id: string,
  patch: UpdateOperationPatch = {},
): UpdateOperation | undefined {
  if (!updateOperationCollection) {
    return undefined;
  }

  const existingDoc = updateOperationCollection.findOne({ 'data.id': id });
  if (!existingDoc) {
    return undefined;
  }

  const updated: UpdateOperation = {
    ...existingDoc.data,
    ...patch,
    id: existingDoc.data.id,
    updatedAt: new Date().toISOString(),
  };

  updateOperationCollection.remove(existingDoc);
  updateOperationCollection.insert({ data: updated });
  maybePruneOperationsForRetention(updateOperationCollection);

  return updated;
}

/**
 * Return the latest in-progress operation for a container name.
 */
export function getInProgressOperationByContainerName(
  containerName: string,
): UpdateOperation | undefined {
  if (!updateOperationCollection) {
    return undefined;
  }

  const operations = updateOperationCollection
    .find({
      'data.containerName': containerName,
      'data.status': 'in-progress',
    })
    .map((item) => item.data)
    .sort((a, b) => getOperationTimestamp(b) - getOperationTimestamp(a));

  return operations.at(0);
}

export function getOperationsByContainerName(containerName: string): UpdateOperation[] {
  if (!updateOperationCollection) {
    return [];
  }

  return updateOperationCollection
    .find({ 'data.containerName': containerName })
    .map((item) => item.data)
    .sort((a, b) => getOperationTimestamp(b) - getOperationTimestamp(a));
}
