/**
 * API key store.
 *
 * Backed by the `api_keys` table (roadmap 7-STORE, slice 4). Every field is a
 * scalar column with an obvious type, with one exception: `scopes` is a
 * `string[]` on the public record but lives as rows in the `api_key_scope(key_id,
 * scope)` join table, ordered by insertion (`rowid`) so a projected record's
 * `scopes` array comes back in the same order it was created with. That split
 * is what makes "which keys hold admin" a query rather than a scan.
 *
 * The credential is `ddk_<keyId>_<secret>`: `ddk_` is a fixed, greppable prefix
 * for secret scanners, `keyId` is 12 lowercase hex characters and is the
 * non-secret indexed lookup key, and `secret` is 32 random bytes encoded
 * base64url. Only `base64(sha256(secret))` is persisted, so the full credential
 * exists exactly once, in the return value of createApiKey().
 *
 * SHA-256 rather than argon2id (which Basic.ts uses for operator passwords) is
 * deliberate: argon2 exists to make offline brute force of low-entropy human
 * passwords expensive, and a 256-bit random secret is not brute-forceable at
 * any hash speed. A slow KDF would buy nothing and cap key-authenticated
 * traffic at roughly 10-20 rps per core, which is below what the polling
 * integrations this feature exists for need. This matches what
 * authenticateMetricsToken and the webhook bearer path already do.
 */
import crypto from 'node:crypto';
import logger from '../log/index.js';
import { daysToMs } from '../model/maturity-policy.js';
import type { Database, Row } from './db/driver.js';

const log = logger.child({ component: 'store.api-key' });

/** Fixed credential prefix. Nothing else in the codebase uses it. */
export const API_KEY_PREFIX = 'ddk_';
/** 6 random bytes rendered as 12 lowercase hex characters. */
export const API_KEY_ID_BYTES = 6;
/** 32 random bytes rendered as 43 base64url characters. */
export const API_KEY_SECRET_BYTES = 32;
export const API_KEY_NAME_MAX_LENGTH = 64;
export const API_KEY_SCHEMA_VERSION = 1;
/** The shape a well-formed credential must have, and the .gitleaks.toml rule. */
export const API_KEY_PATTERN = /^ddk_([0-9a-f]{12})_([A-Za-z0-9_-]{43})$/;
/**
 * Throttles per-key `lastUsedAt` writes so a fast-polling integration does not
 * turn every request into a store mutation: one write per key per minute, the
 * rest held in memory and flushed by the timer below.
 */
export const API_KEY_LAST_USED_THROTTLE_MS = 60 * 1000;
/** Revoked rows stay for the audit trail, then go. */
export const API_KEY_REVOKED_RETENTION_DAYS = 90;

const API_KEY_ID_ATTEMPTS = 5;
const API_KEY_PRUNE_INSERT_INTERVAL = 100;
const API_KEY_PRUNE_TIMER_INTERVAL_MS = 60 * 60 * 1000;
const API_KEY_USAGE_FLUSH_TIMER_INTERVAL_MS = API_KEY_LAST_USED_THROTTLE_MS;

export interface ApiKeyRecord {
  schemaVersion: number;
  /** 12 lowercase hex — primary key, indexed, safe to log and to show in the UI. */
  keyId: string;
  name: string;
  /** base64(sha256(secret)). Never the secret itself. */
  secretHash: string;
  scopes: string[];
  createdAt: string;
  /** `user:<username>` or `api-key:<parentKeyId>`. */
  createdBy: string;
  /** Set only when another key minted this one. Drives cascade revocation. */
  parentKeyId: string | null;
  expiresAt: string | null;
  rateLimitMax?: number;
  lastUsedAt: string | null;
  revokedAt: string | null;
  revokedBy?: string;
}

/**
 * Who is minting the key. A human session mints a root key with no parent; a
 * key minting another key records itself as the parent, which is what makes a
 * leaked automation key recoverable in one revoke instead of an audit-log
 * scavenger hunt.
 */
export type ApiKeyCreator = { kind: 'user'; username: string } | { kind: 'api-key'; keyId: string };

export interface CreateApiKeyInput {
  name: string;
  scopes: string[];
  createdBy: ApiKeyCreator;
  expiresAt?: string | null;
  rateLimitMax?: number;
  now?: Date;
}

export interface CreatedApiKey {
  record: ApiKeyRecord;
  /**
   * The full `ddk_…` credential. This is the only copy that will ever exist —
   * it is not stored, and no later call can reproduce it.
   */
  apiKey: string;
}

export interface ApiKeyRevocationResult {
  keyId: string;
  /** The root plus every descendant this call moved to revoked, in BFS order. */
  revokedKeyIds: string[];
}

/**
 * Thrown for input the caller can fix — a bad name, an empty scope list, an
 * expiry in the past, an unknown parent. The management API recognises this via
 * instanceof and answers 400, while any other failure is unexpected and must be
 * sanitized before it reaches a client.
 */
export class ApiKeyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiKeyValidationError';
  }
}

let db: Database | undefined;
let apiKeyInsertsSincePrune = 0;
let apiKeyPruneTimer: ReturnType<typeof setInterval> | undefined;
let apiKeyUsageFlushTimer: ReturnType<typeof setInterval> | undefined;

interface UsageBufferEntry {
  /** When lastUsedAt was last written through to the store. */
  lastWriteMs: number;
  /** A use seen since then, held in memory until the throttle boundary. */
  pendingAt?: string;
}

const apiKeyUsageBuffer = new Map<string, UsageBufferEntry>();

/**
 * Hash a secret the way the store holds it.
 * @param secret - the base64url secret half of a credential
 */
export function hashApiKeySecret(secret: string): string {
  return crypto.createHash('sha256').update(secret, 'utf8').digest('base64');
}

/**
 * Split a presented credential into its non-secret id and its secret.
 * Returns null for anything that is not exactly the `ddk_` shape, so a bearer
 * belonging to another scheme is never inspected further.
 * @param value - the raw credential
 */
export function parseApiKey(value: string): { keyId: string; secret: string } | null {
  const match = API_KEY_PATTERN.exec(value);
  if (!match) {
    return null;
  }
  return { keyId: match[1], secret: match[2] };
}

function requireDb(): Database {
  if (!db) {
    throw new Error('api-keys collection not initialized');
  }
  return db;
}

function fetchScopes(database: Database, keyId: string): string[] {
  return database
    .prepare('SELECT scope FROM api_key_scope WHERE key_id = ? ORDER BY rowid')
    .all(keyId)
    .map((row) => String(row.scope));
}

/**
 * Build the public record from a raw `api_keys` row plus its already-fetched
 * scopes. `lastUsedAt` reflects the in-memory buffer, so a read is never up to
 * a minute stale just because the throttle has not fired.
 */
function rowToRecord(row: Row, scopes: string[]): ApiKeyRecord {
  const keyId = String(row.key_id);
  const record: ApiKeyRecord = {
    schemaVersion: Number(row.schema_version),
    keyId,
    name: String(row.name),
    secretHash: String(row.secret_hash),
    scopes,
    createdAt: String(row.created_at),
    createdBy: String(row.created_by),
    parentKeyId: row.parent_key_id === null ? null : String(row.parent_key_id),
    expiresAt: row.expires_at === null ? null : String(row.expires_at),
    lastUsedAt:
      apiKeyUsageBuffer.get(keyId)?.pendingAt ??
      (row.last_used_at === null ? null : String(row.last_used_at)),
    revokedAt: row.revoked_at === null ? null : String(row.revoked_at),
  };
  if (row.rate_limit_max !== null && row.rate_limit_max !== undefined) {
    record.rateLimitMax = Number(row.rate_limit_max);
  }
  if (row.revoked_by !== null && row.revoked_by !== undefined) {
    record.revokedBy = String(row.revoked_by);
  }
  return record;
}

function findRecord(keyId: string): ApiKeyRecord | null {
  if (!db) {
    return null;
  }
  const database = db;
  const row = database.prepare('SELECT * FROM api_keys WHERE key_id = ?').get(keyId);
  if (!row) {
    return null;
  }
  return rowToRecord(row, fetchScopes(database, keyId));
}

function normalizeName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new ApiKeyValidationError('API key name must not be empty');
  }
  if (trimmed.length > API_KEY_NAME_MAX_LENGTH) {
    throw new ApiKeyValidationError(
      `API key name must be at most ${API_KEY_NAME_MAX_LENGTH} characters`,
    );
  }
  return trimmed;
}

/**
 * Shape validation only — deduplicated, order preserved. Which scope names are
 * legal is the API layer's business (it owns the scope registry); the store
 * stays a layer below that vocabulary.
 */
function normalizeScopes(scopes: string[]): string[] {
  if (!Array.isArray(scopes) || scopes.length === 0) {
    throw new ApiKeyValidationError('API key scopes must be a non-empty array');
  }
  const normalized: string[] = [];
  for (const scope of scopes) {
    const trimmed = scope.trim();
    if (trimmed.length === 0) {
      throw new ApiKeyValidationError('API key scopes must not contain empty entries');
    }
    if (!normalized.includes(trimmed)) {
      normalized.push(trimmed);
    }
  }
  return normalized;
}

function normalizeExpiresAt(expiresAt: string | null | undefined, now: Date): string | null {
  if (expiresAt === undefined || expiresAt === null) {
    return null;
  }
  const parsed = Date.parse(expiresAt);
  if (Number.isNaN(parsed)) {
    throw new ApiKeyValidationError('API key expiresAt must be an ISO-8601 timestamp');
  }
  if (parsed <= now.getTime()) {
    throw new ApiKeyValidationError('API key expiresAt must be in the future');
  }
  return new Date(parsed).toISOString();
}

function normalizeRateLimitMax(rateLimitMax: number | undefined): number | undefined {
  if (rateLimitMax === undefined) {
    return undefined;
  }
  if (!Number.isSafeInteger(rateLimitMax) || rateLimitMax < 1) {
    throw new ApiKeyValidationError('API key rateLimitMax must be a positive safe integer');
  }
  return rateLimitMax;
}

function resolveCreator(
  creator: ApiKeyCreator,
  database: Database,
): { createdBy: string; parentKeyId: string | null } {
  if (creator.kind === 'user') {
    const username = creator.username.trim();
    if (username.length === 0) {
      throw new ApiKeyValidationError('API key creator username must not be empty');
    }
    return { createdBy: `user:${username}`, parentKeyId: null };
  }
  const parentExists = database
    .prepare('SELECT 1 FROM api_keys WHERE key_id = ?')
    .get(creator.keyId);
  if (!parentExists) {
    throw new ApiKeyValidationError(`Parent API key ${creator.keyId} does not exist`);
  }
  return { createdBy: `api-key:${creator.keyId}`, parentKeyId: creator.keyId };
}

/**
 * 48 bits makes a collision astronomically unlikely, but a duplicate id would
 * break the lookup this whole scheme rests on, so it is checked rather than
 * assumed.
 */
function generateKeyId(database: Database): string {
  for (let attempt = 0; attempt < API_KEY_ID_ATTEMPTS; attempt += 1) {
    const keyId = crypto.randomBytes(API_KEY_ID_BYTES).toString('hex');
    if (!database.prepare('SELECT 1 FROM api_keys WHERE key_id = ?').get(keyId)) {
      return keyId;
    }
    log.warn({ keyId }, 'Generated API key id collided with an existing key, retrying');
  }
  throw new Error('Unable to generate a unique API key id');
}

function stopPeriodicPruneTimer(): void {
  if (apiKeyPruneTimer !== undefined) {
    clearInterval(apiKeyPruneTimer);
    apiKeyPruneTimer = undefined;
  }
}

function startPeriodicPruneTimer(): void {
  stopPeriodicPruneTimer();
  apiKeyPruneTimer = setInterval(() => {
    pruneRevokedApiKeys();
    apiKeyInsertsSincePrune = 0;
  }, API_KEY_PRUNE_TIMER_INTERVAL_MS);

  if (typeof (apiKeyPruneTimer as { unref?: () => void }).unref === 'function') {
    (apiKeyPruneTimer as { unref: () => void }).unref();
  }
}

function startPeriodicUsageFlushTimer(): void {
  if (apiKeyUsageFlushTimer !== undefined) {
    clearInterval(apiKeyUsageFlushTimer);
  }
  apiKeyUsageFlushTimer = setInterval(() => {
    flushApiKeyUsage();
  }, API_KEY_USAGE_FLUSH_TIMER_INTERVAL_MS);

  if (typeof (apiKeyUsageFlushTimer as { unref?: () => void }).unref === 'function') {
    (apiKeyUsageFlushTimer as { unref: () => void }).unref();
  }
}

/**
 * Wire the api-keys store to the shared SQLite database. Schema creation is
 * the migration runner's job; this only captures the handle and restarts the
 * housekeeping timers.
 * @param database
 */
export function createCollections(database: Database): void {
  db = database;
  apiKeyUsageBuffer.clear();
  apiKeyInsertsSincePrune = 0;
  pruneRevokedApiKeys();
  startPeriodicPruneTimer();
  startPeriodicUsageFlushTimer();
}

/**
 * Mint a key. The returned `apiKey` is the only copy of the credential that
 * will ever exist; the store keeps its digest and nothing else.
 * @param input
 */
export function createApiKey(input: CreateApiKeyInput): CreatedApiKey {
  const database = requireDb();
  const now = input.now ?? new Date();
  const name = normalizeName(input.name);
  const scopes = normalizeScopes(input.scopes);
  const expiresAt = normalizeExpiresAt(input.expiresAt, now);
  const rateLimitMax = normalizeRateLimitMax(input.rateLimitMax);
  const { createdBy, parentKeyId } = resolveCreator(input.createdBy, database);
  const keyId = generateKeyId(database);
  const secret = crypto.randomBytes(API_KEY_SECRET_BYTES).toString('base64url');
  const secretHash = hashApiKeySecret(secret);
  const createdAt = now.toISOString();

  database.transaction(() => {
    database
      .prepare(
        `INSERT INTO api_keys
           (key_id, schema_version, name, secret_hash, created_at, created_by, parent_key_id, expires_at, rate_limit_max, last_used_at, revoked_at, revoked_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`,
      )
      .run(
        keyId,
        API_KEY_SCHEMA_VERSION,
        name,
        secretHash,
        createdAt,
        createdBy,
        parentKeyId,
        expiresAt,
        rateLimitMax ?? null,
      );
    const insertScope = database.prepare('INSERT INTO api_key_scope (key_id, scope) VALUES (?, ?)');
    for (const scope of scopes) {
      insertScope.run(keyId, scope);
    }
  });

  apiKeyInsertsSincePrune += 1;
  if (apiKeyInsertsSincePrune >= API_KEY_PRUNE_INSERT_INTERVAL) {
    pruneRevokedApiKeys();
    apiKeyInsertsSincePrune = 0;
  }

  log.info({ keyId, name, scopes, parentKeyId }, 'Created API key');

  const record: ApiKeyRecord = {
    schemaVersion: API_KEY_SCHEMA_VERSION,
    keyId,
    name,
    secretHash,
    scopes,
    createdAt,
    createdBy,
    parentKeyId,
    expiresAt,
    lastUsedAt: null,
    revokedAt: null,
  };
  if (rateLimitMax !== undefined) {
    record.rateLimitMax = rateLimitMax;
  }
  return { record, apiKey: `${API_KEY_PREFIX}${keyId}_${secret}` };
}

/**
 * Every key, active and revoked, newest-first ordering left to the caller.
 * `lastUsedAt` reflects the in-memory buffer, so a list read is never up to a
 * minute stale just because the throttle has not fired.
 */
export function listApiKeys(): ApiKeyRecord[] {
  if (!db) {
    return [];
  }
  const database = db;
  const rows = database.prepare('SELECT * FROM api_keys').all();
  const scopesByKey = new Map<string, string[]>();
  for (const scopeRow of database
    .prepare('SELECT key_id, scope FROM api_key_scope ORDER BY rowid')
    .all()) {
    const keyId = String(scopeRow.key_id);
    const scope = String(scopeRow.scope);
    const existing = scopesByKey.get(keyId);
    if (existing) {
      existing.push(scope);
    } else {
      scopesByKey.set(keyId, [scope]);
    }
  }
  return rows.map((row) => rowToRecord(row, scopesByKey.get(String(row.key_id)) ?? []));
}

/**
 * Look a key up by its non-secret id.
 * @param keyId
 */
export function findApiKeyById(keyId: string): ApiKeyRecord | null {
  return findRecord(keyId);
}

/**
 * Whether a key is past its expiry. A record whose expiresAt cannot be parsed
 * counts as expired: a corrupted timestamp must fail closed.
 * @param record
 * @param now
 */
export function isApiKeyExpired(record: ApiKeyRecord, now: Date = new Date()): boolean {
  if (record.expiresAt === null) {
    return false;
  }
  const expiresAtMs = Date.parse(record.expiresAt);
  return Number.isNaN(expiresAtMs) || expiresAtMs <= now.getTime();
}

function secretMatchesDigest(secret: string, secretHash: string): boolean {
  const presentedDigest = crypto.createHash('sha256').update(secret, 'utf8').digest();
  const storedDigest = Buffer.from(secretHash, 'base64');
  if (storedDigest.length !== presentedDigest.length) {
    return false;
  }
  return crypto.timingSafeEqual(presentedDigest, storedDigest);
}

/**
 * Whether every key above this one is still live.
 *
 * Revocation cascades, so a live key under a revoked one should not exist. It
 * can: the cascade updates one row at a time inside a single transaction, but
 * the store file itself can be edited by an operator, so authentication
 * cannot simply trust that the cascade ran. Checking only the presented key
 * made authentication trust that the cascade finished, which is the same
 * shape of bug the revoke ceiling had when it checked one level instead of
 * the chain.
 *
 * Everything unresolvable fails closed — a missing ancestor and a chain that
 * loops both mean the ancestry cannot be established, and no record is not
 * permission to authenticate. A missing ancestor cannot happen to a legitimate
 * key: pruning only removes revoked records, and a revoked parent's children
 * are revoked in the same call, so they age out together.
 * @param record - the record the presented credential resolved to
 * @param now
 */
function hasLiveAncestry(record: ApiKeyRecord, now: Date): boolean {
  const visited = new Set<string>([record.keyId]);
  let ancestorId = record.parentKeyId;

  while (ancestorId !== null) {
    if (visited.has(ancestorId)) {
      return false;
    }
    const ancestor = findRecord(ancestorId);
    if (!ancestor || ancestor.revokedAt !== null || isApiKeyExpired(ancestor, now)) {
      return false;
    }
    visited.add(ancestorId);
    ancestorId = ancestor.parentKeyId;
  }

  return true;
}

/**
 * Resolve a presented credential to its record, or null.
 *
 * Every failure returns null and none of them is distinguishable from another:
 * malformed, unknown id, wrong secret, revoked, expired, and revoked anywhere
 * up the chain all look identical to the caller. The digest comparison runs
 * before the state checks so the work done is the same whatever state the
 * record is in, and so a caller without the secret learns nothing about the
 * chain above it.
 * @param presented - the raw `ddk_…` credential
 * @param options
 */
export function verifyApiKey(presented: string, options: { now?: Date } = {}): ApiKeyRecord | null {
  const parsed = parseApiKey(presented);
  if (!parsed) {
    return null;
  }
  const record = findRecord(parsed.keyId);
  if (!record) {
    return null;
  }
  if (!secretMatchesDigest(parsed.secret, record.secretHash)) {
    return null;
  }
  if (record.revokedAt !== null) {
    return null;
  }
  const now = options.now ?? new Date();
  if (isApiKeyExpired(record, now)) {
    return null;
  }
  if (!hasLiveAncestry(record, now)) {
    return null;
  }
  return record;
}

/**
 * Revoke a key and, transitively, everything it minted.
 *
 * Returns null when the id is unknown. Keys already revoked are left with their
 * original revokedAt and are not counted, but are still walked, so a partially
 * revoked subtree finishes revoking. The visited set is there because a
 * corrupted parentKeyId chain must not spin forever. Runs inside one
 * transaction so the cascade is all-or-nothing.
 *
 * Sibling order at each level is the same "most recently inserted first" order
 * the previous LokiJS binary-index lookup on `parentKeyId` happened to return;
 * a test pins it so a future change to this ordering is a deliberate one.
 * @param keyId
 * @param options
 */
export function revokeApiKey(
  keyId: string,
  options: { revokedBy: string; now?: Date },
): ApiKeyRevocationResult | null {
  if (!db) {
    return null;
  }
  const database = db;
  const rootRow = database
    .prepare('SELECT key_id, parent_key_id, revoked_at FROM api_keys WHERE key_id = ?')
    .get(keyId);
  if (!rootRow) {
    return null;
  }

  const revokedAt = (options.now ?? new Date()).toISOString();
  const revokedKeyIds: string[] = [];
  const visited = new Set<string>();
  const queue: Row[] = [rootRow];

  database.transaction(() => {
    const updateStatement = database.prepare(
      'UPDATE api_keys SET revoked_at = ?, revoked_by = ? WHERE key_id = ? AND revoked_at IS NULL',
    );
    const childrenStatement = database.prepare(
      'SELECT key_id, parent_key_id, revoked_at FROM api_keys WHERE parent_key_id = ? ORDER BY rowid DESC',
    );
    while (queue.length > 0) {
      const row = queue.shift() as Row;
      const rowKeyId = String(row.key_id);
      if (visited.has(rowKeyId)) {
        continue;
      }
      visited.add(rowKeyId);
      if (row.revoked_at === null) {
        updateStatement.run(revokedAt, options.revokedBy, rowKeyId);
        revokedKeyIds.push(rowKeyId);
      }
      queue.push(...childrenStatement.all(rowKeyId));
    }
  });

  log.info({ keyId, cascadeCount: revokedKeyIds.length }, 'Revoked API key');
  return { keyId, revokedKeyIds };
}

/**
 * Note that a key was just used.
 *
 * Returns true when the timestamp was written through to the store, false when
 * it was buffered. The first use of a key always writes; subsequent uses inside
 * the throttle window are held in memory and superseded by the next one.
 * @param keyId
 * @param now
 */
export function recordApiKeyUsage(keyId: string, now: Date = new Date()): boolean {
  if (!db) {
    return false;
  }
  const database = db;
  const exists = database.prepare('SELECT 1 FROM api_keys WHERE key_id = ?').get(keyId);
  if (!exists) {
    return false;
  }

  const nowMs = now.getTime();
  const usedAt = now.toISOString();
  const buffered = apiKeyUsageBuffer.get(keyId);
  if (buffered && nowMs - buffered.lastWriteMs < API_KEY_LAST_USED_THROTTLE_MS) {
    buffered.pendingAt = usedAt;
    return false;
  }

  database.prepare('UPDATE api_keys SET last_used_at = ? WHERE key_id = ?').run(usedAt, keyId);
  apiKeyUsageBuffer.set(keyId, { lastWriteMs: nowMs });
  return true;
}

/**
 * Write every buffered lastUsedAt through to the store and return how many
 * rows moved. Without this the most recent minute of usage would be lost on
 * restart, since the throttle only flushes when the next request arrives.
 * @param now
 */
export function flushApiKeyUsage(now: Date = new Date()): number {
  if (!db) {
    return 0;
  }
  const database = db;
  let flushed = 0;
  const updateStatement = database.prepare('UPDATE api_keys SET last_used_at = ? WHERE key_id = ?');
  for (const [keyId, buffered] of apiKeyUsageBuffer) {
    if (buffered.pendingAt === undefined) {
      continue;
    }
    const exists = database.prepare('SELECT 1 FROM api_keys WHERE key_id = ?').get(keyId);
    if (exists) {
      updateStatement.run(buffered.pendingAt, keyId);
      flushed += 1;
    }
    buffered.pendingAt = undefined;
    buffered.lastWriteMs = now.getTime();
  }
  return flushed;
}

/**
 * Drop revoked rows past the retention window and return how many went.
 * A row whose revokedAt cannot be parsed is kept rather than guessed at.
 * Deleting the row cascades to its `api_key_scope` rows via the foreign key.
 * @param options
 */
export function pruneRevokedApiKeys(options: { retentionDays?: number; now?: Date } = {}): number {
  if (!db) {
    return 0;
  }
  const database = db;
  const retentionDays = options.retentionDays ?? API_KEY_REVOKED_RETENTION_DAYS;
  const cutoffMs = (options.now ?? new Date()).getTime() - daysToMs(retentionDays);

  const staleRows = database
    .prepare('SELECT key_id, revoked_at FROM api_keys WHERE revoked_at IS NOT NULL')
    .all()
    .filter((row) => {
      const revokedAtMs = Date.parse(String(row.revoked_at));
      return !Number.isNaN(revokedAtMs) && revokedAtMs < cutoffMs;
    });

  if (staleRows.length === 0) {
    return 0;
  }

  const deleteStatement = database.prepare('DELETE FROM api_keys WHERE key_id = ?');
  for (const row of staleRows) {
    const staleKeyId = String(row.key_id);
    apiKeyUsageBuffer.delete(staleKeyId);
    deleteStatement.run(staleKeyId);
  }

  return staleRows.length;
}
