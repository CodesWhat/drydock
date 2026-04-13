import crypto from 'node:crypto';
import { getDefaultCacheMaxEntries } from '../configuration/runtime-defaults.js';
import { emitUpdateOperationChanged } from '../event/index.js';
import type {
  ActiveContainerUpdateOperationPhase,
  ActiveContainerUpdateOperationStatus,
  ContainerUpdateOperationKind,
  ContainerUpdateOperationPhase,
  ContainerUpdateOperationStatus,
  FailedContainerUpdateOperationPhase,
  InProgressContainerUpdateOperationPhase,
  RolledBackContainerUpdateOperationPhase,
  SucceededContainerUpdateOperationPhase,
} from '../model/container-update-operation.js';
import {
  ACTIVE_CONTAINER_UPDATE_OPERATION_STATUSES,
  isActiveContainerUpdateOperationPhaseForStatus,
  isTerminalContainerUpdateOperationPhase,
  resolveTerminalContainerUpdateOperationPhase,
} from '../model/container-update-operation.js';
import { daysToMs } from '../model/maturity-policy.js';
import { toPositiveInteger } from '../util/parse.js';
import { initCollection } from './util.js';

interface UpdateOperationBase {
  id: string;
  kind?: ContainerUpdateOperationKind;
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
  recoveredAt?: string;
  completedAt?: string;
  [key: string]: unknown;
}

interface QueuedUpdateOperation extends UpdateOperationBase {
  status: 'queued';
  phase: 'queued';
  batchId?: string;
  queuePosition?: number;
  queueTotal?: number;
  completedAt?: undefined;
}

interface InProgressUpdateOperation extends UpdateOperationBase {
  status: 'in-progress';
  phase: InProgressContainerUpdateOperationPhase;
  batchId?: string;
  queuePosition?: number;
  queueTotal?: number;
  completedAt?: undefined;
}

interface SucceededUpdateOperation extends UpdateOperationBase {
  status: 'succeeded';
  phase: SucceededContainerUpdateOperationPhase;
  completedAt: string;
  batchId?: undefined;
  queuePosition?: undefined;
  queueTotal?: undefined;
}

interface RolledBackUpdateOperation extends UpdateOperationBase {
  status: 'rolled-back';
  phase: RolledBackContainerUpdateOperationPhase;
  completedAt: string;
  batchId?: undefined;
  queuePosition?: undefined;
  queueTotal?: undefined;
}

interface FailedUpdateOperation extends UpdateOperationBase {
  status: 'failed';
  phase: FailedContainerUpdateOperationPhase;
  completedAt: string;
  batchId?: undefined;
  queuePosition?: undefined;
  queueTotal?: undefined;
}

type UpdateOperation =
  | QueuedUpdateOperation
  | InProgressUpdateOperation
  | SucceededUpdateOperation
  | RolledBackUpdateOperation
  | FailedUpdateOperation;

type ActiveUpdateOperation = QueuedUpdateOperation | InProgressUpdateOperation;

type MutableUpdateOperationFields = Pick<
  UpdateOperationBase,
  | 'kind'
  | 'containerName'
  | 'containerId'
  | 'triggerName'
  | 'oldContainerId'
  | 'oldName'
  | 'tempName'
  | 'oldContainerWasRunning'
  | 'oldContainerStopped'
  | 'newContainerId'
  | 'fromVersion'
  | 'toVersion'
  | 'targetImage'
  | 'rollbackReason'
  | 'lastError'
  | 'recoveredAt'
>;

interface InsertUpdateOperationInput
  extends Partial<Pick<UpdateOperationBase, 'id' | 'createdAt' | 'updatedAt'>> {
  containerName: string;
  status?: ContainerUpdateOperationStatus;
  phase?: ContainerUpdateOperationPhase;
  [key: string]: unknown;
}

type ActiveOperationPatchBase = Partial<MutableUpdateOperationFields> & {
  phase?: ActiveContainerUpdateOperationPhase;
  batchId?: string | undefined;
  queuePosition?: number | undefined;
  queueTotal?: number | undefined;
  completedAt?: undefined;
};

type UpdateOperationPatch = ActiveOperationPatchBase & {
  status?: ActiveContainerUpdateOperationStatus;
};

type ReopenTerminalOperationPatch = Omit<
  ActiveOperationPatchBase,
  'lastError' | 'rollbackReason' | 'newContainerId'
> & {
  status: ActiveContainerUpdateOperationStatus;
};

type PersistedUpdateOperationPatch = Partial<MutableUpdateOperationFields> & {
  status?: ContainerUpdateOperationStatus;
  phase?: ContainerUpdateOperationPhase;
  batchId?: string | undefined;
  queuePosition?: number | undefined;
  queueTotal?: number | undefined;
  completedAt?: string | undefined;
};

interface TerminalUpdateOperationPatchBase
  extends Omit<
    PersistedUpdateOperationPatch,
    'status' | 'phase' | 'batchId' | 'queuePosition' | 'queueTotal' | 'completedAt'
  > {
  completedAt?: string;
}

type TerminalUpdateOperationPatch =
  | (TerminalUpdateOperationPatchBase & {
      status: 'succeeded';
      phase?: SucceededContainerUpdateOperationPhase;
    })
  | (TerminalUpdateOperationPatchBase & {
      status: 'rolled-back';
      phase?: RolledBackContainerUpdateOperationPhase;
    })
  | (TerminalUpdateOperationPatchBase & {
      status: 'failed';
      phase?: FailedContainerUpdateOperationPhase;
    });

interface UpdateOperationCollectionDocument {
  data: UpdateOperation;
  [key: string]: unknown;
}

type UpdateOperationQuery =
  | { 'data.id': string }
  | { 'data.status': ContainerUpdateOperationStatus }
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
const ACTIVE_STATUSES = ACTIVE_CONTAINER_UPDATE_OPERATION_STATUSES;

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

function getDefaultActiveOperationPhase(
  status: ActiveContainerUpdateOperationStatus,
): ActiveContainerUpdateOperationPhase {
  return status === 'queued' ? 'queued' : 'prepare';
}

function isActiveOperationStatus(status: unknown): status is (typeof ACTIVE_STATUSES)[number] {
  return typeof status === 'string' && (ACTIVE_STATUSES as readonly string[]).includes(status);
}

function isActiveUpdateOperation(operation: UpdateOperation): operation is ActiveUpdateOperation {
  return isActiveOperationStatus(operation.status);
}

function isInProgressUpdateOperation(
  operation: UpdateOperation,
): operation is InProgressUpdateOperation {
  return operation.status === 'in-progress';
}

function isStaleActiveOperation(operation: UpdateOperation, nowMs = Date.now()): boolean {
  return nowMs - getOperationTimestamp(operation) > UPDATE_OPERATION_ACTIVE_TTL_MS;
}

function getRuntimeExpiredActiveOperationMessage(operation: UpdateOperation): string {
  return `Marked failed after exceeding active update TTL (${UPDATE_OPERATION_ACTIVE_TTL_MS}ms) while ${operation.status === 'queued' ? 'queued' : 'in progress'}`;
}

function getStartupOrphanedActiveOperationMessage(operation: UpdateOperation): string {
  return `Marked failed after orphaned active operation was found during process restart while ${operation.status === 'queued' ? 'queued' : 'in progress'}`;
}

function emitOperationChangedEvent(operation: UpdateOperation): void {
  void emitUpdateOperationChanged({
    operationId: operation.id,
    containerName: operation.containerName,
    containerId: operation.containerId,
    newContainerId: operation.newContainerId,
    status: operation.status,
    phase: operation.phase,
  });
}

function expireActiveOperationWithMessage(
  operation: UpdateOperation,
  message: string,
): UpdateOperation | undefined {
  const existing = updateOperationCollection!.findOne({ 'data.id': operation.id })?.data;
  if (!existing || !isActiveOperationStatus(existing.status)) {
    return existing;
  }

  return markOperationTerminal(existing.id, {
    status: 'failed',
    lastError: existing.lastError ? `${existing.lastError}; ${message}` : message,
  });
}

function expireStaleActiveOperation(operation: UpdateOperation): UpdateOperation | undefined {
  return expireActiveOperationWithMessage(
    operation,
    getRuntimeExpiredActiveOperationMessage(operation),
  );
}

function reconcileOrphanedActiveOperationOnStartup(
  operation: UpdateOperation,
): UpdateOperation | undefined {
  return expireActiveOperationWithMessage(
    operation,
    getStartupOrphanedActiveOperationMessage(operation),
  );
}

function getFreshActiveOperation(
  operation: UpdateOperation,
  nowMs = Date.now(),
): ActiveUpdateOperation | undefined {
  if (!isActiveUpdateOperation(operation)) {
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

function findOperationDocumentsByStatus(
  collection: UpdateOperationCollection,
  status: ContainerUpdateOperationStatus,
): UpdateOperationCollectionDocument[] {
  const documents = collection.find({ 'data.status': status });
  return Array.isArray(documents) ? documents : [];
}

function reconcileStaleActiveOperationsOnStartup(collection: UpdateOperationCollection): number {
  const documents = ACTIVE_STATUSES.flatMap((status) =>
    findOperationDocumentsByStatus(collection, status),
  );
  if (documents.length === 0) {
    return 0;
  }

  const activeOperations = documents
    .map((document) => document.data)
    .filter((operation): operation is ActiveUpdateOperation => isActiveUpdateOperation(operation));

  for (const operation of activeOperations) {
    reconcileOrphanedActiveOperationOnStartup(operation);
  }

  return activeOperations.length;
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
  // Startup repair emits update-operation change events before API/SSE route
  // initialization has registered subscribers. That is acceptable because the
  // UI reloads state over HTTP on connect instead of depending on replay of
  // startup reconciliation events.
  reconcileStaleActiveOperationsOnStartup(updateOperationCollection);
  pruneOperationsForRetention(updateOperationCollection);
  updateOperationMutationsSincePrune = 0;
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
  } as UpdateOperation;

  if (updateOperationCollection) {
    updateOperationCollection.insert({ data: operationToSave });
    maybePruneOperationsForRetention(updateOperationCollection);
    emitOperationChangedEvent(operationToSave);
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

function persistOperationPatch(
  id: string,
  patch: PersistedUpdateOperationPatch = {},
): UpdateOperation | undefined {
  const existingDoc = updateOperationCollection.findOne({ 'data.id': id });
  if (!existingDoc) {
    return undefined;
  }

  const updated: UpdateOperation = {
    ...existingDoc.data,
    ...patch,
    id: existingDoc.data.id,
    updatedAt: new Date().toISOString(),
  } as UpdateOperation;

  updateOperationCollection.remove(existingDoc);
  updateOperationCollection.insert({ data: updated });
  maybePruneOperationsForRetention(updateOperationCollection);
  emitOperationChangedEvent(updated);

  return updated;
}

/**
 * Update an operation row using active-state fields. Terminal transitions must
 * go through markOperationTerminal().
 */
export function updateOperation(
  id: string,
  patch: UpdateOperationPatch = {},
): UpdateOperation | undefined {
  const existing = getOperationById(id);
  if (!existing) {
    return undefined;
  }
  if (!isActiveOperationStatus(existing.status)) {
    throw new Error(
      'updateOperation cannot modify terminal operations; use reopenTerminalOperation() for an explicit restart',
    );
  }

  if (patch.status && !isActiveOperationStatus(patch.status)) {
    throw new Error(
      'updateOperation only accepts active statuses; use markOperationTerminal() for terminal transitions',
    );
  }

  if (
    patch.phase &&
    isTerminalContainerUpdateOperationPhase(patch.phase as ContainerUpdateOperationPhase)
  ) {
    throw new Error(
      'updateOperation only accepts active phases; use markOperationTerminal() for terminal transitions',
    );
  }

  if (typeof patch.completedAt === 'string') {
    throw new Error(
      'updateOperation cannot set completedAt; use markOperationTerminal() for terminal transitions',
    );
  }

  let resolvedPhase = patch.phase;
  if (patch.status) {
    resolvedPhase = isActiveContainerUpdateOperationPhaseForStatus(patch.status, patch.phase)
      ? patch.phase
      : getDefaultActiveOperationPhase(patch.status);
  } else if (patch.phase) {
    resolvedPhase = isActiveContainerUpdateOperationPhaseForStatus(existing.status, patch.phase)
      ? patch.phase
      : getDefaultActiveOperationPhase(existing.status);
  }

  return persistOperationPatch(id, {
    ...patch,
    ...(resolvedPhase ? { phase: resolvedPhase } : {}),
  });
}

export function reopenTerminalOperation(
  id: string,
  patch: ReopenTerminalOperationPatch,
): UpdateOperation | undefined {
  const existing = getOperationById(id);
  if (!existing) {
    return undefined;
  }
  if (isActiveOperationStatus(existing.status)) {
    throw new Error(
      'reopenTerminalOperation only accepts terminal operations; use updateOperation() for active rows',
    );
  }
  if (!isActiveOperationStatus(patch.status)) {
    throw new Error(
      'reopenTerminalOperation only accepts active statuses; use markOperationTerminal() for terminal transitions',
    );
  }
  if (
    patch.phase &&
    isTerminalContainerUpdateOperationPhase(patch.phase as ContainerUpdateOperationPhase)
  ) {
    throw new Error(
      'reopenTerminalOperation only accepts active phases; use markOperationTerminal() for terminal transitions',
    );
  }
  if (typeof patch.completedAt === 'string') {
    throw new Error('reopenTerminalOperation cannot set completedAt to a string value');
  }

  const resolvedPhase = isActiveContainerUpdateOperationPhaseForStatus(patch.status, patch.phase)
    ? patch.phase
    : getDefaultActiveOperationPhase(patch.status);

  return persistOperationPatch(id, {
    batchId: undefined,
    queuePosition: undefined,
    queueTotal: undefined,
    tempName: undefined,
    oldContainerStopped: undefined,
    ...patch,
    phase: resolvedPhase,
    ...(patch.oldContainerStopped === false ? { oldContainerStopped: false } : {}),
    completedAt: undefined,
    lastError: undefined,
    rollbackReason: undefined,
    newContainerId: undefined,
  });
}

export function markOperationTerminal(
  id: string,
  patch: TerminalUpdateOperationPatch,
): UpdateOperation | undefined {
  const existing = getOperationById(id);
  if (!existing) {
    return undefined;
  }
  if (!isActiveOperationStatus(existing.status)) {
    return existing;
  }

  const completedAt =
    typeof patch.completedAt === 'string' && patch.completedAt.trim() !== ''
      ? patch.completedAt
      : new Date().toISOString();

  return persistOperationPatch(id, {
    ...patch,
    phase: resolveTerminalContainerUpdateOperationPhase(patch.status, patch.phase),
    completedAt,
    batchId: undefined,
    queuePosition: undefined,
    queueTotal: undefined,
  });
}

/**
 * Return the latest in-progress operation for a container name.
 */
export function getInProgressOperationByContainerName(
  containerName: string,
): InProgressUpdateOperation | undefined {
  if (!updateOperationCollection) {
    return undefined;
  }

  const operations = updateOperationCollection
    .find({
      'data.containerName': containerName,
      'data.status': 'in-progress',
    })
    .map((item) => item.data)
    .filter(isInProgressUpdateOperation)
    .sort((a, b) => getOperationTimestamp(b) - getOperationTimestamp(a));

  return operations.at(0);
}

/**
 * Return the latest in-progress operation for a container ID.
 */
export function getInProgressOperationByContainerId(
  containerId: string,
): InProgressUpdateOperation | undefined {
  if (!updateOperationCollection || !containerId) {
    return undefined;
  }

  const operationsById = new Map<string, InProgressUpdateOperation>();

  for (const document of updateOperationCollection.find({
    'data.containerId': containerId,
    'data.status': 'in-progress',
  })) {
    if (isInProgressUpdateOperation(document.data)) {
      operationsById.set(document.data.id, document.data);
    }
  }

  for (const document of updateOperationCollection.find({
    'data.newContainerId': containerId,
    'data.status': 'in-progress',
  })) {
    if (isInProgressUpdateOperation(document.data)) {
      operationsById.set(document.data.id, document.data);
    }
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
): ActiveUpdateOperation | undefined {
  if (!updateOperationCollection) {
    return undefined;
  }

  const operations = updateOperationCollection
    .find({ 'data.containerName': containerName })
    .map((item) => getFreshActiveOperation(item.data))
    .filter((item): item is ActiveUpdateOperation => Boolean(item))
    .sort((a, b) => getOperationTimestamp(b) - getOperationTimestamp(a));

  return operations.at(0);
}

/**
 * Return the latest active (in-progress OR queued) operation for a container ID.
 */
export function getActiveOperationByContainerId(
  containerId: string,
): ActiveUpdateOperation | undefined {
  if (!updateOperationCollection || !containerId) {
    return undefined;
  }

  const operationsById = new Map<string, ActiveUpdateOperation>();
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
