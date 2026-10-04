/**
 * Group policy store (spec 7.3).
 *
 * Backed by the `group_policies` table (schema migration 7): one row per exact group name,
 * with the update-policy and action bodies as JSON. The rows are few and every container
 * write reads one, so they are held in a Map keyed by group name and refreshed on each
 * write. `transaction` reloads the Map whenever a transaction rolls back, so a write made
 * inside one that fails never leaves the cache ahead of the table.
 *
 * Writes never re-resolve member containers. A caller commits its policy change (and its
 * audit row, through `transaction`) first, then calls
 * `reResolveGroupPolicyMembers` in `app/store/container.ts`.
 */
import { randomUUID } from 'node:crypto';
import type { Container } from '../model/container.js';
import { getContainerGroup } from '../model/container-group.js';
import {
  type GroupPolicy,
  GroupPolicyValidationError,
  isValidGroupPolicyName,
  normalizeGroupPolicyBody,
  toContainerGroupPolicySnapshot,
} from '../model/group-policy.js';
import type { Database, Row } from './db/driver.js';

let db: Database | undefined;
let policiesByGroup = new Map<string, GroupPolicy>();

/** A write's policy body. Validated and normalized here, so the API passes it through. */
export interface GroupPolicyWriteInput {
  updatePolicy?: unknown;
  actions?: unknown;
}

function requireDatabase(): Database {
  if (!db) {
    throw new Error('group policies collection not initialized');
  }
  return db;
}

function rowToGroupPolicy(row: Row): GroupPolicy {
  return {
    id: String(row.id),
    group: String(row.group_name),
    revision: Number(row.revision),
    updatePolicy: JSON.parse(String(row.update_policy)),
    actions: JSON.parse(String(row.actions)),
    createdAt: String(row.created_at),
    createdBy: String(row.created_by),
    updatedAt: String(row.updated_at),
    updatedBy: String(row.updated_by),
  };
}

function loadCache(database: Database): void {
  policiesByGroup = new Map(
    database
      .prepare('SELECT * FROM group_policies')
      .all()
      .map((row) => {
        const policy = rowToGroupPolicy(row);
        return [policy.group, policy] as const;
      }),
  );
}

/**
 * Wire the group policy store to the shared SQLite database and load every policy.
 * @param database
 */
export function createCollections(database: Database): void {
  db = database;
  loadCache(database);
}

/** Every policy, ordered by group name. */
export function getGroupPolicies(): GroupPolicy[] {
  return [...policiesByGroup.values()]
    .sort((first, second) => (first.group < second.group ? -1 : 1))
    .map((policy) => structuredClone(policy));
}

export function getGroupPolicyById(id: string): GroupPolicy | undefined {
  for (const policy of policiesByGroup.values()) {
    if (policy.id === id) {
      return structuredClone(policy);
    }
  }
  return undefined;
}

/** The policy for exactly this group name: no trimming, no case folding. */
export function getGroupPolicyForGroup(group: string): GroupPolicy | undefined {
  const policy = policiesByGroup.get(group);
  return policy === undefined ? undefined : structuredClone(policy);
}

/**
 * The container as the group's policy stands now. A container's `groupPolicy` is the
 * snapshot its last store write recorded, and a report holds that write until the batch
 * emit, so a policy saved in between would otherwise reach every gate that reads the
 * snapshot only on the next scan. The global update mode is read live at each gate and the
 * group rule has to be too. Returns `container` itself when its snapshot is current, and
 * otherwise a shallow copy carrying the current snapshot (or none), never the shared object
 * mutated.
 * @param container
 */
export function withCurrentGroupPolicy<T extends Pick<Container, 'labels' | 'groupPolicy'>>(
  container: T,
): T {
  // Without a labels map there is no group to derive, so the snapshot is left as recorded.
  if (container.labels === undefined) {
    return container;
  }
  const group = getContainerGroup(container);
  const policy = group === null ? undefined : policiesByGroup.get(group);
  const snapshot = container.groupPolicy;
  const current =
    policy === undefined
      ? snapshot === undefined
      : snapshot?.id === policy.id && snapshot.revision === policy.revision;
  if (current) {
    return container;
  }
  const { groupPolicy: _stale, ...rest } = container;
  return (
    policy === undefined ? rest : { ...rest, groupPolicy: toContainerGroupPolicySnapshot(policy) }
  ) as T;
}

/**
 * Create the policy for `group` at revision 1. A second policy for the same group fails on
 * the table's UNIQUE constraint (`StoreConstraintError`, `SQLITE_CONSTRAINT_UNIQUE`).
 * @param group exact group name
 * @param input
 * @param principal `user:<name>` or `api-key:<keyId>`
 */
export function insertGroupPolicy(
  group: string,
  input: GroupPolicyWriteInput,
  principal: string,
): GroupPolicy {
  const database = requireDatabase();
  if (!isValidGroupPolicyName(group)) {
    throw new GroupPolicyValidationError('A group name must be a non-empty string');
  }
  const body = normalizeGroupPolicyBody(input);
  const now = new Date().toISOString();
  const row = database
    .prepare(
      `INSERT INTO group_policies
         (id, group_name, revision, update_policy, actions, created_at, created_by, updated_at, updated_by)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
    )
    .get(
      randomUUID(),
      group,
      JSON.stringify(body.updatePolicy),
      JSON.stringify(body.actions),
      now,
      principal,
      now,
      principal,
    ) as Row;
  const policy = rowToGroupPolicy(row);
  policiesByGroup.set(policy.group, policy);
  return structuredClone(policy);
}

/**
 * Compare-and-set replace of both bodies. Returns `undefined`, and writes nothing, when no
 * policy with this id is at `expectedRevision`: the policy is missing or the caller's copy
 * is stale.
 */
export function replaceGroupPolicy(
  id: string,
  expectedRevision: number,
  input: GroupPolicyWriteInput,
  principal: string,
): GroupPolicy | undefined {
  const database = requireDatabase();
  const body = normalizeGroupPolicyBody(input);
  const row = database
    .prepare(
      `UPDATE group_policies
         SET revision = revision + 1, update_policy = ?, actions = ?, updated_at = ?, updated_by = ?
       WHERE id = ? AND revision = ?
       RETURNING *`,
    )
    .get(
      JSON.stringify(body.updatePolicy),
      JSON.stringify(body.actions),
      new Date().toISOString(),
      principal,
      id,
      expectedRevision,
    );
  if (row === undefined) {
    return undefined;
  }
  const policy = rowToGroupPolicy(row);
  policiesByGroup.set(policy.group, policy);
  return structuredClone(policy);
}

/**
 * Compare-and-set delete. Returns the deleted policy, or `undefined` when no policy with
 * this id is at `expectedRevision`.
 */
export function deleteGroupPolicy(id: string, expectedRevision: number): GroupPolicy | undefined {
  const row = requireDatabase()
    .prepare('DELETE FROM group_policies WHERE id = ? AND revision = ? RETURNING *')
    .get(id, expectedRevision);
  if (row === undefined) {
    return undefined;
  }
  const policy = rowToGroupPolicy(row);
  policiesByGroup.delete(policy.group);
  return policy;
}

/**
 * Run `run` in one transaction, so a policy write and its audit row commit together or not
 * at all. On a rollback the cache is reloaded from the table, which undoes any write the
 * transaction made to it.
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
  policiesByGroup = new Map();
}
