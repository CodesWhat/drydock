/**
 * Label override store (spec 7.5).
 *
 * Backed by the `container_label_overrides` table (schema migration 9): one durable row
 * per container identity. Every container write looks its scope up, so the rows are held
 * in a Map keyed by scope key and refreshed on each write. `transaction` reloads the Map
 * whenever a transaction rolls back, so a write made inside one that fails never leaves
 * the cache ahead of the table.
 *
 * Nothing here expires and nothing here rewrites a container. `mutateLabelOverrides` in
 * `app/store/container.ts` wraps these writes with the rewrite of every affected container
 * row in one transaction.
 */
import { randomUUID } from 'node:crypto';
import logger from '../log/index.js';
import {
  type Container,
  deriveContainerIdentityKey,
  getCanonicalContainerName,
  getComposeProjectService,
} from '../model/container.js';
import {
  getLabelOwnedFieldSpec,
  type InvalidLabelOverrideField,
  type LabelOverrideEntry,
  type LabelOverrideFields,
  type LabelOverrideValue,
  parseLabelOverrideFields,
} from '../model/label-owned.js';
import type { Database, Row } from './db/driver.js';

const log = logger.child({ component: 'store.label-override' });

export type LabelOverrideScopeKind = 'container' | 'compose-service';

/** What identifies a container for overrides: the same key the retention stash uses. */
export interface LabelOverrideScope {
  key: string;
  agent: string;
  watcher: string;
  kind: LabelOverrideScopeKind;
  /** The canonical container name, or `project/service` for a Compose service. */
  name: string;
}

export interface LabelOverrideRecord {
  id: string;
  scopeKey: string;
  agent: string;
  watcher: string;
  scopeKind: LabelOverrideScopeKind;
  scopeName: string;
  fields: LabelOverrideFields;
  /** Stored fields that could not be read. They are ignored, and dropped by the next write. */
  invalid: InvalidLabelOverrideField[];
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export type LabelOverrideChange =
  | { field: string; op: 'set'; value: unknown }
  | { field: string; op: 'remove' };

/** A change that named an unknown field or carried a value of the wrong shape. */
export class LabelOverrideValidationError extends Error {
  constructor(
    public readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = 'LabelOverrideValidationError';
  }
}

let db: Database | undefined;
let overridesByScope = new Map<string, LabelOverrideRecord>();

function requireDatabase(): Database {
  if (!db) {
    throw new Error('label overrides collection not initialized');
  }
  return db;
}

function rowToRecord(row: Row): LabelOverrideRecord {
  const { fields, invalid } = parseLabelOverrideFields(row.fields);
  const record: LabelOverrideRecord = {
    id: String(row.id),
    scopeKey: String(row.scope_key),
    agent: String(row.agent),
    watcher: String(row.watcher),
    scopeKind: String(row.scope_kind) as LabelOverrideScopeKind,
    scopeName: String(row.scope_name),
    fields,
    invalid,
    revision: Number(row.revision),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
  return record;
}

function loadCache(database: Database): void {
  overridesByScope = new Map(
    database
      .prepare('SELECT * FROM container_label_overrides')
      .all()
      .map((row) => {
        const record = rowToRecord(row);
        if (record.invalid.length > 0) {
          log.warn(
            `Ignoring unreadable label override field(s) ${record.invalid
              .map((entry) => entry.field)
              .join(', ')} for ${record.scopeKey}`,
          );
        }
        return [record.scopeKey, record] as const;
      }),
  );
}

/**
 * Wire the label override store to the shared SQLite database and load every row.
 * @param database
 */
export function createCollections(database: Database): void {
  db = database;
  loadCache(database);
}

/**
 * The override scope of a container: its identity key over the canonical name, so a
 * rollback-renamed record shares its original's scope and every replica of a Compose
 * service shares one. `undefined` when the container has no watcher or name.
 */
export function deriveLabelOverrideScope(
  container: Pick<Container, 'name' | 'watcher' | 'agent' | 'labels'>,
): LabelOverrideScope | undefined {
  if (typeof container.name !== 'string') {
    return undefined;
  }
  const name = getCanonicalContainerName(container.name);
  const key = deriveContainerIdentityKey({ ...container, name } as Container);
  if (key === undefined) {
    return undefined;
  }
  const compose = getComposeProjectService(container);
  return {
    key,
    agent: typeof container.agent === 'string' ? container.agent : '',
    watcher: container.watcher,
    kind: compose ? 'compose-service' : 'container',
    name: compose ? `${compose.project}/${compose.service}` : name,
  };
}

/** The readable override fields for a scope key, or `undefined` when it has no row. */
export function getLabelOverrideFields(scopeKey: string): LabelOverrideFields | undefined {
  return overridesByScope.get(scopeKey)?.fields;
}

export function getLabelOverrideForScope(scopeKey: string): LabelOverrideRecord | undefined {
  const record = overridesByScope.get(scopeKey);
  return record === undefined ? undefined : structuredClone(record);
}

export function getLabelOverrideById(id: string): LabelOverrideRecord | undefined {
  for (const record of overridesByScope.values()) {
    if (record.id === id) {
      return structuredClone(record);
    }
  }
  return undefined;
}

/** Every row, orphans included, ordered by scope key. */
export function getLabelOverrides(): LabelOverrideRecord[] {
  return [...overridesByScope.values()]
    .sort((first, second) => (first.scopeKey < second.scopeKey ? -1 : 1))
    .map((record) => structuredClone(record));
}

/** Validate one value's shape for its field. Grammar and reference checks are the API's. */
function normalizeValue(field: string, value: unknown): LabelOverrideValue {
  const spec = getLabelOwnedFieldSpec(field);
  if (spec === undefined) {
    throw new LabelOverrideValidationError(field, `Unknown label-owned field ${field}`);
  }
  const { fields } = parseLabelOverrideFields({
    [spec.field]: { value, updatedAt: '', updatedBy: '' },
  });
  const entry = fields[spec.field];
  if (entry === undefined) {
    throw new LabelOverrideValidationError(field, `Invalid value for ${field}`);
  }
  return entry.value;
}

export interface LabelOverrideWriteResult {
  /** The row after the write, or `undefined` when the write left the scope with none. */
  record: LabelOverrideRecord | undefined;
  /** False when `expectedRevision` did not match: nothing was written. */
  applied: boolean;
}

/**
 * Compare-and-set a batch of set/remove changes on one scope's row, creating the row on
 * the first set and deleting it when its last field is removed. Each field appears at most
 * once. `expectedRevision` of 0 means "no row yet". Never touches a container.
 * @param scope
 * @param changes
 * @param principal `user:<name>` or `api-key:<keyId>`
 * @param expectedRevision when given, the write applies only against this revision
 */
export function writeLabelOverrideChanges(
  scope: LabelOverrideScope,
  changes: readonly LabelOverrideChange[],
  principal: string,
  expectedRevision?: number,
): LabelOverrideWriteResult {
  const database = requireDatabase();
  const existing = overridesByScope.get(scope.key);
  if (expectedRevision !== undefined && (existing?.revision ?? 0) !== expectedRevision) {
    return {
      record: existing === undefined ? undefined : structuredClone(existing),
      applied: false,
    };
  }
  const now = new Date().toISOString();
  const fields = new Map<string, LabelOverrideEntry>(Object.entries(existing?.fields ?? {}));
  const seen = new Set<string>();
  for (const change of changes) {
    if (seen.has(change.field)) {
      throw new LabelOverrideValidationError(change.field, `Duplicate change for ${change.field}`);
    }
    seen.add(change.field);
    if (change.op === 'set') {
      fields.set(change.field, {
        value: normalizeValue(change.field, change.value),
        updatedAt: now,
        updatedBy: principal,
      });
    } else if (getLabelOwnedFieldSpec(change.field) === undefined) {
      throw new LabelOverrideValidationError(
        change.field,
        `Unknown label-owned field ${change.field}`,
      );
    } else {
      fields.delete(change.field);
    }
  }

  if (fields.size === 0) {
    if (existing !== undefined) {
      database.prepare('DELETE FROM container_label_overrides WHERE id = ?').run(existing.id);
      overridesByScope.delete(scope.key);
    }
    return { record: undefined, applied: true };
  }

  const serialized = JSON.stringify(Object.fromEntries(fields));
  const row =
    existing === undefined
      ? database
          .prepare(
            `INSERT INTO container_label_overrides
               (id, scope_key, agent, watcher, scope_kind, scope_name, fields, revision, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
             RETURNING *`,
          )
          .get(
            randomUUID(),
            scope.key,
            scope.agent,
            scope.watcher,
            scope.kind,
            scope.name,
            serialized,
            now,
            now,
          )
      : database
          .prepare(
            `UPDATE container_label_overrides
               SET fields = ?, revision = revision + 1, updated_at = ?
             WHERE id = ?
             RETURNING *`,
          )
          .get(serialized, now, existing.id);
  const record = rowToRecord(row as Row);
  overridesByScope.set(record.scopeKey, record);
  return { record: structuredClone(record), applied: true };
}

/**
 * Compare-and-set delete of a whole row, orphans included. Returns the deleted row, or
 * `undefined` when no row with this id is at `expectedRevision`.
 */
export function deleteLabelOverrideRow(
  id: string,
  expectedRevision: number,
): LabelOverrideRecord | undefined {
  const row = requireDatabase()
    .prepare('DELETE FROM container_label_overrides WHERE id = ? AND revision = ? RETURNING *')
    .get(id, expectedRevision);
  if (row === undefined) {
    return undefined;
  }
  const record = rowToRecord(row);
  overridesByScope.delete(record.scopeKey);
  return record;
}

/**
 * Run `run` in one transaction. On a rollback the cache is reloaded from the table, which
 * undoes any write the transaction made to it.
 */
export function transaction<T>(run: () => T): T {
  const database = requireDatabase();
  try {
    return database.transaction(run);
  } catch (error: unknown) {
    loadCache(database);
    throw error;
  }
}

/** Exposed for tests to reset module state between cases. */
export function clearCollectionForTesting(): void {
  db = undefined;
  overridesByScope = new Map();
}
