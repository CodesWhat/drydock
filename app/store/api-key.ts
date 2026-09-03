/**
 * API key store.
 *
 * One document per key in the `api-keys` collection. Records are flat — every
 * field is a scalar with an obvious column type — so the v1.8 SQLite migration
 * can move the collection across without reshaping it. `scopes` is the single
 * exception and becomes an `api_key_scope(key_id, scope)` join table at that
 * point, so "which keys hold admin" is a query rather than a scan.
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
import { initCollection } from './util.js';

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
 * LokiJS re-serialises the whole store file on save, so a 10-second-poll
 * integration writing lastUsedAt on every request would be 8,640 store
 * mutations per day per key. One write per key per minute; the rest is held in
 * memory.
 */
export const API_KEY_LAST_USED_THROTTLE_MS = 60 * 1000;
/** Revoked rows stay for the audit trail, then go. */
export const API_KEY_REVOKED_RETENTION_DAYS = 90;

const API_KEY_COLLECTION_NAME = 'api-keys';
const API_KEY_COLLECTION_INDICES = ['keyId', 'parentKeyId'];
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

interface ApiKeyCollection {
  findOne(query: Record<string, unknown>): ApiKeyRecord | null;
  find(query?: Record<string, unknown>): ApiKeyRecord[];
  insert(document: ApiKeyRecord): void;
  update(document: ApiKeyRecord): void;
  remove(document: ApiKeyRecord): void;
}

interface ApiKeyStoreDb {
  getCollection(name: string): ApiKeyCollection | null;
  addCollection(name: string, options?: Record<string, unknown>): ApiKeyCollection;
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

let apiKeyCollection: ApiKeyCollection | undefined;
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

function requireCollection(): ApiKeyCollection {
  if (!apiKeyCollection) {
    throw new Error('api-keys collection not initialized');
  }
  return apiKeyCollection;
}

function findRecord(keyId: string): ApiKeyRecord | null {
  if (!apiKeyCollection) {
    return null;
  }
  return apiKeyCollection.findOne({ keyId });
}

/**
 * Copy a stored document out of LokiJS. Callers never get a live document, so
 * they cannot mutate the store by accident, and the $loki/meta fields Loki adds
 * never leak into an API response.
 */
function projectRecord(record: ApiKeyRecord): ApiKeyRecord {
  const projected: ApiKeyRecord = {
    schemaVersion: record.schemaVersion,
    keyId: record.keyId,
    name: record.name,
    secretHash: record.secretHash,
    scopes: [...record.scopes],
    createdAt: record.createdAt,
    createdBy: record.createdBy,
    parentKeyId: record.parentKeyId,
    expiresAt: record.expiresAt,
    lastUsedAt: apiKeyUsageBuffer.get(record.keyId)?.pendingAt ?? record.lastUsedAt,
    revokedAt: record.revokedAt,
  };
  if (record.rateLimitMax !== undefined) {
    projected.rateLimitMax = record.rateLimitMax;
  }
  if (record.revokedBy !== undefined) {
    projected.revokedBy = record.revokedBy;
  }
  return projected;
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
  collection: ApiKeyCollection,
): { createdBy: string; parentKeyId: string | null } {
  if (creator.kind === 'user') {
    const username = creator.username.trim();
    if (username.length === 0) {
      throw new ApiKeyValidationError('API key creator username must not be empty');
    }
    return { createdBy: `user:${username}`, parentKeyId: null };
  }
  if (!collection.findOne({ keyId: creator.keyId })) {
    throw new ApiKeyValidationError(`Parent API key ${creator.keyId} does not exist`);
  }
  return { createdBy: `api-key:${creator.keyId}`, parentKeyId: creator.keyId };
}

/**
 * 48 bits makes a collision astronomically unlikely, but a duplicate id would
 * break the lookup this whole scheme rests on, so it is checked rather than
 * assumed.
 */
function generateKeyId(collection: ApiKeyCollection): string {
  for (let attempt = 0; attempt < API_KEY_ID_ATTEMPTS; attempt += 1) {
    const keyId = crypto.randomBytes(API_KEY_ID_BYTES).toString('hex');
    if (!collection.findOne({ keyId })) {
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
 * Create the api-keys collection.
 * @param db
 */
export function createCollections(db: ApiKeyStoreDb): void {
  apiKeyCollection = initCollection(db, API_KEY_COLLECTION_NAME, {
    indices: API_KEY_COLLECTION_INDICES,
  }) as ApiKeyCollection;
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
  const collection = requireCollection();
  const now = input.now ?? new Date();
  const name = normalizeName(input.name);
  const scopes = normalizeScopes(input.scopes);
  const expiresAt = normalizeExpiresAt(input.expiresAt, now);
  const rateLimitMax = normalizeRateLimitMax(input.rateLimitMax);
  const { createdBy, parentKeyId } = resolveCreator(input.createdBy, collection);
  const keyId = generateKeyId(collection);
  const secret = crypto.randomBytes(API_KEY_SECRET_BYTES).toString('base64url');

  const record: ApiKeyRecord = {
    schemaVersion: API_KEY_SCHEMA_VERSION,
    keyId,
    name,
    secretHash: hashApiKeySecret(secret),
    scopes,
    createdAt: now.toISOString(),
    createdBy,
    parentKeyId,
    expiresAt,
    lastUsedAt: null,
    revokedAt: null,
  };
  if (rateLimitMax !== undefined) {
    record.rateLimitMax = rateLimitMax;
  }
  collection.insert(record);

  apiKeyInsertsSincePrune += 1;
  if (apiKeyInsertsSincePrune >= API_KEY_PRUNE_INSERT_INTERVAL) {
    pruneRevokedApiKeys();
    apiKeyInsertsSincePrune = 0;
  }

  log.info({ keyId, name, scopes, parentKeyId }, 'Created API key');
  return { record: projectRecord(record), apiKey: `${API_KEY_PREFIX}${keyId}_${secret}` };
}

/**
 * Every key, active and revoked, newest-first ordering left to the caller.
 * `lastUsedAt` reflects the in-memory buffer, so a list read is never up to a
 * minute stale just because the throttle has not fired.
 */
export function listApiKeys(): ApiKeyRecord[] {
  if (!apiKeyCollection) {
    return [];
  }
  return apiKeyCollection.find().map((record) => projectRecord(record));
}

/**
 * Look a key up by its non-secret id.
 * @param keyId
 */
export function findApiKeyById(keyId: string): ApiKeyRecord | null {
  const record = findRecord(keyId);
  return record ? projectRecord(record) : null;
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
 * can: the cascade updates one record at a time and LokiJS persists
 * asynchronously, so a process killed part-way through leaves exactly that on
 * disk, and the store file is a JSON document an operator can edit. Checking
 * only the presented key made authentication trust that the cascade finished,
 * which is the same shape of bug the revoke ceiling had when it checked one
 * level instead of the chain.
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
  return projectRecord(record);
}

/**
 * Revoke a key and, transitively, everything it minted.
 *
 * Returns null when the id is unknown. Keys already revoked are left with their
 * original revokedAt and are not counted, but are still walked, so a partially
 * revoked subtree finishes revoking. The visited set is there because a
 * corrupted parentKeyId chain must not spin forever.
 * @param keyId
 * @param options
 */
export function revokeApiKey(
  keyId: string,
  options: { revokedBy: string; now?: Date },
): ApiKeyRevocationResult | null {
  const collection = apiKeyCollection;
  if (!collection) {
    return null;
  }
  const root = collection.findOne({ keyId });
  if (!root) {
    return null;
  }

  const revokedAt = (options.now ?? new Date()).toISOString();
  const revokedKeyIds: string[] = [];
  const visited = new Set<string>();
  const queue: ApiKeyRecord[] = [root];

  while (queue.length > 0) {
    const record = queue.shift() as ApiKeyRecord;
    if (visited.has(record.keyId)) {
      continue;
    }
    visited.add(record.keyId);
    if (record.revokedAt === null) {
      record.revokedAt = revokedAt;
      record.revokedBy = options.revokedBy;
      collection.update(record);
      revokedKeyIds.push(record.keyId);
    }
    queue.push(...collection.find({ parentKeyId: record.keyId }));
  }

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
  const collection = apiKeyCollection;
  if (!collection) {
    return false;
  }
  const record = collection.findOne({ keyId });
  if (!record) {
    return false;
  }

  const nowMs = now.getTime();
  const usedAt = now.toISOString();
  const buffered = apiKeyUsageBuffer.get(keyId);
  if (buffered && nowMs - buffered.lastWriteMs < API_KEY_LAST_USED_THROTTLE_MS) {
    buffered.pendingAt = usedAt;
    return false;
  }

  record.lastUsedAt = usedAt;
  collection.update(record);
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
  const collection = apiKeyCollection;
  if (!collection) {
    return 0;
  }
  let flushed = 0;
  for (const [keyId, buffered] of apiKeyUsageBuffer) {
    if (buffered.pendingAt === undefined) {
      continue;
    }
    const record = collection.findOne({ keyId });
    if (record) {
      record.lastUsedAt = buffered.pendingAt;
      collection.update(record);
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
 * @param options
 */
export function pruneRevokedApiKeys(options: { retentionDays?: number; now?: Date } = {}): number {
  const collection = apiKeyCollection;
  if (!collection) {
    return 0;
  }
  const retentionDays = options.retentionDays ?? API_KEY_REVOKED_RETENTION_DAYS;
  const cutoff = (options.now ?? new Date()).getTime() - daysToMs(retentionDays);

  const stale = collection.find().filter((record) => {
    if (record.revokedAt === null) {
      return false;
    }
    const revokedAtMs = Date.parse(record.revokedAt);
    return !Number.isNaN(revokedAtMs) && revokedAtMs < cutoff;
  });

  stale.forEach((record) => {
    apiKeyUsageBuffer.delete(record.keyId);
    collection.remove(record);
  });

  return stale.length;
}
