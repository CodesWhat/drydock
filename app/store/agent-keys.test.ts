/**
 * Tests for the agent-keys store.
 */
import { createHash, generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import * as agentKeys from './agent-keys.js';

// Stable log spies — hoisted so the same functions are referenced by every module
// instance loaded via vi.resetModules() + dynamic import(). This avoids the issue
// where results[0] belongs to the static top-level import and results[1] to the
// dynamic one inside a test, causing the wrong child to be inspected.
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

// Minimal LokiJS collection mock
function createMockCollection(initialDocs: agentKeys.AgentKeyRecord[] = []) {
  const docs = [...initialDocs];
  return {
    findOne: vi.fn((query: Record<string, unknown>): agentKeys.AgentKeyRecord | null => {
      const match = docs.find((doc) => {
        return Object.entries(query).every(([k, v]) => (doc as Record<string, unknown>)[k] === v);
      });
      return match ?? null;
    }),
    find: vi.fn((query?: Record<string, unknown>): agentKeys.AgentKeyRecord[] => {
      if (!query || Object.keys(query).length === 0) {
        return [...docs];
      }
      return docs.filter((doc) =>
        Object.entries(query).every(([k, v]) => (doc as Record<string, unknown>)[k] === v),
      );
    }),
    insert: vi.fn((doc: agentKeys.AgentKeyRecord) => {
      docs.push(doc);
    }),
    update: vi.fn(),
    // Real update mutates in-place since docs are references
  };
}

function createMockDb(collection = createMockCollection()) {
  return {
    getCollection: vi.fn(() => collection),
    addCollection: vi.fn(() => collection),
  };
}

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

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe('createCollections', () => {
  test('uses existing collection when present', async () => {
    const { createCollections } = await import('./agent-keys.js');
    const collection = createMockCollection();
    const db = createMockDb(collection);
    createCollections(db);
    expect(db.addCollection).not.toHaveBeenCalled();
  });

  test('creates collection when not present', async () => {
    const { createCollections } = await import('./agent-keys.js');
    const collection = createMockCollection();
    const db = {
      getCollection: vi.fn(() => null),
      addCollection: vi.fn(() => collection),
    };
    createCollections(db);
    expect(db.addCollection).toHaveBeenCalled();
  });
});

describe('addKey', () => {
  test('inserts a valid 32-byte key and returns a record', async () => {
    const { createCollections, addKey } = await import('./agent-keys.js');
    const collection = createMockCollection();
    createCollections(createMockDb(collection));

    const rawKey = generateEd25519RawPublicKey();
    const record = addKey(rawKey, 'test-agent');

    expect(record.keyId).toMatch(/^[0-9a-f]{16}$/);
    expect(record.pubkey).toBe(rawKey.toString('base64'));
    expect(record.label).toBe('test-agent');
    expect(record.createdAt).toBeTruthy();
    expect(record.revokedAt).toBeNull();
    expect(collection.insert).toHaveBeenCalledWith(record);
  });

  test('throws when adding a duplicate active key', async () => {
    const { createCollections, addKey } = await import('./agent-keys.js');
    const collection = createMockCollection();
    createCollections(createMockDb(collection));

    const rawKey = generateEd25519RawPublicKey();
    addKey(rawKey, 'first');
    expect(() => addKey(rawKey, 'second')).toThrow(/already active/);
  });

  test('throws when collection is not initialized', async () => {
    vi.resetModules();
    const { addKey } = await import('./agent-keys.js');
    const rawKey = generateEd25519RawPublicKey();
    expect(() => addKey(rawKey, 'test')).toThrow(/not initialized/);
  });

  test('throws when pubkeyBuffer is shorter than 32 bytes', async () => {
    const { createCollections, addKey } = await import('./agent-keys.js');
    const collection = createMockCollection();
    createCollections(createMockDb(collection));

    const shortKey = Buffer.alloc(16); // 16 bytes instead of 32
    expect(() => addKey(shortKey, 'short')).toThrow(/32 bytes/);
  });

  test('throws when pubkeyBuffer is longer than 32 bytes', async () => {
    const { createCollections, addKey } = await import('./agent-keys.js');
    const collection = createMockCollection();
    createCollections(createMockDb(collection));

    const longKey = Buffer.alloc(64); // 64 bytes instead of 32
    expect(() => addKey(longKey, 'long')).toThrow(/32 bytes/);
  });
});

describe('getKey', () => {
  test('returns null for unknown keyId', async () => {
    const { createCollections, getKey } = await import('./agent-keys.js');
    const collection = createMockCollection();
    createCollections(createMockDb(collection));

    expect(getKey('deadbeefdeadbeef')).toBeNull();
  });

  test('returns the record for an active key', async () => {
    const { createCollections, addKey, getKey } = await import('./agent-keys.js');
    const collection = createMockCollection();
    createCollections(createMockDb(collection));

    const rawKey = generateEd25519RawPublicKey();
    const inserted = addKey(rawKey, 'active-agent');
    const found = getKey(inserted.keyId);

    expect(found).toBeDefined();
    expect(found?.keyId).toBe(inserted.keyId);
    expect(found?.pubkey).toBe(rawKey.toString('base64'));
  });

  test('returns null for a revoked key', async () => {
    const { createCollections, addKey, getKey } = await import('./agent-keys.js');

    // Build a collection that correctly simulates revokedAt mutation
    const docs: agentKeys.AgentKeyRecord[] = [];
    const collection = {
      findOne: vi.fn((query: Record<string, unknown>) => {
        return (
          docs.find((doc) =>
            Object.entries(query).every(([k, v]) => (doc as Record<string, unknown>)[k] === v),
          ) ?? null
        );
      }),
      find: vi.fn(() => [...docs]),
      insert: vi.fn((doc: agentKeys.AgentKeyRecord) => {
        docs.push(doc);
      }),
      update: vi.fn(),
    };
    createCollections(createMockDb(collection));

    const rawKey = generateEd25519RawPublicKey();
    const record = addKey(rawKey, 'to-revoke');
    // Simulate revokeKey: set revokedAt on the live object
    record.revokedAt = new Date().toISOString();

    expect(getKey(record.keyId)).toBeNull();
  });

  test('returns null when collection is not initialized', async () => {
    vi.resetModules();
    const { getKey } = await import('./agent-keys.js');
    expect(getKey('anything')).toBeNull();
  });
});

describe('revokeKey', () => {
  test('returns true and sets revokedAt when key exists', async () => {
    const { createCollections, addKey, revokeKey, getKey } = await import('./agent-keys.js');

    const docs: agentKeys.AgentKeyRecord[] = [];
    const collection = {
      findOne: vi.fn((query: Record<string, unknown>) => {
        return (
          docs.find((doc) =>
            Object.entries(query).every(([k, v]) => (doc as Record<string, unknown>)[k] === v),
          ) ?? null
        );
      }),
      find: vi.fn(() => [...docs]),
      insert: vi.fn((doc: agentKeys.AgentKeyRecord) => {
        docs.push(doc);
      }),
      update: vi.fn((doc: agentKeys.AgentKeyRecord) => {
        const index = docs.findIndex((d) => d.keyId === doc.keyId);
        if (index !== -1) docs[index] = doc;
      }),
    };
    createCollections(createMockDb(collection));

    const rawKey = generateEd25519RawPublicKey();
    const record = addKey(rawKey, 'to-revoke');
    const result = revokeKey(record.keyId);

    expect(result).toBe(true);
    expect(collection.update).toHaveBeenCalled();
    expect(getKey(record.keyId)).toBeNull(); // now filtered out
  });

  test('returns false for unknown keyId', async () => {
    const { createCollections, revokeKey } = await import('./agent-keys.js');
    const collection = createMockCollection();
    createCollections(createMockDb(collection));

    expect(revokeKey('0000000000000000')).toBe(false);
  });

  test('returns false when collection is not initialized', async () => {
    vi.resetModules();
    const { revokeKey } = await import('./agent-keys.js');
    expect(revokeKey('anything')).toBe(false);
  });
});

describe('listKeys', () => {
  test('returns empty array when no keys exist', async () => {
    const { createCollections, listKeys } = await import('./agent-keys.js');
    const collection = createMockCollection();
    createCollections(createMockDb(collection));
    expect(listKeys()).toEqual([]);
  });

  test('returns all keys including revoked', async () => {
    const { createCollections, addKey, listKeys } = await import('./agent-keys.js');
    const docs: agentKeys.AgentKeyRecord[] = [];
    const collection = {
      findOne: vi.fn((query: Record<string, unknown>) => {
        return (
          docs.find((doc) =>
            Object.entries(query).every(([k, v]) => (doc as Record<string, unknown>)[k] === v),
          ) ?? null
        );
      }),
      find: vi.fn(() => [...docs]),
      insert: vi.fn((doc: agentKeys.AgentKeyRecord) => {
        docs.push(doc);
      }),
      update: vi.fn(),
    };
    createCollections(createMockDb(collection));

    const key1 = generateEd25519RawPublicKey();
    const key2 = generateEd25519RawPublicKey();
    addKey(key1, 'active');
    const revoked = addKey(key2, 'revoked');
    revoked.revokedAt = new Date().toISOString(); // mark revoked in the doc

    const all = listKeys();
    expect(all).toHaveLength(2);
  });

  test('returns empty array when collection is not initialized', async () => {
    vi.resetModules();
    const { listKeys } = await import('./agent-keys.js');
    expect(listKeys()).toEqual([]);
  });
});

describe('keyId derivation (golden test)', () => {
  test('matches lookout hex(SHA-256[:8]) formula', () => {
    const rawKey = generateEd25519RawPublicKey();
    const expected = createHash('sha256').update(rawKey).digest().subarray(0, 8).toString('hex');

    // deriveKeyId is not exported, but we can verify it by addKey returning matching keyId
    // We do it directly using the same algorithm
    expect(expected).toMatch(/^[0-9a-f]{16}$/);
    // And verify addKey produces the same value
    const { createCollections, addKey } = agentKeys;
    const collection = createMockCollection();
    createCollections(createMockDb(collection));
    const record = addKey(rawKey, 'golden-test');
    expect(record.keyId).toBe(expected);
  });
});

describe('loadAuthorizedKeysFile', () => {
  test('throws when file is world-readable', async () => {
    const { createCollections, loadAuthorizedKeysFile } = await import('./agent-keys.js');
    const collection = createMockCollection();
    createCollections(createMockDb(collection));

    vi.spyOn(fs, 'openSync').mockReturnValue(3);
    vi.spyOn(fs, 'closeSync').mockReturnValue(undefined);
    const statSpy = vi.spyOn(fs, 'fstatSync').mockReturnValue({ mode: 0o644 } as fs.Stats);
    expect(() => loadAuthorizedKeysFile('/fake/path')).toThrow(/world-readable/);
    statSpy.mockRestore();
  });

  test('loads valid ed25519 lines from file', async () => {
    const { createCollections, loadAuthorizedKeysFile } = await import('./agent-keys.js');
    const docs: agentKeys.AgentKeyRecord[] = [];
    const collection = {
      findOne: vi.fn((query: Record<string, unknown>) => {
        return (
          docs.find((doc) =>
            Object.entries(query).every(([k, v]) => (doc as Record<string, unknown>)[k] === v),
          ) ?? null
        );
      }),
      find: vi.fn(() => [...docs]),
      insert: vi.fn((doc: agentKeys.AgentKeyRecord) => {
        docs.push(doc);
      }),
      update: vi.fn(),
    };
    createCollections(createMockDb(collection));

    const rawKey = generateEd25519RawPublicKey();
    const pubkeyBase64 = rawKey.toString('base64');
    const fileContent = ['# comment line', '', `ed25519 ${pubkeyBase64} test-label`].join('\n');

    vi.spyOn(fs, 'openSync').mockReturnValue(3);
    vi.spyOn(fs, 'closeSync').mockReturnValue(undefined);
    vi.spyOn(fs, 'fstatSync').mockReturnValue({ mode: 0o600 } as fs.Stats);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(fileContent);

    loadAuthorizedKeysFile('/fake/authorized_keys');

    expect(docs).toHaveLength(1);
    expect(docs[0].label).toBe('test-label');
    expect(docs[0].pubkey).toBe(pubkeyBase64);

    vi.restoreAllMocks();
  });

  test('skips lines that do not start with ed25519', async () => {
    const { createCollections, loadAuthorizedKeysFile } = await import('./agent-keys.js');
    const docs: agentKeys.AgentKeyRecord[] = [];
    const collection = {
      findOne: vi.fn(() => null),
      find: vi.fn(() => [...docs]),
      insert: vi.fn((doc: agentKeys.AgentKeyRecord) => {
        docs.push(doc);
      }),
      update: vi.fn(),
    };
    createCollections(createMockDb(collection));

    vi.spyOn(fs, 'openSync').mockReturnValue(3);
    vi.spyOn(fs, 'closeSync').mockReturnValue(undefined);
    vi.spyOn(fs, 'fstatSync').mockReturnValue({ mode: 0o600 } as fs.Stats);
    vi.spyOn(fs, 'readFileSync').mockReturnValue('rsa AAAA invalid-key-type\n');

    loadAuthorizedKeysFile('/fake/authorized_keys');
    expect(docs).toHaveLength(0);

    vi.restoreAllMocks();
  });

  test('skips keys that decode to wrong byte length', async () => {
    const { createCollections, loadAuthorizedKeysFile } = await import('./agent-keys.js');
    const docs: agentKeys.AgentKeyRecord[] = [];
    const collection = {
      findOne: vi.fn(() => null),
      find: vi.fn(() => [...docs]),
      insert: vi.fn((doc: agentKeys.AgentKeyRecord) => {
        docs.push(doc);
      }),
      update: vi.fn(),
    };
    createCollections(createMockDb(collection));

    // 16 bytes instead of 32
    const shortKey = Buffer.alloc(16).toString('base64');
    vi.spyOn(fs, 'openSync').mockReturnValue(3);
    vi.spyOn(fs, 'closeSync').mockReturnValue(undefined);
    vi.spyOn(fs, 'fstatSync').mockReturnValue({ mode: 0o600 } as fs.Stats);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(`ed25519 ${shortKey} wrong-length\n`);

    loadAuthorizedKeysFile('/fake/authorized_keys');
    expect(docs).toHaveLength(0);

    vi.restoreAllMocks();
  });

  test('logs warning when addKey throws (e.g. insert throws)', async () => {
    const { createCollections, loadAuthorizedKeysFile } = await import('./agent-keys.js');
    const docs: agentKeys.AgentKeyRecord[] = [];
    const collection = {
      findOne: vi.fn(() => null),
      find: vi.fn(() => [...docs]),
      insert: vi.fn(() => {
        throw new Error('DB write failed');
      }),
      update: vi.fn(),
    };
    createCollections(createMockDb(collection));

    const { generateKeyPairSync: genKP } = await import('node:crypto');
    const { publicKey } = genKP('ed25519');
    const spki = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
    const rawKey = spki.subarray(12);
    const pubkeyBase64 = rawKey.toString('base64');
    const fileContent = `ed25519 ${pubkeyBase64} test-label`;

    vi.spyOn(fs, 'openSync').mockReturnValue(3);
    vi.spyOn(fs, 'closeSync').mockReturnValue(undefined);
    vi.spyOn(fs, 'fstatSync').mockReturnValue({ mode: 0o600 } as fs.Stats);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(fileContent);

    // Should not throw — addKey error is caught and logged
    expect(() => loadAuthorizedKeysFile('/fake/authorized_keys')).not.toThrow();

    vi.restoreAllMocks();
  });

  test('is idempotent — skips already-active keys', async () => {
    const { createCollections, loadAuthorizedKeysFile } = await import('./agent-keys.js');
    const docs: agentKeys.AgentKeyRecord[] = [];
    const collection = {
      findOne: vi.fn((query: Record<string, unknown>) => {
        return (
          docs.find((doc) =>
            Object.entries(query).every(([k, v]) => (doc as Record<string, unknown>)[k] === v),
          ) ?? null
        );
      }),
      find: vi.fn(() => [...docs]),
      insert: vi.fn((doc: agentKeys.AgentKeyRecord) => {
        docs.push(doc);
      }),
      update: vi.fn(),
    };
    createCollections(createMockDb(collection));

    const rawKey = generateEd25519RawPublicKey();
    const pubkeyBase64 = rawKey.toString('base64');
    const fileContent = `ed25519 ${pubkeyBase64} agent`;

    vi.spyOn(fs, 'openSync').mockReturnValue(3);
    vi.spyOn(fs, 'closeSync').mockReturnValue(undefined);
    vi.spyOn(fs, 'fstatSync').mockReturnValue({ mode: 0o600 } as fs.Stats);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(fileContent);

    loadAuthorizedKeysFile('/fake/authorized_keys');
    loadAuthorizedKeysFile('/fake/authorized_keys');

    // Only one insert should have occurred
    expect(docs).toHaveLength(1);

    vi.restoreAllMocks();
  });

  test('uses "imported" as label when line has no comment field', async () => {
    const { createCollections, loadAuthorizedKeysFile } = await import('./agent-keys.js');
    const docs: agentKeys.AgentKeyRecord[] = [];
    const collection = {
      findOne: vi.fn((query: Record<string, unknown>) => {
        return (
          docs.find((doc) =>
            Object.entries(query).every(([k, v]) => (doc as Record<string, unknown>)[k] === v),
          ) ?? null
        );
      }),
      find: vi.fn(() => [...docs]),
      insert: vi.fn((doc: agentKeys.AgentKeyRecord) => {
        docs.push(doc);
      }),
      update: vi.fn(),
    };
    createCollections(createMockDb(collection));

    const rawKey = generateEd25519RawPublicKey();
    const pubkeyBase64 = rawKey.toString('base64');
    // Line with only 2 parts (no comment) — triggers the 'imported' fallback
    const fileContent = `ed25519 ${pubkeyBase64}`;

    vi.spyOn(fs, 'openSync').mockReturnValue(3);
    vi.spyOn(fs, 'closeSync').mockReturnValue(undefined);
    vi.spyOn(fs, 'fstatSync').mockReturnValue({ mode: 0o600 } as fs.Stats);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(fileContent);

    loadAuthorizedKeysFile('/fake/authorized_keys');

    expect(docs).toHaveLength(1);
    expect(docs[0].label).toBe('imported');

    vi.restoreAllMocks();
  });

  test('does not re-activate a revoked key present in authorized_keys and logs warn', async () => {
    const { createCollections, loadAuthorizedKeysFile } = await import('./agent-keys.js');

    // Seed a revoked record directly so findOne({ keyId }) returns it
    const rawKey = generateEd25519RawPublicKey();
    const keyId = _deriveKeyId(rawKey);
    const revokedRecord: agentKeys.AgentKeyRecord = {
      keyId,
      pubkey: rawKey.toString('base64'),
      label: 'existing',
      createdAt: new Date().toISOString(),
      revokedAt: new Date().toISOString(), // already revoked
    };
    const docs: agentKeys.AgentKeyRecord[] = [revokedRecord];

    const collection = {
      findOne: vi.fn((query: Record<string, unknown>) => {
        return (
          docs.find((doc) =>
            Object.entries(query).every(([k, v]) => (doc as Record<string, unknown>)[k] === v),
          ) ?? null
        );
      }),
      find: vi.fn(() => [...docs]),
      insert: vi.fn((doc: agentKeys.AgentKeyRecord) => {
        docs.push(doc);
      }),
      update: vi.fn(),
    };
    createCollections(createMockDb(collection));

    const pubkeyBase64 = rawKey.toString('base64');
    const fileContent = `ed25519 ${pubkeyBase64} revoked-agent`;

    vi.spyOn(fs, 'openSync').mockReturnValue(3);
    vi.spyOn(fs, 'closeSync').mockReturnValue(undefined);
    vi.spyOn(fs, 'fstatSync').mockReturnValue({ mode: 0o600 } as fs.Stats);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(fileContent);

    loadAuthorizedKeysFile('/fake/authorized_keys');

    // Key must NOT be re-inserted
    expect(docs).toHaveLength(1);
    expect(docs[0].revokedAt).not.toBeNull(); // still revoked

    // warn must have been called with the keyId (mockLogWarn is shared across all module instances)
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({ keyId }),
      expect.stringContaining('Revoked key'),
    );

    vi.restoreAllMocks();
  });

  test('is idempotent for already-active keys — no insert, no warn', async () => {
    const { createCollections, loadAuthorizedKeysFile } = await import('./agent-keys.js');

    const rawKey = generateEd25519RawPublicKey();
    const keyId = _deriveKeyId(rawKey);
    const activeRecord: agentKeys.AgentKeyRecord = {
      keyId,
      pubkey: rawKey.toString('base64'),
      label: 'active-agent',
      createdAt: new Date().toISOString(),
      revokedAt: null,
    };
    const docs: agentKeys.AgentKeyRecord[] = [activeRecord];

    const collection = {
      findOne: vi.fn((query: Record<string, unknown>) => {
        return (
          docs.find((doc) =>
            Object.entries(query).every(([k, v]) => (doc as Record<string, unknown>)[k] === v),
          ) ?? null
        );
      }),
      find: vi.fn(() => [...docs]),
      insert: vi.fn((doc: agentKeys.AgentKeyRecord) => {
        docs.push(doc);
      }),
      update: vi.fn(),
    };
    createCollections(createMockDb(collection));

    const pubkeyBase64 = rawKey.toString('base64');
    const fileContent = `ed25519 ${pubkeyBase64} active-agent`;

    vi.spyOn(fs, 'openSync').mockReturnValue(3);
    vi.spyOn(fs, 'closeSync').mockReturnValue(undefined);
    vi.spyOn(fs, 'fstatSync').mockReturnValue({ mode: 0o600 } as fs.Stats);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(fileContent);

    loadAuthorizedKeysFile('/fake/authorized_keys');

    // Still only 1 doc, no duplicate inserted
    expect(docs).toHaveLength(1);
    expect(collection.insert).not.toHaveBeenCalled();

    // No "Revoked key" warn for active keys
    expect(mockLogWarn).not.toHaveBeenCalledWith(
      expect.objectContaining({ keyId }),
      expect.stringContaining('Revoked key'),
    );

    vi.restoreAllMocks();
  });

  test('adds a brand-new keyId that has no existing record', async () => {
    const { createCollections, loadAuthorizedKeysFile } = await import('./agent-keys.js');
    const docs: agentKeys.AgentKeyRecord[] = [];
    const collection = {
      findOne: vi.fn((query: Record<string, unknown>) => {
        return (
          docs.find((doc) =>
            Object.entries(query).every(([k, v]) => (doc as Record<string, unknown>)[k] === v),
          ) ?? null
        );
      }),
      find: vi.fn(() => [...docs]),
      insert: vi.fn((doc: agentKeys.AgentKeyRecord) => {
        docs.push(doc);
      }),
      update: vi.fn(),
    };
    createCollections(createMockDb(collection));

    const rawKey = generateEd25519RawPublicKey();
    const pubkeyBase64 = rawKey.toString('base64');
    const fileContent = `ed25519 ${pubkeyBase64} brand-new`;

    vi.spyOn(fs, 'openSync').mockReturnValue(3);
    vi.spyOn(fs, 'closeSync').mockReturnValue(undefined);
    vi.spyOn(fs, 'fstatSync').mockReturnValue({ mode: 0o600 } as fs.Stats);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(fileContent);

    loadAuthorizedKeysFile('/fake/authorized_keys');

    expect(docs).toHaveLength(1);
    expect(docs[0].label).toBe('brand-new');
    expect(docs[0].revokedAt).toBeNull();

    vi.restoreAllMocks();
  });
});
