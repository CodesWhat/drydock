/**
 * Agent key registry store.
 * Tracks Ed25519 public keys that are authorized to connect via the lookout/1.0
 * WebSocket protocol. One document per key; active keys have revokedAt === null.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import logger from '../log/index.js';
import { initCollection } from './util.js';

const log = logger.child({ component: 'store.agent-keys' });

export interface AgentKeyRecord {
  keyId: string; // 16 lowercase hex chars — hex(SHA-256(raw 32-byte pubkey)[:8])
  pubkey: string; // base64-standard (44 chars)
  label: string; // human-readable name supplied by operator
  createdAt: string; // ISO-8601 UTC
  revokedAt: string | null; // ISO-8601 UTC or null when active
}

interface AgentKeyCollection {
  findOne(query: Record<string, unknown>): AgentKeyRecord | null;
  find(query?: Record<string, unknown>): AgentKeyRecord[];
  insert(document: AgentKeyRecord): void;
  update(document: AgentKeyRecord): void;
}

interface AgentKeyStoreDb {
  getCollection(name: string): AgentKeyCollection | null;
  addCollection(name: string, options?: Record<string, unknown>): AgentKeyCollection;
}

let agentKeyCollection: AgentKeyCollection | undefined;

/**
 * Derive the 16-char hex key ID from a raw 32-byte Ed25519 public key buffer.
 * Matches lookout's derivation: hex(SHA-256(raw32Bytes)[:8])
 */
function deriveKeyId(pubkeyBuffer: Buffer): string {
  return createHash('sha256').update(pubkeyBuffer).digest().subarray(0, 8).toString('hex');
}

/**
 * Create agent-keys collection.
 * @param db
 */
export function createCollections(db: AgentKeyStoreDb): void {
  agentKeyCollection = initCollection(db, 'agent-keys', {
    indices: ['keyId'],
  }) as AgentKeyCollection;
}

/**
 * Insert a new authorized key.
 * Throws if a non-revoked key with the same keyId already exists.
 * @param pubkeyBuffer - raw 32-byte Ed25519 public key
 * @param label - human-readable name
 * @returns the inserted record
 */
export function addKey(pubkeyBuffer: Buffer, label: string): AgentKeyRecord {
  if (!agentKeyCollection) {
    throw new Error('agent-keys collection not initialized');
  }

  // Defense-in-depth: enforce exactly 32 bytes here regardless of call site.
  // The REST route validates length before calling addKey, but programmatic callers
  // and future code paths must not be able to insert a malformed key that would
  // cause crypto.createPublicKey to throw during signature verification.
  if (pubkeyBuffer.length !== 32) {
    throw new Error(`Ed25519 public key must be exactly 32 bytes (got ${pubkeyBuffer.length})`);
  }

  const keyId = deriveKeyId(pubkeyBuffer);
  const existing = agentKeyCollection.findOne({ keyId, revokedAt: null });
  if (existing) {
    throw new Error(`Key ${keyId} is already active`);
  }

  const record: AgentKeyRecord = {
    keyId,
    pubkey: pubkeyBuffer.toString('base64'),
    label,
    createdAt: new Date().toISOString(),
    revokedAt: null,
  };

  agentKeyCollection.insert(record);
  log.info(`Added agent key ${keyId} (${label})`);
  return record;
}

/**
 * Look up an active (non-revoked) key by keyId.
 * Returns null if not found or revoked.
 * @param keyId - 16-char hex key ID
 */
export function getKey(keyId: string): AgentKeyRecord | null {
  if (!agentKeyCollection) {
    return null;
  }
  const record = agentKeyCollection.findOne({ keyId });
  if (!record || record.revokedAt !== null) {
    return null;
  }
  return record;
}

/**
 * Revoke a key by keyId.
 * Returns true if found and revoked, false if not found.
 * @param keyId - 16-char hex key ID
 */
export function revokeKey(keyId: string): boolean {
  if (!agentKeyCollection) {
    return false;
  }
  const record = agentKeyCollection.findOne({ keyId, revokedAt: null });
  if (!record) {
    return false;
  }
  record.revokedAt = new Date().toISOString();
  agentKeyCollection.update(record);
  log.info(`Revoked agent key ${keyId}`);
  return true;
}

/**
 * List all keys (active and revoked).
 */
export function listKeys(): AgentKeyRecord[] {
  if (!agentKeyCollection) {
    return [];
  }
  return agentKeyCollection.find();
}

/**
 * Bootstrap agent keys from a file in the authorized_keys format:
 *   "ed25519 <base64std-raw-pubkey> [optional comment]"
 * Blank lines and # comments are skipped.
 * File must not be world-readable.
 * Idempotent: skips keys whose keyId is already active.
 * @param filePath - path to the authorized_keys file
 */
export function loadAuthorizedKeysFile(filePath: string): void {
  const stat = fs.statSync(filePath);
  /* v8 ignore next */
  if (stat.mode & 0o004) {
    throw new Error(
      `Authorized keys file ${filePath} is world-readable (mode ${(stat.mode & 0o777).toString(8)}). Fix permissions to 0600.`,
    );
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  let loaded = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2 || parts[0] !== 'ed25519') {
      log.warn(`Skipping unrecognized line in authorized_keys: ${trimmed.substring(0, 80)}`);
      continue;
    }
    const pubkeyBase64 = parts[1];
    const comment = parts.slice(2).join(' ') || 'imported';

    let pubkeyBuffer: Buffer;
    try {
      pubkeyBuffer = Buffer.from(pubkeyBase64, 'base64');
      /* v8 ignore start */
    } catch {
      log.warn(`Skipping invalid base64 in authorized_keys: ${pubkeyBase64.substring(0, 44)}`);
      continue;
    }
    /* v8 ignore stop */

    if (pubkeyBuffer.length !== 32) {
      log.warn(`Skipping key with wrong length (${pubkeyBuffer.length} bytes, expected 32)`);
      continue;
    }

    const keyId = deriveKeyId(pubkeyBuffer);
    if (getKey(keyId)) {
      log.debug(`Key ${keyId} already active, skipping`);
      continue;
    }

    try {
      addKey(pubkeyBuffer, comment);
      loaded += 1;
    } catch (error: unknown) {
      log.warn(`Failed to add key ${keyId}: ${String(error)}`);
    }
  }

  log.info(`Loaded ${loaded} key(s) from ${filePath}`);
}
