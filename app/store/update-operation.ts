import crypto from 'node:crypto';
import { getDefaultCacheMaxEntries } from '../configuration/runtime-defaults.js';
import {
  emitBatchUpdateCompleted,
  emitContainerUpdateApplied,
  emitContainerUpdateFailed,
  emitUpdateOperationChanged,
} from '../event/index.js';
import type { Container } from '../model/container.js';
import { deriveContainerIdentityKey, getContainerIdentityKey } from '../model/container.js';
import type {
  ActiveContainerUpdateOperationPhase,
  ActiveContainerUpdateOperationStatus,
  ContainerUpdateOperationKind,
  ContainerUpdateOperationPhase,
  ContainerUpdateOperationStatus,
  ExpiredContainerUpdateOperationPhase,
  FailedContainerUpdateOperationPhase,
  InProgressContainerUpdateOperationPhase,
  RolledBackContainerUpdateOperationPhase,
  SkippedDependencyContainerUpdateOperationPhase,
  SucceededContainerUpdateOperationPhase,
} from '../model/container-update-operation.js';
import {
  ACTIVE_CONTAINER_UPDATE_OPERATION_STATUSES,
  isActiveContainerUpdateOperationPhaseForStatus,
  isTerminalContainerUpdateOperationPhase,
  resolveTerminalContainerUpdateOperationPhase,
  TERMINAL_CONTAINER_UPDATE_OPERATION_STATUSES,
} from '../model/container-update-operation.js';
import { daysToMs } from '../model/maturity-policy.js';
import { toPositiveInteger } from '../util/parse.js';
import type { Database, Row } from './db/driver.js';

interface UpdateOperationBase {
  id: string;
  kind?: ContainerUpdateOperationKind;
  containerName: string;
  createdAt: string;
  updatedAt: string;
  containerId?: string;
  /**
   * Durable business identity (roadmap 7-STORE, slice 10). Derived on every
   * insert and every patch from `container.identityKey` when a container
   * snapshot is present, falling back to `${agent}::${watcher}::${containerName}`
   * otherwise. Never accepted as caller input — see `deriveOperationIdentityKey`.
   */
  containerIdentityKey?: string;
  triggerName?: string;
  oldContainerId?: string;
  oldName?: string;
  tempName?: string;
  oldContainerWasRunning?: boolean;
  oldContainerStopped?: boolean;
  newContainerId?: string;
  agent?: string;
  watcher?: string;
  fromVersion?: string;
  toVersion?: string;
  targetImage?: string;
  rollbackReason?: string;
  lastError?: string;
  recoveredAt?: string;
  completedAt?: string;
  /**
   * Set alongside `status: 'skipped-dependency'` (v1.7 Phase 6.1, #219): why a
   * dependency-ordered wave dispatch never attempted this container —
   * `upstream-failed` when a dependency in its chain failed/rolled back this
   * cycle, `waiting-on-dependency-window` when a dependency was deferred by
   * its own maintenance window. See design §3.
   */
  skippedDependencyReason?: 'upstream-failed' | 'waiting-on-dependency-window';
  /** The upstream container id that caused a `skipped-dependency` terminal state. */
  blockingContainerId?: string;
  /** The upstream operation id that caused a `skipped-dependency` terminal state. */
  blockingOperationId?: string;
  /**
   * Operator-requested mid-flight cancellation. Set by the cancel API; the
   * lifecycle checks this at safe checkpoints and aborts before any further
   * destructive action when true.
   */
  cancelRequested?: boolean;
  /**
   * Snapshot of the Container object at enqueue time. Persisted so that
   * terminal lifecycle events (update-applied / update-failed) can attach the
   * container to the event payload even when the store no longer has the row
   * (e.g. after a compose recreate removes the old container before the new one
   * is re-watched). See issue #385.
   */
  container?: Container;
  finalizeSecretHash?: string;
  helperLifecycleOwner?: 'exiting-process' | 'surviving-process';
  /**
   * Portainer-specific recovery descriptor persisted so a controller restart
   * can reconcile an in-flight stack redeploy instead of expiring it. Opaque
   * to the store: the Portainer trigger owns the shape and validates it
   * before use. Never exposed via `toApiUpdateOperation` (may echo stack
   * env values) and always cleared by `markOperationTerminal`.
   */
  portainerRecovery?: unknown;
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
  batchId?: string;
  queuePosition?: number;
  queueTotal?: number;
}

interface RolledBackUpdateOperation extends UpdateOperationBase {
  status: 'rolled-back';
  phase: RolledBackContainerUpdateOperationPhase;
  completedAt: string;
  batchId?: string;
  queuePosition?: number;
  queueTotal?: number;
}

interface FailedUpdateOperation extends UpdateOperationBase {
  status: 'failed';
  phase: FailedContainerUpdateOperationPhase;
  completedAt: string;
  batchId?: string;
  queuePosition?: number;
  queueTotal?: number;
}

/**
 * Terminal state for an operation the controller could neither complete nor
 * confirm: the active-TTL sweep or startup-orphan reconciliation found it stuck
 * (orphaned `queued`/`in-progress` rows, or a remote update whose agent never
 * reported back). Unlike `failed`, it emits NO `update-failed` lifecycle event,
 * so a stuck or merely-slow operation can never surface a false "update failed"
 * notification. See issue #410.
 */
interface ExpiredUpdateOperation extends UpdateOperationBase {
  status: 'expired';
  phase: ExpiredContainerUpdateOperationPhase;
  completedAt: string;
  batchId?: string;
  queuePosition?: number;
  queueTotal?: number;
}

/**
 * Terminal state for a container never attempted because a dependency in its
 * chain blocked it this cycle (v1.7 Phase 6.1, #219 — design §3): either an
 * upstream container failed/rolled back, or an upstream container was
 * deferred by its own maintenance window. Like `expired`, it emits NO
 * `update-failed` lifecycle event — work that was never attempted must never
 * surface a false "update failed" notification.
 */
interface SkippedDependencyUpdateOperation extends UpdateOperationBase {
  status: 'skipped-dependency';
  phase: SkippedDependencyContainerUpdateOperationPhase;
  completedAt: string;
  batchId?: string;
  queuePosition?: number;
  queueTotal?: number;
}

type UpdateOperation =
  | QueuedUpdateOperation
  | InProgressUpdateOperation
  | SucceededUpdateOperation
  | RolledBackUpdateOperation
  | FailedUpdateOperation
  | ExpiredUpdateOperation
  | SkippedDependencyUpdateOperation;

type ActiveUpdateOperation = QueuedUpdateOperation | InProgressUpdateOperation;
type BatchCompletionItemStatus = 'succeeded' | 'failed';

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
  | 'agent'
  | 'watcher'
  | 'fromVersion'
  | 'toVersion'
  | 'targetImage'
  | 'rollbackReason'
  | 'lastError'
  | 'recoveredAt'
  | 'cancelRequested'
  | 'container'
  | 'skippedDependencyReason'
  | 'blockingContainerId'
  | 'blockingOperationId'
  | 'portainerRecovery'
>;

interface InsertUpdateOperationInput
  extends Partial<Pick<UpdateOperationBase, 'id' | 'createdAt' | 'updatedAt'>> {
  containerName: string;
  status?: ContainerUpdateOperationStatus;
  phase?: ContainerUpdateOperationPhase;
  kind?: ContainerUpdateOperationKind;
  containerId?: string;
  triggerName?: string;
  oldContainerId?: string;
  oldName?: string;
  tempName?: string;
  oldContainerWasRunning?: boolean;
  oldContainerStopped?: boolean;
  newContainerId?: string;
  agent?: string;
  watcher?: string;
  fromVersion?: string;
  toVersion?: string;
  targetImage?: string;
  rollbackReason?: string;
  lastError?: string;
  recoveredAt?: string;
  completedAt?: string;
  skippedDependencyReason?: 'upstream-failed' | 'waiting-on-dependency-window';
  blockingContainerId?: string;
  blockingOperationId?: string;
  cancelRequested?: boolean;
  container?: Container;
  finalizeSecretHash?: string;
  helperLifecycleOwner?: 'exiting-process' | 'surviving-process';
  portainerRecovery?: unknown;
  batchId?: string;
  queuePosition?: number;
  queueTotal?: number;
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
    })
  | (TerminalUpdateOperationPatchBase & {
      status: 'expired';
      phase?: ExpiredContainerUpdateOperationPhase;
    })
  | (TerminalUpdateOperationPatchBase & {
      status: 'skipped-dependency';
      phase?: SkippedDependencyContainerUpdateOperationPhase;
    });

let db: Database | undefined;
// In-memory registry: batchId → Set of operationIds. Populated on insert or startup
// rehydration and cleared when the batch completes.
const batchMemberRegistry = new Map<string, Set<string>>();
const incompleteRehydratedBatchIds = new Set<string>();
const DEFAULT_UPDATE_OPERATION_MAX_ENTRIES = getDefaultCacheMaxEntries();
const DEFAULT_UPDATE_OPERATION_RETENTION_DAYS = 30;
const DEFAULT_UPDATE_OPERATION_ACTIVE_TTL_MS = 30 * 60 * 1000;
const SELF_UPDATE_OPERATION_GRACE_MS = 10 * 60 * 1000;
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

/**
 * The `update_operations` table's columns, in the fixed order every
 * INSERT/UPDATE binds its parameters in (roadmap 7-STORE, slice 10). `id` is
 * first because it is also the row-identity WHERE-clause parameter; the
 * UPDATE statement slices it off before appending it back at the end.
 */
const UPDATE_OPERATION_COLUMNS = [
  'id',
  'container_identity_key',
  'container_id',
  'container_name',
  'new_container_id',
  'old_container_id',
  'old_name',
  'temp_name',
  'status',
  'phase',
  'kind',
  'batch_id',
  'queue_position',
  'queue_total',
  'trigger_name',
  'agent',
  'watcher',
  'from_version',
  'to_version',
  'target_image',
  'rollback_reason',
  'last_error',
  'skipped_dependency_reason',
  'blocking_container_id',
  'blocking_operation_id',
  'cancel_requested',
  'old_container_was_running',
  'old_container_stopped',
  'helper_lifecycle_owner',
  'finalize_secret_hash',
  'created_at',
  'updated_at',
  'completed_at',
  'recovered_at',
  'container_snapshot',
  'portainer_recovery',
] as const;

type UpdateOperationColumn = (typeof UPDATE_OPERATION_COLUMNS)[number];
type UpdateOperationRow = Record<UpdateOperationColumn, string | number | null>;

const UPDATE_OPERATION_UPDATE_COLUMNS = UPDATE_OPERATION_COLUMNS.filter(
  (column): column is Exclude<UpdateOperationColumn, 'id'> => column !== 'id',
);

const UPDATE_OPERATION_INSERT_SQL = `INSERT INTO update_operations (${UPDATE_OPERATION_COLUMNS.join(', ')}) VALUES (${UPDATE_OPERATION_COLUMNS.map(() => '?').join(', ')})`;
/**
 * Upsert variant of `UPDATE_OPERATION_INSERT_SQL`, used only by
 * `insertImportedUpdateOperationRow` (roadmap 7-STORE slice 10 review
 * finding 1). A first-start import can see the same snapshot twice (a
 * restarted import, a re-run migration), and a plain INSERT keyed on `id`
 * throws a UNIQUE constraint error on the second pass. `ON CONFLICT(id) DO
 * UPDATE` makes the import idempotent, same shape as the retention-cache
 * importer's upsert (`app/store/db/importers/update-policy-retention-cache.ts`).
 */
const UPDATE_OPERATION_UPSERT_SQL = `INSERT INTO update_operations (${UPDATE_OPERATION_COLUMNS.join(', ')}) VALUES (${UPDATE_OPERATION_COLUMNS.map(() => '?').join(', ')}) ON CONFLICT(id) DO UPDATE SET ${UPDATE_OPERATION_UPDATE_COLUMNS.map((column) => `${column} = excluded.${column}`).join(', ')}`;
const UPDATE_OPERATION_UPDATE_SQL = `UPDATE update_operations SET ${UPDATE_OPERATION_UPDATE_COLUMNS.map((column) => `${column} = ?`).join(', ')} WHERE id = ?`;
const UPDATE_OPERATION_SELECT_BY_ID_SQL = 'SELECT * FROM update_operations WHERE id = ?';
const UPDATE_OPERATION_SELECT_BY_STATUS_SQL = 'SELECT * FROM update_operations WHERE status = ?';
/**
 * Retention-prune projection (roadmap 7-STORE slice 10 review finding 5).
 * The retention sweep in `pruneOperationsForRetention` only needs `id` and
 * the two timestamp columns to decide what to keep, but the plain
 * `SELECT *` behind `selectOperationsByStatus` hydrated every terminal
 * row's full 35 columns — including both JSON columns
 * (`container_snapshot`, `portainer_recovery`) — through `rowToOperation`
 * just to throw the rest away. This selects only the three columns the
 * sweep actually reads.
 */
const UPDATE_OPERATION_SELECT_RETENTION_BY_STATUS_SQL =
  'SELECT id, created_at, updated_at FROM update_operations WHERE status = ?';
const UPDATE_OPERATION_SELECT_BY_IDENTITY_SQL =
  'SELECT * FROM update_operations WHERE container_identity_key = ?';
const UPDATE_OPERATION_SELECT_BY_IDENTITY_STATUS_SQL =
  'SELECT * FROM update_operations WHERE container_identity_key = ? AND status = ?';
const UPDATE_OPERATION_SELECT_BY_CONTAINER_ID_SQL =
  'SELECT * FROM update_operations WHERE container_id = ?';
const UPDATE_OPERATION_SELECT_BY_CONTAINER_ID_STATUS_SQL =
  'SELECT * FROM update_operations WHERE container_id = ? AND status = ?';
const UPDATE_OPERATION_SELECT_BY_NEW_CONTAINER_ID_SQL =
  'SELECT * FROM update_operations WHERE new_container_id = ?';
const UPDATE_OPERATION_SELECT_BY_NEW_CONTAINER_ID_STATUS_SQL =
  'SELECT * FROM update_operations WHERE new_container_id = ? AND status = ?';
const UPDATE_OPERATION_SELECT_BY_BATCH_SQL = 'SELECT * FROM update_operations WHERE batch_id = ?';
const UPDATE_OPERATION_DELETE_BY_ID_SQL = 'DELETE FROM update_operations WHERE id = ?';

function toStoredJson(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

function fromStoredJson<T>(value: string | number | null): T | undefined {
  return value === null || value === undefined ? undefined : (JSON.parse(String(value)) as T);
}

function optionalString(value: string | number | null): string | undefined {
  return value === null || value === undefined ? undefined : String(value);
}

function optionalNumber(value: string | number | null): number | undefined {
  return value === null || value === undefined ? undefined : Number(value);
}

function optionalBoolean(value: string | number | null): boolean | undefined {
  return value === null || value === undefined ? undefined : Boolean(Number(value));
}

function toStoredBoolean(value: boolean | undefined): number | null {
  return value === undefined ? null : value ? 1 : 0;
}

/**
 * Turn a persisted operation into the row every INSERT/UPDATE binds. Called
 * with an already-identity-derived operation (see `deriveOperationIdentityKey`),
 * so `container_identity_key` is threaded straight through.
 */
function operationToRow(op: UpdateOperation): UpdateOperationRow {
  const withBatch = op as Partial<QueuedUpdateOperation>;
  return {
    id: op.id,
    container_identity_key: op.containerIdentityKey ?? null,
    container_id: op.containerId ?? null,
    container_name: op.containerName,
    new_container_id: op.newContainerId ?? null,
    old_container_id: op.oldContainerId ?? null,
    old_name: op.oldName ?? null,
    temp_name: op.tempName ?? null,
    status: op.status,
    phase: op.phase,
    kind: op.kind ?? null,
    batch_id: withBatch.batchId ?? null,
    queue_position: withBatch.queuePosition ?? null,
    queue_total: withBatch.queueTotal ?? null,
    trigger_name: op.triggerName ?? null,
    agent: op.agent ?? null,
    watcher: op.watcher ?? null,
    from_version: op.fromVersion ?? null,
    to_version: op.toVersion ?? null,
    target_image: op.targetImage ?? null,
    rollback_reason: op.rollbackReason ?? null,
    last_error: op.lastError ?? null,
    skipped_dependency_reason: op.skippedDependencyReason ?? null,
    blocking_container_id: op.blockingContainerId ?? null,
    blocking_operation_id: op.blockingOperationId ?? null,
    cancel_requested: toStoredBoolean(op.cancelRequested) ?? 0,
    old_container_was_running: toStoredBoolean(op.oldContainerWasRunning),
    old_container_stopped: toStoredBoolean(op.oldContainerStopped),
    helper_lifecycle_owner: op.helperLifecycleOwner ?? null,
    finalize_secret_hash: op.finalizeSecretHash ?? null,
    created_at: op.createdAt,
    updated_at: op.updatedAt,
    completed_at: op.completedAt ?? null,
    recovered_at: op.recoveredAt ?? null,
    container_snapshot: toStoredJson(op.container),
    portainer_recovery: toStoredJson(op.portainerRecovery),
  };
}

function rowToOperation(row: Row): UpdateOperation {
  const typedRow = row as unknown as UpdateOperationRow;
  const raw: Record<string, unknown> = {
    id: String(typedRow.id),
    containerIdentityKey: optionalString(typedRow.container_identity_key),
    containerId: optionalString(typedRow.container_id),
    containerName: String(typedRow.container_name),
    newContainerId: optionalString(typedRow.new_container_id),
    oldContainerId: optionalString(typedRow.old_container_id),
    oldName: optionalString(typedRow.old_name),
    tempName: optionalString(typedRow.temp_name),
    status: String(typedRow.status),
    phase: String(typedRow.phase),
    kind: optionalString(typedRow.kind),
    batchId: optionalString(typedRow.batch_id),
    queuePosition: optionalNumber(typedRow.queue_position),
    queueTotal: optionalNumber(typedRow.queue_total),
    triggerName: optionalString(typedRow.trigger_name),
    agent: optionalString(typedRow.agent),
    watcher: optionalString(typedRow.watcher),
    fromVersion: optionalString(typedRow.from_version),
    toVersion: optionalString(typedRow.to_version),
    targetImage: optionalString(typedRow.target_image),
    rollbackReason: optionalString(typedRow.rollback_reason),
    lastError: optionalString(typedRow.last_error),
    skippedDependencyReason: optionalString(typedRow.skipped_dependency_reason),
    blockingContainerId: optionalString(typedRow.blocking_container_id),
    blockingOperationId: optionalString(typedRow.blocking_operation_id),
    // c8 ignore next -- cancel_requested is NOT NULL DEFAULT 0 in the schema; optionalBoolean never returns undefined for it.
    cancelRequested: optionalBoolean(typedRow.cancel_requested) ?? false,
    oldContainerWasRunning: optionalBoolean(typedRow.old_container_was_running),
    oldContainerStopped: optionalBoolean(typedRow.old_container_stopped),
    helperLifecycleOwner: optionalString(typedRow.helper_lifecycle_owner),
    finalizeSecretHash: optionalString(typedRow.finalize_secret_hash),
    createdAt: String(typedRow.created_at),
    updatedAt: String(typedRow.updated_at),
    completedAt: optionalString(typedRow.completed_at),
    recoveredAt: optionalString(typedRow.recovered_at),
    container: fromStoredJson<Container>(typedRow.container_snapshot),
    portainerRecovery: fromStoredJson<unknown>(typedRow.portainer_recovery),
  };
  return raw as unknown as UpdateOperation;
}

function insertOperationRow(database: Database, op: UpdateOperation): void {
  const row = operationToRow(op);
  database
    .prepare(UPDATE_OPERATION_INSERT_SQL)
    .run(...UPDATE_OPERATION_COLUMNS.map((column) => row[column]));
}

function updateOperationRow(database: Database, op: UpdateOperation): void {
  const row = operationToRow(op);
  database
    .prepare(UPDATE_OPERATION_UPDATE_SQL)
    .run(...UPDATE_OPERATION_UPDATE_COLUMNS.map((column) => row[column]), row.id);
}

function selectOperationById(database: Database, id: string): UpdateOperation | undefined {
  const row = database.prepare(UPDATE_OPERATION_SELECT_BY_ID_SQL).get(id);
  return row ? rowToOperation(row) : undefined;
}

function selectOperationsByStatus(
  database: Database,
  status: ContainerUpdateOperationStatus,
): UpdateOperation[] {
  return database.prepare(UPDATE_OPERATION_SELECT_BY_STATUS_SQL).all(status).map(rowToOperation);
}

/** Projection row for the retention sweep (see `UPDATE_OPERATION_SELECT_RETENTION_BY_STATUS_SQL`). */
interface OperationRetentionRow {
  id: string;
  createdAt: string;
  updatedAt: string;
}

function rowToOperationRetentionRow(row: Row): OperationRetentionRow {
  const typedRow = row as unknown as { id: string; created_at: string; updated_at: string };
  return {
    id: String(typedRow.id),
    createdAt: String(typedRow.created_at),
    updatedAt: String(typedRow.updated_at),
  };
}

function selectOperationRetentionRowsByStatus(
  database: Database,
  status: ContainerUpdateOperationStatus,
): OperationRetentionRow[] {
  return database
    .prepare(UPDATE_OPERATION_SELECT_RETENTION_BY_STATUS_SQL)
    .all(status)
    .map(rowToOperationRetentionRow);
}

function getRetentionRowTimestamp(row: OperationRetentionRow): number {
  const timestamp = Date.parse(row.updatedAt || row.createdAt);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

/**
 * Derive the durable identity key an operation row is filed under (roadmap
 * 7-STORE, slice 10, spec 2.3). Prefers the container snapshot's own
 * `identityKey` (compose-aware, already computed by `validateContainer`);
 * falls back to the legacy `${agent}::${watcher}::${containerName}` form when
 * only agent/watcher/containerName are known (e.g. an agent event that has
 * not yet attached a full snapshot). Undefined when neither is available —
 * the row is filed with no identity, exactly like any other never-resolved
 * legacy value.
 */
function deriveOperationIdentityKey(op: {
  containerName?: string;
  agent?: string;
  watcher?: string;
  container?: Container;
}): string | undefined {
  if (op.container) {
    const fromSnapshot = op.container.identityKey ?? deriveContainerIdentityKey(op.container);
    if (fromSnapshot) {
      return fromSnapshot;
    }
  }
  if (typeof op.watcher === 'string' && op.watcher && typeof op.containerName === 'string') {
    return getContainerIdentityKey({
      agent: op.agent,
      watcher: op.watcher,
      name: op.containerName,
    });
  }
  return undefined;
}

/**
 * Build the full parameter row for an imported legacy update-operation
 * document (roadmap 7-STORE slice 10's importer,
 * `store/db/importers/update-operations.ts`). Recomputes
 * `containerIdentityKey` the same way a fresh `insertOperation()` does, from
 * whatever agent/watcher/containerName/container snapshot the legacy
 * document carried, so an operation written before the identity cut still
 * resolves through `getInProgressOperationByContainerIdentity` and its
 * siblings once imported. A document missing one of the columns the schema
 * requires NOT NULL (`id`, `containerName`, `status`, `phase`, `createdAt`,
 * `updatedAt`) is skipped rather than guessed at, matching every other
 * importer's convention.
 */
export function buildImportedUpdateOperationRow(
  rawOperation: unknown,
): UpdateOperationRow | undefined {
  if (!rawOperation || typeof rawOperation !== 'object') {
    return undefined;
  }
  const record = rawOperation as Record<string, unknown>;
  if (
    typeof record.id !== 'string' ||
    typeof record.containerName !== 'string' ||
    typeof record.status !== 'string' ||
    typeof record.phase !== 'string' ||
    typeof record.createdAt !== 'string' ||
    typeof record.updatedAt !== 'string'
  ) {
    return undefined;
  }
  const operation = record as unknown as UpdateOperation;
  const containerIdentityKey = deriveOperationIdentityKey(operation);
  return operationToRow({ ...operation, containerIdentityKey } as UpdateOperation);
}

/**
 * Insert one row built by `buildImportedUpdateOperationRow` into `database`,
 * upserting on `id` so importing the same legacy document twice (a
 * restarted first-start import) updates the existing row instead of
 * throwing a UNIQUE constraint error (roadmap 7-STORE slice 10 review
 * finding 1).
 */
export function insertImportedUpdateOperationRow(
  database: Database,
  row: UpdateOperationRow,
): void {
  database
    .prepare(UPDATE_OPERATION_UPSERT_SQL)
    .run(...UPDATE_OPERATION_COLUMNS.map((column) => row[column]));
}

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
  return `Marked expired after exceeding active update TTL (${UPDATE_OPERATION_ACTIVE_TTL_MS}ms) while ${operation.status === 'queued' ? 'queued' : 'in progress'}`;
}

function getStartupOrphanedActiveOperationMessage(operation: UpdateOperation): string {
  return `Marked expired after orphaned active operation was found during process restart while ${operation.status === 'queued' ? 'queued' : 'in progress'}`;
}

function emitOperationChangedEvent(operation: UpdateOperation): void {
  void emitUpdateOperationChanged({
    operationId: operation.id,
    containerName: operation.containerName,
    ...(operation.triggerName ? { triggerName: operation.triggerName } : {}),
    containerId: operation.containerId,
    newContainerId: operation.newContainerId,
    batchId:
      typeof (operation as { batchId?: unknown }).batchId === 'string'
        ? (operation as { batchId: string }).batchId
        : undefined,
    queuePosition:
      typeof (operation as { queuePosition?: unknown }).queuePosition === 'number'
        ? (operation as { queuePosition: number }).queuePosition
        : undefined,
    queueTotal:
      typeof (operation as { queueTotal?: unknown }).queueTotal === 'number'
        ? (operation as { queueTotal: number }).queueTotal
        : undefined,
    status: operation.status,
    phase: operation.phase,
    lastError:
      typeof operation.lastError === 'string' && operation.lastError.trim() !== ''
        ? operation.lastError
        : undefined,
    rollbackReason:
      typeof operation.rollbackReason === 'string' && operation.rollbackReason.trim() !== ''
        ? operation.rollbackReason
        : undefined,
  });
}

function buildTerminalLifecycleEventBase(operation: UpdateOperation, batchId?: string) {
  return {
    operationId: operation.id,
    ...(operation.containerId ? { containerId: operation.containerId } : {}),
    containerName: operation.containerName,
    ...(batchId ? { batchId } : {}),
    ...(operation.container ? { container: operation.container } : {}),
    ...(operation.newContainerId ? { newContainerId: operation.newContainerId } : {}),
    ...(operation.phase === 'dryrun' ? { phase: 'dryrun' as const } : {}),
  };
}

function getTerminalOperationError(operation: UpdateOperation): string {
  if (typeof operation.lastError === 'string' && operation.lastError.trim() !== '') {
    return operation.lastError;
  }
  return operation.status === 'rolled-back' ? 'Update rolled back' : 'Update failed';
}

function emitTerminalLifecycleEvent(operation: UpdateOperation, batchId?: string): void {
  if (operation.kind === 'self-update') {
    return;
  }

  switch (operation.status) {
    case 'succeeded':
      void emitContainerUpdateApplied(buildTerminalLifecycleEventBase(operation, batchId));
      return;
    case 'failed':
    case 'rolled-back':
      void emitContainerUpdateFailed({
        ...buildTerminalLifecycleEventBase(operation, batchId),
        error: getTerminalOperationError(operation),
        phase: operation.phase,
        ...(typeof operation.rollbackReason === 'string' && operation.rollbackReason.trim() !== ''
          ? { rollbackReason: operation.rollbackReason }
          : {}),
      });
      return;
    case 'expired':
      // Intentionally silent: an expired (TTL-swept / startup-orphaned) operation
      // never completed nor was confirmed failed, so emitting `update-failed`
      // here would surface a false "update failed" notification. See issue #410.
      return;
    case 'skipped-dependency':
      // Intentionally silent: a dependency-ordered wave dispatch never attempted
      // this container (upstream failure or maintenance-window deferral), so it
      // was neither applied nor genuinely failed. See design §3 (#219).
      return;
  }
}

function getBatchCompletionItemStatus(
  status: ContainerUpdateOperationStatus,
): BatchCompletionItemStatus | undefined {
  if (status === 'succeeded') {
    return 'succeeded';
  }
  if (status === 'failed' || status === 'rolled-back') {
    return 'failed';
  }
  return undefined;
}

function expireActiveOperationWithMessage(
  operation: UpdateOperation,
  message: string,
): UpdateOperation | undefined {
  // c8 ignore next 3 -- callers only reach here once db is confirmed set.
  if (!db) {
    return operation;
  }
  const existing = selectOperationById(db, operation.id);
  if (!existing || !isActiveOperationStatus(existing.status)) {
    return existing;
  }

  return markOperationTerminal(existing.id, {
    status: 'expired',
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

function pruneOperationsForRetention(nowMs = Date.now()): number {
  // c8 ignore next 3 -- only called from createCollections, right after db is assigned.
  if (!db) {
    return 0;
  }
  const database = db;
  // Query only terminal rows per status using the existing status index,
  // avoiding a full-table materialisation that would load active ops too.
  // Also project only id/created_at/updated_at (roadmap 7-STORE slice 10
  // review finding 5): the sweep only needs those three columns to decide
  // what to keep, so a `SELECT *` that hydrates all 35 columns — including
  // both JSON columns — for every terminal row just to discard the rest is
  // wasted work.
  const terminalRows = TERMINAL_CONTAINER_UPDATE_OPERATION_STATUSES.flatMap((status) =>
    selectOperationRetentionRowsByStatus(database, status),
  );

  if (terminalRows.length === 0) {
    return 0;
  }

  const retentionWindowMs = daysToMs(UPDATE_OPERATION_RETENTION_DAYS);
  const cutoffTimestamp = nowMs - retentionWindowMs;

  const retainedTerminalIds = new Set(
    terminalRows
      .filter((row) => getRetentionRowTimestamp(row) >= cutoffTimestamp)
      .sort((a, b) => getRetentionRowTimestamp(b) - getRetentionRowTimestamp(a))
      .slice(0, UPDATE_OPERATION_MAX_ENTRIES)
      .map((row) => row.id),
  );

  const toRemove = terminalRows.filter((row) => !retainedTerminalIds.has(row.id));

  if (toRemove.length === 0) {
    return 0;
  }

  const deleteStatement = database.prepare(UPDATE_OPERATION_DELETE_BY_ID_SQL);
  for (const row of toRemove) {
    deleteStatement.run(row.id);
  }

  return toRemove.length;
}

function maybePruneOperationsForRetention(): void {
  updateOperationMutationsSincePrune += 1;
  if (updateOperationMutationsSincePrune >= UPDATE_OPERATION_PRUNE_MUTATION_INTERVAL) {
    pruneOperationsForRetention();
    updateOperationMutationsSincePrune = 0;
  }
}

function isResumableActiveOperationOnStartup(operation: ActiveUpdateOperation): boolean {
  if (operation.kind === 'self-update') {
    return false;
  }
  return operation.status === 'queued' || operation.status === 'in-progress';
}

function resetActiveOperationToQueuedOnStartup(
  database: Database,
  operation: InProgressUpdateOperation,
): void {
  const now = new Date().toISOString();
  const reset: QueuedUpdateOperation = {
    ...operation,
    status: 'queued',
    phase: 'queued',
    updatedAt: now,
    recoveredAt: now,
    lastError: undefined,
    completedAt: undefined,
  } as QueuedUpdateOperation;
  updateOperationRow(database, reset);
  emitOperationChangedEvent(reset);
}

function refreshInProgressOperationForStartupRecovery(
  database: Database,
  operation: InProgressUpdateOperation,
): void {
  const now = new Date().toISOString();
  const refreshed: InProgressUpdateOperation = {
    ...operation,
    updatedAt: now,
    recoveredAt: now,
  };
  updateOperationRow(database, refreshed);
  emitOperationChangedEvent(refreshed);
}

function reconcileStaleActiveOperationsOnStartup(): number {
  // c8 ignore next 3 -- only called from createCollections, right after db is assigned.
  if (!db) {
    return 0;
  }
  const database = db;
  const operations = ACTIVE_STATUSES.flatMap((status) =>
    selectOperationsByStatus(database, status),
  );
  if (operations.length === 0) {
    return 0;
  }

  // selectOperationsByStatus filters by status, so every operation here is an
  // ActiveUpdateOperation (queued or in-progress).
  for (const operationRow of operations) {
    const operation = operationRow as ActiveUpdateOperation;
    // A fresh self-update in-progress op (past the pull phase) is still being
    // finalized by the helper container; skip it so the new process does not
    // expire the operation before the helper POSTs to /internal/self-update/finalize.
    if (
      operation.kind === 'self-update' &&
      operation.status === 'in-progress' &&
      operation.phase !== 'pulling' &&
      Date.now() - getOperationTimestamp(operation) <= SELF_UPDATE_OPERATION_GRACE_MS
    ) {
      continue;
    }
    if (!isResumableActiveOperationOnStartup(operation)) {
      reconcileOrphanedActiveOperationOnStartup(operation);
      continue;
    }
    if (operation.status === 'in-progress' && operation.phase === 'pulling') {
      // Resumable in-progress (pulling) → reset to queued so the recovery
      // dispatcher picks it up uniformly with already-queued operations.
      resetActiveOperationToQueuedOnStartup(database, operation);
    } else if (operation.status === 'in-progress') {
      // Give the post-registry Docker reconciliation pass a fresh TTL window.
      refreshInProgressOperationForStartupRecovery(database, operation);
    }
    // Already-queued resumable operations stay as-is.
  }

  return operations.length;
}

function getPersistedBatchId(operation: UpdateOperation): string | undefined {
  return typeof operation.batchId === 'string' && operation.batchId !== ''
    ? operation.batchId
    : undefined;
}

function rehydrateActiveBatchMembership(): void {
  // c8 ignore next 3 -- only called from createCollections, right after db is assigned.
  if (!db) {
    return;
  }
  const database = db;
  const activeOperations = ACTIVE_STATUSES.flatMap((status) =>
    selectOperationsByStatus(database, status),
  );
  const activeBatchIds = new Set(
    activeOperations.map((operation) => getPersistedBatchId(operation)).filter(Boolean),
  );
  if (activeBatchIds.size === 0) {
    return;
  }

  const allOperations = [
    ...activeOperations,
    ...TERMINAL_CONTAINER_UPDATE_OPERATION_STATUSES.flatMap((status) =>
      selectOperationsByStatus(database, status),
    ),
  ];
  for (const batchId of activeBatchIds) {
    const members = allOperations.filter((operation) => getPersistedBatchId(operation) === batchId);
    const memberIds = new Set(members.map((operation) => operation.id));
    batchMemberRegistry.set(batchId, memberIds);

    const expectedTotals = new Set(
      members
        .map((operation) => operation.queueTotal)
        .filter((total): total is number => Number.isSafeInteger(total) && total > 0),
    );
    if (expectedTotals.size !== 1 || expectedTotals.values().next().value !== memberIds.size) {
      incompleteRehydratedBatchIds.add(batchId);
    }
  }
}

/**
 * Wire the update-operation store to the shared SQLite database
 * (roadmap 7-STORE, slice 10) and run the same startup repair the LokiJS
 * collection used to run on `addCollection`.
 * @param database
 */
export function createCollections(database: Database): void {
  db = database;
  updateOperationMutationsSincePrune = 0;
  batchMemberRegistry.clear();
  incompleteRehydratedBatchIds.clear();
  // Startup repair emits update-operation change events before API/SSE route
  // initialization has registered subscribers. That is acceptable because the
  // UI reloads state over HTTP on connect instead of depending on replay of
  // startup reconciliation events.
  reconcileStaleActiveOperationsOnStartup();
  pruneOperationsForRetention();
  rehydrateActiveBatchMembership();
  updateOperationMutationsSincePrune = 0;
}

/**
 * Insert a persisted container-update operation.
 *
 * `options.skipChangeEvent` suppresses the `dd:update-operation-changed` SSE
 * for this insert. Used when a transient `queued` state would only flash in
 * the UI before the executor immediately picks the operation up — see
 * `createAcceptedContainerUpdateRequest` and the no-cap concurrency path.
 */
export function insertOperation(
  operation: InsertUpdateOperationInput,
  options: { skipChangeEvent?: boolean } = {},
): UpdateOperation {
  const now = new Date().toISOString();
  const operationToSave: UpdateOperation = {
    ...operation,
    id: operation.id || crypto.randomUUID(),
    status: operation.status || 'in-progress',
    phase: operation.phase || 'prepare',
    createdAt: operation.createdAt || now,
    updatedAt: now,
  } as UpdateOperation;

  // Normalise empty-string identity fields to undefined after building the
  // operation object.  `getOperationIdentity` and `matchesStrictIdentityFilter`
  // treat '' and undefined identically via `?? ''`, so leaving '' in the store
  // would make the identity-matching invariant depend on every caller being
  // careful.  Doing it here makes the guarantee unconditional.
  const op = operationToSave as unknown as Record<string, unknown>;
  if (op.agent === '') op.agent = undefined;
  if (op.watcher === '') op.watcher = undefined;
  const savedContainer = op.container;
  if (savedContainer && typeof savedContainer === 'object') {
    const c = savedContainer as Record<string, unknown>;
    if (c.agent === '' || c.watcher === '') {
      // Clone rather than mutate in place: the container snapshot belongs to the
      // caller and may be a live store document; mutating it would corrupt shared state.
      const cloned = { ...c };
      if (cloned.agent === '') cloned.agent = undefined;
      if (cloned.watcher === '') cloned.watcher = undefined;
      op.container = cloned;
    }
  }

  operationToSave.containerIdentityKey = deriveOperationIdentityKey(operationToSave);

  if (db) {
    insertOperationRow(db, operationToSave);
    maybePruneOperationsForRetention();
    if (!options.skipChangeEvent) {
      emitOperationChangedEvent(operationToSave);
    }
  }

  // Register batch membership for batch-completion tracking.
  const insertedBatchId =
    typeof (operationToSave as { batchId?: unknown }).batchId === 'string' &&
    (operationToSave as { batchId?: unknown }).batchId !== ''
      ? (operationToSave as { batchId: string }).batchId
      : undefined;
  if (insertedBatchId) {
    if (!batchMemberRegistry.has(insertedBatchId)) {
      batchMemberRegistry.set(insertedBatchId, new Set<string>());
    }
    batchMemberRegistry.get(insertedBatchId)!.add(operationToSave.id);
  }

  return operationToSave;
}

/**
 * Return a single operation by its unique ID.
 */
export function getOperationById(id: string): UpdateOperation | undefined {
  if (!db || !id) {
    return undefined;
  }

  return selectOperationById(db, id);
}

/**
 * Return a self-update operation by id, expiring it if it has exceeded the
 * grace window. Returns undefined for unknown ids, missing collections, and
 * non-self-update kinds. Terminal rows are returned as-is.
 */
export function getFreshSelfUpdateOperationById(id: string): UpdateOperation | undefined {
  if (!db || !id) {
    return undefined;
  }

  const op = selectOperationById(db, id);
  if (!op || op.kind !== 'self-update') {
    return undefined;
  }

  if (isActiveOperationStatus(op.status)) {
    if (Date.now() - getOperationTimestamp(op) > SELF_UPDATE_OPERATION_GRACE_MS) {
      return markOperationTerminal(id, {
        status: 'expired',
        lastError: 'Self-update operation exceeded the grace window without finalization',
      });
    }
  }

  return op;
}

function persistOperationPatch(
  id: string,
  patch: PersistedUpdateOperationPatch = {},
): UpdateOperation | undefined {
  // c8 ignore next 3 -- callers only reach here after getOperationById confirmed db is set.
  if (!db) {
    return undefined;
  }
  const database = db;
  const existing = selectOperationById(database, id);
  if (!existing) {
    return undefined;
  }

  const updated: UpdateOperation = {
    ...existing,
    ...patch,
    id: existing.id,
    updatedAt: new Date().toISOString(),
  } as UpdateOperation;
  if (Object.hasOwn(patch, 'portainerRecovery') && patch.portainerRecovery === undefined) {
    delete (updated as unknown as Record<string, unknown>).portainerRecovery;
  }
  updated.containerIdentityKey = deriveOperationIdentityKey(updated);

  updateOperationRow(database, updated);
  maybePruneOperationsForRetention();
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

  // Capture batchId before writing terminal state for event correlation.
  const preBatchId =
    typeof (existing as { batchId?: unknown }).batchId === 'string' &&
    (existing as { batchId?: unknown }).batchId !== ''
      ? (existing as { batchId: string }).batchId
      : undefined;

  const completedAt =
    typeof patch.completedAt === 'string' && patch.completedAt.trim() !== ''
      ? patch.completedAt
      : new Date().toISOString();

  const updated = persistOperationPatch(id, {
    ...patch,
    portainerRecovery: undefined,
    phase: resolveTerminalContainerUpdateOperationPhase(patch.status, patch.phase),
    completedAt,
  });

  if (updated) {
    emitTerminalLifecycleEvent(updated, preBatchId);
  }

  // After writing terminal state, check if this was the last active operation in the batch.
  if (preBatchId) {
    // Check remaining active ops in batch (active ops still have batchId set).
    // c8 ignore next: db is always set when preBatchId is truthy
    /* c8 ignore next */
    const remainingActive = db
      ? db
          .prepare(UPDATE_OPERATION_SELECT_BY_BATCH_SQL)
          .all(preBatchId)
          .map(rowToOperation)
          .filter((operation) => isActiveOperationStatus(operation.status))
      : [];

    if (remainingActive.length === 0) {
      // All operations in this batch have reached a terminal state.
      // Use the in-memory registry to reconstruct full batch membership.
      const memberIds = batchMemberRegistry.get(preBatchId);
      if (memberIds && memberIds.size > 0) {
        batchMemberRegistry.delete(preBatchId);
        const incomplete = incompleteRehydratedBatchIds.delete(preBatchId);

        if (incomplete) {
          return updated;
        }

        // durationMs: sum of per-operation (completedAt - createdAt) for each batch item.
        let totalDurationMs = 0;
        const items: Array<{
          operationId: string;
          containerId: string;
          containerName: string;
          status: BatchCompletionItemStatus;
        }> = [];

        for (const memberId of memberIds) {
          // c8 ignore next: updated is always defined here; the ?? fallback is a null-safety guard
          /* c8 ignore next */
          const op =
            memberId === id ? (updated ?? getOperationById(memberId)) : getOperationById(memberId);
          if (!op) {
            continue;
          }
          const opStatus = getBatchCompletionItemStatus(op.status);
          if (!opStatus) {
            continue;
          }
          const createdAtMs = Date.parse(op.createdAt);
          const completedAtMs = Date.parse(
            typeof op.completedAt === 'string' ? op.completedAt : completedAt,
          );
          const opDuration =
            !Number.isNaN(createdAtMs) && !Number.isNaN(completedAtMs)
              ? Math.max(0, completedAtMs - createdAtMs)
              : 0;
          totalDurationMs += opDuration;

          items.push({
            operationId: op.id,
            containerId: typeof op.containerId === 'string' ? op.containerId : '',
            containerName: op.containerName,
            status: opStatus,
          });
        }

        const succeededCount = items.filter((i) => i.status === 'succeeded').length;
        const failedCount = items.filter((i) => i.status === 'failed').length;

        if (items.length > 0) {
          void emitBatchUpdateCompleted({
            batchId: preBatchId,
            total: items.length,
            succeeded: succeededCount,
            failed: failedCount,
            durationMs: totalDurationMs,
            items,
            timestamp: new Date().toISOString(),
          });
        }
      }
    }
  }

  return updated;
}

/**
 * Return the latest in-progress operation for a container's durable identity
 * key (roadmap 7-STORE, slice 10, spec 2.3). `identityKey` already encodes
 * agent+watcher+name (or the compose project/service pair), so no separate
 * agent/watcher filter is needed the way the pre-migration by-name lookup
 * required one to avoid cross-agent collisions (issue #411).
 */
export function getInProgressOperationByContainerIdentity(
  identityKey: string | undefined,
): InProgressUpdateOperation | undefined {
  if (!db || !identityKey) {
    return undefined;
  }

  const operations = db
    .prepare(UPDATE_OPERATION_SELECT_BY_IDENTITY_STATUS_SQL)
    .all(identityKey, 'in-progress')
    .map(rowToOperation)
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
  if (!db || !containerId) {
    return undefined;
  }

  const operationsById = new Map<string, InProgressUpdateOperation>();

  for (const operation of db
    .prepare(UPDATE_OPERATION_SELECT_BY_CONTAINER_ID_STATUS_SQL)
    .all(containerId, 'in-progress')
    .map(rowToOperation)) {
    // c8 ignore next 3 -- SQL already filtered WHERE status = 'in-progress'; redundant type narrowing.
    if (isInProgressUpdateOperation(operation)) {
      operationsById.set(operation.id, operation);
    }
  }

  for (const operation of db
    .prepare(UPDATE_OPERATION_SELECT_BY_NEW_CONTAINER_ID_STATUS_SQL)
    .all(containerId, 'in-progress')
    .map(rowToOperation)) {
    // c8 ignore next 3 -- SQL already filtered WHERE status = 'in-progress'; redundant type narrowing.
    if (isInProgressUpdateOperation(operation)) {
      operationsById.set(operation.id, operation);
    }
  }

  const operations = [...operationsById.values()].sort(
    (a, b) => getOperationTimestamp(b) - getOperationTimestamp(a),
  );

  return operations.at(0);
}

/**
 * Return the latest active (in-progress OR queued) operation for a
 * container's durable identity key.
 */
export function getActiveOperationByContainerIdentity(
  identityKey: string | undefined,
): ActiveUpdateOperation | undefined {
  if (!db || !identityKey) {
    return undefined;
  }

  const operations = db
    .prepare(UPDATE_OPERATION_SELECT_BY_IDENTITY_SQL)
    .all(identityKey)
    .map(rowToOperation)
    .map((operation) => getFreshActiveOperation(operation))
    .filter((item): item is ActiveUpdateOperation => Boolean(item))
    .sort((a, b) => getOperationTimestamp(b) - getOperationTimestamp(a));

  return operations.at(0);
}

/**
 * Return true when an active (in-progress or queued) operation exists for the
 * container identity, excluding the given operation id.
 *
 * Used by the duplicate-update dedup logic (issue #421): when a duplicate
 * request fails with a 409 while the winning update is still in flight, no
 * succeeded row exists yet — the presence of *another* active operation for
 * the same container identity proves the conflict is benign.
 */
export function hasOtherActiveOperationByContainerIdentity(
  identityKey: string | undefined,
  excludeOperationId: string,
): boolean {
  if (!db || !identityKey) {
    return false;
  }

  const nowMs = Date.now();
  return db
    .prepare(UPDATE_OPERATION_SELECT_BY_IDENTITY_SQL)
    .all(identityKey)
    .map(rowToOperation)
    .map((operation) => getFreshActiveOperation(operation, nowMs))
    .filter((op): op is ActiveUpdateOperation => Boolean(op))
    .some((op) => op.id !== excludeOperationId);
}

/**
 * Return the latest active (in-progress OR queued) operation for a container ID.
 */
export function getActiveOperationByContainerId(
  containerId: string,
): ActiveUpdateOperation | undefined {
  if (!db || !containerId) {
    return undefined;
  }

  const operationsById = new Map<string, ActiveUpdateOperation>();
  const nowMs = Date.now();

  for (const operation of db
    .prepare(UPDATE_OPERATION_SELECT_BY_CONTAINER_ID_SQL)
    .all(containerId)
    .map(rowToOperation)) {
    const fresh = getFreshActiveOperation(operation, nowMs);
    if (fresh) {
      operationsById.set(fresh.id, fresh);
    }
  }

  for (const operation of db
    .prepare(UPDATE_OPERATION_SELECT_BY_NEW_CONTAINER_ID_SQL)
    .all(containerId)
    .map(rowToOperation)) {
    const fresh = getFreshActiveOperation(operation, nowMs);
    if (fresh) {
      operationsById.set(fresh.id, fresh);
    }
  }

  const operations = [...operationsById.values()].sort(
    (a, b) => getOperationTimestamp(b) - getOperationTimestamp(a),
  );

  return operations.at(0);
}

export function listActiveOperations(): ActiveUpdateOperation[] {
  if (!db) {
    return [];
  }
  const database = db;

  const nowMs = Date.now();
  return ACTIVE_STATUSES.flatMap((status) => selectOperationsByStatus(database, status))
    .map((operation) => getFreshActiveOperation(operation, nowMs))
    .filter((item): item is ActiveUpdateOperation => Boolean(item))
    .sort((a, b) => getOperationTimestamp(b) - getOperationTimestamp(a));
}

/** Every operation for a container's durable identity key, newest first. */
export function getOperationsByContainerIdentity(
  identityKey: string | undefined,
): UpdateOperation[] {
  if (!db || !identityKey) {
    return [];
  }

  return db
    .prepare(UPDATE_OPERATION_SELECT_BY_IDENTITY_SQL)
    .all(identityKey)
    .map(rowToOperation)
    .sort((a, b) => getOperationTimestamp(b) - getOperationTimestamp(a));
}

/**
 * Return the most recent terminal `succeeded` operation for a container
 * identity that completed within the given `sinceMs` window (milliseconds
 * before now).
 *
 * Used by the duplicate-update dedup logic (issue #410) to distinguish between
 * a genuine execution failure and a stale-container 404/409 that arrived after
 * Docker Compose or an agent already recreated the container successfully.
 */
export function getRecentTerminalSucceededOperationByContainerIdentity(
  identityKey: string | undefined,
  sinceMs: number,
): SucceededUpdateOperation | undefined {
  if (!db || !identityKey) {
    return undefined;
  }

  const cutoffMs = Date.now() - sinceMs;

  const candidates = db
    .prepare(UPDATE_OPERATION_SELECT_BY_IDENTITY_STATUS_SQL)
    .all(identityKey, 'succeeded')
    .map(rowToOperation)
    .filter(
      (op): op is SucceededUpdateOperation =>
        op.status === 'succeeded' &&
        typeof op.completedAt === 'string' &&
        Date.parse(op.completedAt) >= cutoffMs,
    )
    .sort((a, b) => getOperationTimestamp(b) - getOperationTimestamp(a));

  return candidates.at(0);
}

/**
 * Return all `succeeded` operations whose `completedAt` falls within
 * `Date.now() - sinceMs` (milliseconds), sorted most-recent-first.
 *
 * Used by the restart-amnesia guard in Trigger.ts to re-populate
 * `recentlyAppliedContainerKeys` on controller startup so that a successful
 * update whose watcher confirmation scan has not yet run does not fire a
 * spurious "update available" notification after a restart (#408).
 *
 * Returns an empty array when the collection is uninitialized.
 */
export function listRecentSucceededOperations(sinceMs: number): SucceededUpdateOperation[] {
  if (!db) {
    return [];
  }
  const database = db;

  const cutoffMs = Date.now() - sinceMs;

  return selectOperationsByStatus(database, 'succeeded')
    .filter(
      (op): op is SucceededUpdateOperation =>
        op.status === 'succeeded' &&
        typeof op.completedAt === 'string' &&
        Date.parse(op.completedAt) >= cutoffMs,
    )
    .sort((a, b) => getOperationTimestamp(b) - getOperationTimestamp(a));
}

/**
 * Return all operations for a container ID (matches both containerId and newContainerId),
 * deduped by operation id, sorted by timestamp descending.
 */
export function getOperationsByContainerId(containerId: string): UpdateOperation[] {
  if (!db || !containerId) {
    return [];
  }

  const operationsById = new Map<string, UpdateOperation>();

  for (const operation of db
    .prepare(UPDATE_OPERATION_SELECT_BY_CONTAINER_ID_SQL)
    .all(containerId)
    .map(rowToOperation)) {
    operationsById.set(operation.id, operation);
  }

  for (const operation of db
    .prepare(UPDATE_OPERATION_SELECT_BY_NEW_CONTAINER_ID_SQL)
    .all(containerId)
    .map(rowToOperation)) {
    operationsById.set(operation.id, operation);
  }

  return [...operationsById.values()].sort(
    (a, b) => getOperationTimestamp(b) - getOperationTimestamp(a),
  );
}

export function cancelQueuedOperation(id: string): UpdateOperation | undefined {
  if (!db) {
    return undefined;
  }
  const existing = getOperationById(id);
  if (!existing || existing.status !== 'queued') {
    return undefined;
  }
  return markOperationTerminal(id, {
    status: 'failed',
    phase: 'failed',
    lastError: 'Cancelled by operator',
  });
}

/**
 * Thrown by the lifecycle when it observes an operator-requested cancellation
 * at a safe checkpoint. The standard rollback path treats this like any other
 * runtime failure but tags the rollback reason as `cancelled`.
 */
export class OperationCancelledError extends Error {
  readonly operationId: string;

  constructor(operationId: string) {
    super('Cancelled by operator');
    this.name = 'OperationCancelledError';
    this.operationId = operationId;
  }
}

export function isOperationCancelledError(error: unknown): error is OperationCancelledError {
  return error instanceof OperationCancelledError;
}

/**
 * Outcome of a mid-flight cancellation request.
 * - `'cancelled'`: queued operation was cancelled immediately.
 * - `'cancel-requested'`: in-progress operation was flagged; the lifecycle will
 *   abort at the next safe checkpoint and roll back if it has crossed the
 *   point of no return.
 * - `undefined`: the operation does not exist or is already terminal.
 */
export function requestOperationCancellation(
  id: string,
): { outcome: 'cancelled' | 'cancel-requested'; operation: UpdateOperation } | undefined {
  if (!db) {
    return undefined;
  }
  const existing = getOperationById(id);
  if (!existing) {
    return undefined;
  }
  if (existing.status === 'queued') {
    const cancelled = markOperationTerminal(id, {
      status: 'failed',
      phase: 'failed',
      lastError: 'Cancelled by operator',
    });
    return cancelled ? { outcome: 'cancelled', operation: cancelled } : undefined;
  }
  if (existing.status === 'in-progress') {
    const flagged = persistOperationPatch(id, { cancelRequested: true });
    return flagged ? { outcome: 'cancel-requested', operation: flagged } : undefined;
  }
  return undefined;
}

/**
 * Re-read the operation row and return whether a mid-flight cancellation has
 * been requested. Lifecycle code calls this at safe checkpoints to decide
 * whether to abort.
 */
export function isOperationCancelRequested(id: string | undefined): boolean {
  if (!id) {
    return false;
  }
  const operation = getOperationById(id);
  return Boolean(operation?.cancelRequested);
}

/**
 * Strip internal-only fields (`container` snapshot, `finalizeSecretHash`, and
 * the Portainer recovery descriptor) from
 * an operation row before returning it from the REST API. The container snapshot
 * is persisted so terminal lifecycle events can carry the container even after a
 * recreate; it MUST NOT be exposed to API consumers (it may contain secrets in
 * details.env / labels). The finalizeSecretHash is a per-operation secret hash
 * used by the finalize endpoint and must never be exposed.
 */
export function toApiUpdateOperation<
  T extends { container?: unknown; finalizeSecretHash?: unknown; portainerRecovery?: unknown },
>(op: T): Omit<T, 'container' | 'finalizeSecretHash' | 'portainerRecovery'> {
  const {
    container: _container,
    finalizeSecretHash: _finalizeSecretHash,
    portainerRecovery: _portainerRecovery,
    ...rest
  } = op;
  return rest;
}
