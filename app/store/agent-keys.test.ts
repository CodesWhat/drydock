/**
 * Tests for the agent-keys store.
 */
import { createHash, generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import { createMigratedMemoryDatabase } from '../test/sqlite-db.js';
import * as agentKeys from './agent-keys.js';
import type { Database } from './db/driver.js';

const { mockLogWarn, mockLogInfo, mockLogDebug } = vi.hoisted(() => ({
  mockLogWarn: vi.fn(),
  mockLogInfo: vi.fn(),
  mockLogDebug: vi.fn(),
}));

vi.mock('../log/index.js', () => ({
  default: {
    child: vi.fn(() => ({ info: mockLogInfo, warn: mockLogWarn, debug: mockLogDebug })),
  },
}));

// Generate a real Ed25519 keypair for golden tests
function generateEd25519RawPublicKey(): Buffer {
  const { publicKey } = generateKeyPairSync('ed25519');
  // Export as raw 32 bytes (DER SPKI minus the 12-byte header)
  const spkiDer = publicKey.export({ type: 'spki', format: 'der' });
  return spkiDer.subarray(12); // Ed25519 SPKI always has a 12-byte prefix
}

function _deriveKeyId(rawPubkey: Buffer): string {
  return createHash('sha256').update(rawPubkey).digest().subarray(0, 8).toString('hex');
}

let db: Database;

beforeEach(() => {
  vi.clearAllMocks();
  db = createMigratedMemoryDatabase();
});

afterEach(() => {
  db.close();
});

describe('createCollections', () => {
  test('wires the store to the given database', () => {
    agentKeys.createCollections(db);
    expect(agentKeys.listKeys()).toEqual([]);
  });
});

describe('addKey', () => {
  test('inserts a valid 32-byte key and returns a record', () => {
    agentKeys.createCollections(db);

    const rawKey = generateEd25519RawPublicKey();
    const record = agentKeys.addKey(rawKey, 'test-agent');

    expect(record.keyId).toMatch(/^[0-9a-f]{16}$/);
    expect(record.pubkey).toBe(rawKey.toString('base64'));
    expect(record.label).toBe('test-agent');
    expect(record.createdAt).toBeTruthy();
    expect(record.revokedAt).toBeNull();
    expect(agentKeys.getKey(record.keyId)).toEqual(record);
  });

  test('throws when adding a duplicate active key', () => {
    agentKeys.createCollections(db);

    const rawKey = generateEd25519RawPublicKey();
    agentKeys.addKey(rawKey, 'first');
    expect(() => agentKeys.addKey(rawKey, 'second')).toThrow(/already active/);
  });

  test('throws when collection is not initialized', async () => {
    vi.resetModules();
    const { addKey } = await import('./agent-keys.js');
    const rawKey = generateEd25519RawPublicKey();
    expect(() => addKey(rawKey, 'test')).toThrow(/not initialized/);
  });

  test('throws when pubkeyBuffer is shorter than 32 bytes', () => {
    agentKeys.createCollections(db);

    const shortKey = Buffer.alloc(16); // 16 bytes instead of 32
    expect(() => agentKeys.addKey(shortKey, 'short')).toThrow(/32 bytes/);
  });

  test('throws when pubkeyBuffer is longer than 32 bytes', () => {
    agentKeys.createCollections(db);

    const longKey = Buffer.alloc(64); // 64 bytes instead of 32
    expect(() => agentKeys.addKey(longKey, 'long')).toThrow(/32 bytes/);
  });
});

describe('getKey', () => {
  test('returns null for unknown keyId', () => {
    agentKeys.createCollections(db);

    expect(agentKeys.getKey('deadbeefdeadbeef')).toBeNull();
  });

  test('returns the record for an active key', () => {
    agentKeys.createCollections(db);

    const rawKey = generateEd25519RawPublicKey();
    const inserted = agentKeys.addKey(rawKey, 'active-agent');
    const found = agentKeys.getKey(inserted.keyId);

    expect(found).toBeDefined();
    expect(found?.keyId).toBe(inserted.keyId);
    expect(found?.pubkey).toBe(rawKey.toString('base64'));
  });

  test('returns null for a revoked key', () => {
    agentKeys.createCollections(db);

    const rawKey = generateEd25519RawPublicKey();
    const record = agentKeys.addKey(rawKey, 'to-revoke');
    agentKeys.revokeKey(record.keyId);

    expect(agentKeys.getKey(record.keyId)).toBeNull();
  });

  test('returns null when collection is not initialized', async () => {
    vi.resetModules();
    const { getKey } = await import('./agent-keys.js');
    expect(getKey('anything')).toBeNull();
  });
});

describe('revokeKey', () => {
  test('returns true and sets revokedAt when key exists', () => {
    agentKeys.createCollections(db);

    const rawKey = generateEd25519RawPublicKey();
    const record = agentKeys.addKey(rawKey, 'to-revoke');
    const result = agentKeys.revokeKey(record.keyId);

    expect(result).toBe(true);
    expect(agentKeys.getKey(record.keyId)).toBeNull(); // now filtered out
    const revoked = agentKeys.listKeys().find((key) => key.keyId === record.keyId);
    expect(revoked?.revokedAt).not.toBeNull();
  });

  test('returns false for unknown keyId', () => {
    agentKeys.createCollections(db);

    expect(agentKeys.revokeKey('0000000000000000')).toBe(false);
  });

  test('returns false when key is already revoked', () => {
    agentKeys.createCollections(db);

    const rawKey = generateEd25519RawPublicKey();
    const record = agentKeys.addKey(rawKey, 'to-revoke');
    agentKeys.revokeKey(record.keyId);

    expect(agentKeys.revokeKey(record.keyId)).toBe(false);
  });

  test('returns false when collection is not initialized', async () => {
    vi.resetModules();
    const { revokeKey } = await import('./agent-keys.js');
    expect(revokeKey('anything')).toBe(false);
  });
});

describe('listKeys', () => {
  test('returns empty array when no keys exist', () => {
    agentKeys.createCollections(db);
    expect(agentKeys.listKeys()).toEqual([]);
  });

  test('returns all keys including revoked', () => {
    agentKeys.createCollections(db);

    const key1 = generateEd25519RawPublicKey();
    const key2 = generateEd25519RawPublicKey();
    agentKeys.addKey(key1, 'active');
    const revoked = agentKeys.addKey(key2, 'revoked');
    agentKeys.revokeKey(revoked.keyId);

    const all = agentKeys.listKeys();
    expect(all).toHaveLength(2);
  });

  test('returns empty array when collection is not initialized', async () => {
    vi.resetModules();
    const { listKeys } = await import('./agent-keys.js');
    expect(listKeys()).toEqual([]);
  });
});

describe('keyId derivation (golden test)', () => {
  test('matches Portwing hex(SHA-256[:8]) formula', () => {
    agentKeys.createCollections(db);
    const rawKey = generateEd25519RawPublicKey();
    const expected = createHash('sha256').update(rawKey).digest().subarray(0, 8).toString('hex');

    expect(expected).toMatch(/^[0-9a-f]{16}$/);
    const record = agentKeys.addKey(rawKey, 'golden-test');
    expect(record.keyId).toBe(expected);
  });
});

describe('loadAuthorizedKeysFile', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('throws when file is world-readable', () => {
    agentKeys.createCollections(db);

    vi.spyOn(fs, 'openSync').mockReturnValue(3);
    vi.spyOn(fs, 'closeSync').mockReturnValue(undefined);
    vi.spyOn(fs, 'fstatSync').mockReturnValue({ mode: 0o644 } as fs.Stats);
    expect(() => agentKeys.loadAuthorizedKeysFile('/fake/path')).toThrow(/world-readable/);
  });

  test('loads valid ed25519 lines from file', () => {
    agentKeys.createCollections(db);

    const rawKey = generateEd25519RawPublicKey();
    const pubkeyBase64 = rawKey.toString('base64');
    const fileContent = ['# comment line', '', `ed25519 ${pubkeyBase64} test-label`].join('\n');

    vi.spyOn(fs, 'openSync').mockReturnValue(3);
    vi.spyOn(fs, 'closeSync').mockReturnValue(undefined);
    vi.spyOn(fs, 'fstatSync').mockReturnValue({ mode: 0o600 } as fs.Stats);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(fileContent);

    agentKeys.loadAuthorizedKeysFile('/fake/authorized_keys');

    const all = agentKeys.listKeys();
    expect(all).toHaveLength(1);
    expect(all[0].label).toBe('test-label');
    expect(all[0].pubkey).toBe(pubkeyBase64);
  });

  test('skips lines that do not start with ed25519', () => {
    agentKeys.createCollections(db);

    vi.spyOn(fs, 'openSync').mockReturnValue(3);
    vi.spyOn(fs, 'closeSync').mockReturnValue(undefined);
    vi.spyOn(fs, 'fstatSync').mockReturnValue({ mode: 0o600 } as fs.Stats);
    vi.spyOn(fs, 'readFileSync').mockReturnValue('rsa AAAA invalid-key-type\n');

    agentKeys.loadAuthorizedKeysFile('/fake/authorized_keys');
    expect(agentKeys.listKeys()).toHaveLength(0);
  });

  test('skips keys that decode to wrong byte length', () => {
    agentKeys.createCollections(db);

    // 16 bytes instead of 32
    const shortKey = Buffer.alloc(16).toString('base64');
    vi.spyOn(fs, 'openSync').mockReturnValue(3);
    vi.spyOn(fs, 'closeSync').mockReturnValue(undefined);
    vi.spyOn(fs, 'fstatSync').mockReturnValue({ mode: 0o600 } as fs.Stats);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(`ed25519 ${shortKey} wrong-length\n`);

    agentKeys.loadAuthorizedKeysFile('/fake/authorized_keys');
    expect(agentKeys.listKeys()).toHaveLength(0);
  });

  test('logs warning when addKey throws (e.g. insert throws)', () => {
    agentKeys.createCollections(db);
    // Fail only the INSERT the addKey() write path issues, so the read-side
    // existence checks loadAuthorizedKeysFile relies on keep working —
    // mirrors the original "collection.insert throws" LokiJS mock.
    const originalPrepare = db.prepare.bind(db);
    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      const statement = originalPrepare(sql);
      if (sql.startsWith('INSERT INTO agent_keys')) {
        return {
          ...statement,
          run: () => {
            throw new Error('DB write failed');
          },
        };
      }
      return statement;
    });

    const rawKey = generateEd25519RawPublicKey();
    const pubkeyBase64 = rawKey.toString('base64');
    const fileContent = `ed25519 ${pubkeyBase64} test-label`;

    vi.spyOn(fs, 'openSync').mockReturnValue(3);
    vi.spyOn(fs, 'closeSync').mockReturnValue(undefined);
    vi.spyOn(fs, 'fstatSync').mockReturnValue({ mode: 0o600 } as fs.Stats);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(fileContent);

    // Should not throw — addKey error is caught and logged
    expect(() => agentKeys.loadAuthorizedKeysFile('/fake/authorized_keys')).not.toThrow();
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('DB write failed') }),
      'Failed to add key',
    );
  });

  test('is idempotent — skips already-active keys', () => {
    agentKeys.createCollections(db);

    const rawKey = generateEd25519RawPublicKey();
    const pubkeyBase64 = rawKey.toString('base64');
    const fileContent = `ed25519 ${pubkeyBase64} agent`;

    vi.spyOn(fs, 'openSync').mockReturnValue(3);
    vi.spyOn(fs, 'closeSync').mockReturnValue(undefined);
    vi.spyOn(fs, 'fstatSync').mockReturnValue({ mode: 0o600 } as fs.Stats);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(fileContent);

    agentKeys.loadAuthorizedKeysFile('/fake/authorized_keys');
    agentKeys.loadAuthorizedKeysFile('/fake/authorized_keys');

    // Only one insert should have occurred
    expect(agentKeys.listKeys()).toHaveLength(1);
  });

  test('uses "imported" as label when line has no comment field', () => {
    agentKeys.createCollections(db);

    const rawKey = generateEd25519RawPublicKey();
    const pubkeyBase64 = rawKey.toString('base64');
    // Line with only 2 parts (no comment) — triggers the 'imported' fallback
    const fileContent = `ed25519 ${pubkeyBase64}`;

    vi.spyOn(fs, 'openSync').mockReturnValue(3);
    vi.spyOn(fs, 'closeSync').mockReturnValue(undefined);
    vi.spyOn(fs, 'fstatSync').mockReturnValue({ mode: 0o600 } as fs.Stats);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(fileContent);

    agentKeys.loadAuthorizedKeysFile('/fake/authorized_keys');

    const all = agentKeys.listKeys();
    expect(all).toHaveLength(1);
    expect(all[0].label).toBe('imported');
  });

  test('does not re-activate a revoked key present in authorized_keys and logs warn', () => {
    agentKeys.createCollections(db);

    // Seed a revoked record directly so the lookup returns it.
    const rawKey = generateEd25519RawPublicKey();
    const keyId = _deriveKeyId(rawKey);
    const created = agentKeys.addKey(rawKey, 'existing');
    agentKeys.revokeKey(created.keyId);

    const pubkeyBase64 = rawKey.toString('base64');
    const fileContent = `ed25519 ${pubkeyBase64} revoked-agent`;

    vi.spyOn(fs, 'openSync').mockReturnValue(3);
    vi.spyOn(fs, 'closeSync').mockReturnValue(undefined);
    vi.spyOn(fs, 'fstatSync').mockReturnValue({ mode: 0o600 } as fs.Stats);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(fileContent);

    agentKeys.loadAuthorizedKeysFile('/fake/authorized_keys');

    // Key must NOT be re-inserted
    expect(agentKeys.listKeys()).toHaveLength(1);

    // warn must have been called with the keyId
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({ keyId }),
      expect.stringContaining('Revoked key'),
    );
  });

  test('is idempotent for already-active keys — no insert, no warn', () => {
    agentKeys.createCollections(db);

    const rawKey = generateEd25519RawPublicKey();
    const keyId = _deriveKeyId(rawKey);
    agentKeys.addKey(rawKey, 'active-agent');

    const pubkeyBase64 = rawKey.toString('base64');
    const fileContent = `ed25519 ${pubkeyBase64} active-agent`;

    vi.spyOn(fs, 'openSync').mockReturnValue(3);
    vi.spyOn(fs, 'closeSync').mockReturnValue(undefined);
    vi.spyOn(fs, 'fstatSync').mockReturnValue({ mode: 0o600 } as fs.Stats);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(fileContent);

    agentKeys.loadAuthorizedKeysFile('/fake/authorized_keys');

    // Still only 1 record, no duplicate inserted
    expect(agentKeys.listKeys()).toHaveLength(1);

    // No "Revoked key" warn for active keys
    expect(mockLogWarn).not.toHaveBeenCalledWith(
      expect.objectContaining({ keyId }),
      expect.stringContaining('Revoked key'),
    );
  });

  test('adds a brand-new keyId that has no existing record', () => {
    agentKeys.createCollections(db);

    const rawKey = generateEd25519RawPublicKey();
    const pubkeyBase64 = rawKey.toString('base64');
    const fileContent = `ed25519 ${pubkeyBase64} brand-new`;

    vi.spyOn(fs, 'openSync').mockReturnValue(3);
    vi.spyOn(fs, 'closeSync').mockReturnValue(undefined);
    vi.spyOn(fs, 'fstatSync').mockReturnValue({ mode: 0o600 } as fs.Stats);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(fileContent);

    agentKeys.loadAuthorizedKeysFile('/fake/authorized_keys');

    const all = agentKeys.listKeys();
    expect(all).toHaveLength(1);
    expect(all[0].label).toBe('brand-new');
    expect(all[0].revokedAt).toBeNull();
  });
});
