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
  | { 'data.containerName': string; 'data.status': ContainerUpdateOperationStatus }
  | { 'data.containerId': string }
  | { 'data.containerId': string; 'data.status': ContainerUpdateOperationStatus }
  | { 'data.newContainerId': string }
  | { 'data.newContainerId': string; 'data.status': ContainerUpdateOperationStatus };

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
const UPDATE_OPERATION_COLLECTION_INDICES = [
  'data.id',
  'data.containerName',
  'data.containerId',
  'data.newContainerId',
  'data.status',
];
const DEFAULT_UPDATE_OPERATION_MAX_ENTRIES = getDefaultCacheMaxEntries();
const DEFAULT_UPDATE_OPERATION_RETENTION_DAYS = 30;
const DEFAULT_UPDATE_OPERATION_ACTIVE_TTL_MS = 30 * 60 * 1000;
const UPDATE_OPERATION_PRUNE_MUTATION_INTERVAL = 100;
let updateOperationMutationsSincePrune = 0;
const ACTIVE_STATUSES = ['in-progress', 'queued'] as const;

const UPDATE_OPERATION_MAX_ENTRIES = toPositiveInteger(
  process.env.DD_UPDATE_OPERATION_MAX_ENTRIES,
  DEFAULT_UPDATE_OPERATION_MAX_ENTRIES,
);
const UPDATE_OPERATION_RETENTION_DAYS = toPositiveInteger(
  process.env.DD_UPDATE_OPERATION_RETENTION_DAYS,
  DEFAULT_UPDATE_OPERATION_RETENTION_DAYS,
);
const UPDATE_OPERATION_ACTIVE_TTL_MS = toPositiveInteger(
  process.env.DD_UPDATE_OPERATION_ACTIVE_TTL_MS,
  DEFAULT_UPDATE_OPERATION_ACTIVE_TTL_MS,
);

function getOperationTimestamp(operation: UpdateOperation): number {
  const timestamp = Date.parse(operation.updatedAt || operation.createdAt);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function isActiveOperationStatus(status: unknown): status is (typeof ACTIVE_STATUSES)[number] {
  return typeof status === 'string' && (ACTIVE_STATUSES as readonly string[]).includes(status);
}

function isStaleActiveOperation(operation: UpdateOperation, nowMs = Date.now()): boolean {
  return nowMs - getOperationTimestamp(operation) > UPDATE_OPERATION_ACTIVE_TTL_MS;
}

function getStaleActiveOperationMessage(operation: UpdateOperation): string {
  return `Marked failed after exceeding active update TTL (${UPDATE_OPERATION_ACTIVE_TTL_MS}ms) while ${operation.status === 'queued' ? 'queued' : 'in progress'}`;
}

function expireStaleActiveOperation(operation: UpdateOperation): UpdateOperation | undefined {
  if (!updateOperationCollection) {
    return undefined;
  }

  const existing = updateOperationCollection.findOne({ 'data.id': operation.id })?.data;
  if (!existing || !isActiveOperationStatus(existing.status)) {
    return existing;
  }

  const staleMessage = getStaleActiveOperationMessage(existing);
  return updateOperation(existing.id, {
    status: 'failed',
    lastError: existing.lastError ? `${existing.lastError}; ${staleMessage}` : staleMessage,
  });
}

function getFreshActiveOperation(
  operation: UpdateOperation,
  nowMs = Date.now(),
): UpdateOperation | undefined {
  if (!isActiveOperationStatus(operation.status)) {
    return undefined;
  }
  if (!isStaleActiveOperation(operation, nowMs)) {
    return operation;
  }
  expireStaleActiveOperation(operation);
  return undefined;
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
      .filter((document) => !isActiveOperationStatus(document.data.status))
      .filter((document) => getOperationTimestamp(document.data) >= cutoffTimestamp)
      .sort((a, b) => getOperationTimestamp(b.data) - getOperationTimestamp(a.data))
      .slice(0, UPDATE_OPERATION_MAX_ENTRIES)
      .map((document) => document.data.id),
  );

  const toRemove = documents.filter((document) => {
    if (isActiveOperationStatus(document.data.status)) {
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
 * Return a single operation by its unique ID.
 */
export function getOperationById(id: string): UpdateOperation | undefined {
  if (!updateOperationCollection || !id) {
    return undefined;
  }

  return updateOperationCollection.findOne({ 'data.id': id })?.data;
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

/**
 * Return the latest in-progress operation for a container ID.
 */
export function getInProgressOperationByContainerId(
  containerId: string,
): UpdateOperation | undefined {
  if (!updateOperationCollection || !containerId) {
    return undefined;
  }

  const operationsById = new Map<string, UpdateOperation>();

  for (const document of updateOperationCollection.find({
    'data.containerId': containerId,
    'data.status': 'in-progress',
  })) {
    operationsById.set(document.data.id, document.data);
  }

  for (const document of updateOperationCollection.find({
    'data.newContainerId': containerId,
    'data.status': 'in-progress',
  })) {
    operationsById.set(document.data.id, document.data);
  }

  const operations = [...operationsById.values()].sort(
    (a, b) => getOperationTimestamp(b) - getOperationTimestamp(a),
  );

  return operations.at(0);
}

/**
 * Return the latest active (in-progress OR queued) operation for a container name.
 */
export function getActiveOperationByContainerName(
  containerName: string,
): UpdateOperation | undefined {
  if (!updateOperationCollection) {
    return undefined;
  }

  const operations = updateOperationCollection
    .find({ 'data.containerName': containerName })
    .map((item) => getFreshActiveOperation(item.data))
    .filter((item): item is UpdateOperation => Boolean(item))
    .sort((a, b) => getOperationTimestamp(b) - getOperationTimestamp(a));

  return operations.at(0);
}

/**
 * Return the latest active (in-progress OR queued) operation for a container ID.
 */
export function getActiveOperationByContainerId(containerId: string): UpdateOperation | undefined {
  if (!updateOperationCollection || !containerId) {
    return undefined;
  }

  const operationsById = new Map<string, UpdateOperation>();
  const nowMs = Date.now();

  for (const document of updateOperationCollection.find({ 'data.containerId': containerId })) {
    const operation = getFreshActiveOperation(document.data, nowMs);
    if (operation) {
      operationsById.set(operation.id, operation);
    }
  }

  for (const document of updateOperationCollection.find({
    'data.newContainerId': containerId,
  })) {
    const operation = getFreshActiveOperation(document.data, nowMs);
    if (operation) {
      operationsById.set(operation.id, operation);
    }
  }

  const operations = [...operationsById.values()].sort(
    (a, b) => getOperationTimestamp(b) - getOperationTimestamp(a),
  );

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
