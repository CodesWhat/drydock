/**
 * Tests for the API key store.
 */
import crypto from 'node:crypto';
import Loki from 'lokijs';

const { mockLogInfo, mockLogWarn } = vi.hoisted(() => ({
  mockLogInfo: vi.fn(),
  mockLogWarn: vi.fn(),
}));

vi.mock('../log/index.js', () => ({
  default: {
    child: vi.fn(() => ({
      info: mockLogInfo,
      warn: mockLogWarn,
      debug: vi.fn(),
      error: vi.fn(),
    })),
  },
}));

import * as apiKey from './api-key.js';

type LokiDb = InstanceType<typeof Loki>;

let db: LokiDb;

function collection() {
  return db.getCollection('api-keys');
}

function createUserKey(overrides: Partial<apiKey.CreateApiKeyInput> = {}) {
  return apiKey.createApiKey({
    name: 'ci',
    scopes: ['read'],
    createdBy: { kind: 'user', username: 'scott' },
    ...overrides,
  });
}

/**
 * A fresh module instance with no collection created, for the paths that must
 * survive being called before store init.
 */
async function loadUninitializedModule() {
  vi.resetModules();
  return import('./api-key.js');
}

beforeEach(() => {
  vi.clearAllMocks();
  db = new Loki('api-key.test.db');
  apiKey.createCollections(db as never);
});

describe('credential format', () => {
  test('mints a ddk_ credential whose two halves match the documented shape', () => {
    const created = createUserKey();

    expect(created.apiKey.startsWith(apiKey.API_KEY_PREFIX)).toBe(true);
    expect(created.apiKey).toMatch(apiKey.API_KEY_PATTERN);

    const parsed = apiKey.parseApiKey(created.apiKey);
    expect(parsed).not.toBeNull();
    expect(parsed?.keyId).toBe(created.record.keyId);
    expect(parsed?.keyId).toHaveLength(apiKey.API_KEY_ID_BYTES * 2);
    // 32 bytes base64url is 43 characters with no padding.
    expect(parsed?.secret).toHaveLength(43);
    expect(Buffer.from(parsed?.secret ?? '', 'base64url')).toHaveLength(
      apiKey.API_KEY_SECRET_BYTES,
    );
  });

  test('generates 10k credentials with no key id collision and no repeated secret', () => {
    const keyIds = new Set<string>();
    const secrets = new Set<string>();

    for (let index = 0; index < 10_000; index += 1) {
      const keyId = crypto.randomBytes(apiKey.API_KEY_ID_BYTES).toString('hex');
      const secret = crypto.randomBytes(apiKey.API_KEY_SECRET_BYTES).toString('base64url');
      expect(`ddk_${keyId}_${secret}`).toMatch(apiKey.API_KEY_PATTERN);
      keyIds.add(keyId);
      secrets.add(secret);
    }

    expect(keyIds.size).toBe(10_000);
    expect(secrets.size).toBe(10_000);
  });

  test('never persists the secret, only its digest', () => {
    const created = createUserKey();
    const secret = apiKey.parseApiKey(created.apiKey)?.secret ?? '';

    const stored = collection().findOne({ keyId: created.record.keyId });
    expect(stored.secretHash).toBe(apiKey.hashApiKeySecret(secret));
    expect(JSON.stringify(stored)).not.toContain(secret);
    expect(JSON.stringify(db.serialize())).not.toContain(secret);
  });

  test('rejects anything that is not exactly the ddk_ shape', () => {
    const created = createUserKey();
    const valid = created.apiKey;

    expect(apiKey.parseApiKey('')).toBeNull();
    expect(apiKey.parseApiKey('Bearer something')).toBeNull();
    expect(apiKey.parseApiKey(valid.replace('ddk_', 'dkk_'))).toBeNull();
    // Truncated secret.
    expect(apiKey.parseApiKey(valid.slice(0, -1))).toBeNull();
    // Uppercase hex in the key id.
    expect(apiKey.parseApiKey(valid.replace(/^ddk_(.{12})/, 'ddk_ABCDEF012345'))).toBeNull();
    expect(apiKey.parseApiKey(`${valid} `)).toBeNull();
  });

  test('parses a secret containing base64url underscores', () => {
    const created = createUserKey();
    const keyId = created.record.keyId;
    const secret = `${'_'.repeat(43)}`;

    expect(apiKey.parseApiKey(`ddk_${keyId}_${secret}`)).toEqual({ keyId, secret });
  });
});

describe('record shape', () => {
  test('stores a flat, migration-ready record', () => {
    const created = createUserKey({ name: '  release dashboard  ', scopes: ['read', 'read'] });
    const stored = collection().findOne({ keyId: created.record.keyId });

    expect(stored.schemaVersion).toBe(apiKey.API_KEY_SCHEMA_VERSION);
    expect(stored.name).toBe('release dashboard');
    expect(stored.scopes).toEqual(['read']);
    expect(stored.createdBy).toBe('user:scott');
    expect(stored.parentKeyId).toBeNull();
    expect(stored.expiresAt).toBeNull();
    expect(stored.lastUsedAt).toBeNull();
    expect(stored.revokedAt).toBeNull();
    expect(typeof stored.createdAt).toBe('string');

    // Every field is a scalar or an array of scalars — no nested objects.
    for (const [field, value] of Object.entries(apiKey.findApiKeyById(created.record.keyId))) {
      if (field === 'scopes') {
        expect(value.every((entry: unknown) => typeof entry === 'string')).toBe(true);
        continue;
      }
      expect(['string', 'number', 'object']).toContain(typeof value);
      expect(typeof value === 'object' ? value : 'scalar').not.toEqual({});
    }
  });

  test('persists and projects an optional per-key rate limit maximum', () => {
    const created = createUserKey({ rateLimitMax: 250 });
    const stored = collection().findOne({ keyId: created.record.keyId });

    expect(stored.rateLimitMax).toBe(250);
    expect(created.record.rateLimitMax).toBe(250);
    expect(apiKey.findApiKeyById(created.record.keyId).rateLimitMax).toBe(250);
    expect(apiKey.listApiKeys()[0].rateLimitMax).toBe(250);
  });

  test('leaves the optional per-key rate limit maximum absent when omitted', () => {
    const created = createUserKey();
    const stored = collection().findOne({ keyId: created.record.keyId });

    expect(stored).not.toHaveProperty('rateLimitMax');
    expect(created.record).not.toHaveProperty('rateLimitMax');
    expect(apiKey.findApiKeyById(created.record.keyId)).not.toHaveProperty('rateLimitMax');
  });

  test('hands back copies rather than live LokiJS documents', () => {
    const created = createUserKey();

    const projected = apiKey.findApiKeyById(created.record.keyId);
    expect(projected).not.toBeNull();
    expect(projected).not.toHaveProperty('$loki');
    expect(projected).not.toHaveProperty('meta');
    expect(projected).not.toHaveProperty('revokedBy');

    projected.name = 'tampered';
    projected.scopes.push('admin');
    expect(apiKey.findApiKeyById(created.record.keyId).name).toBe('ci');
    expect(apiKey.findApiKeyById(created.record.keyId).scopes).toEqual(['read']);
  });

  test('carries revokedBy once the key is revoked', () => {
    const created = createUserKey();
    apiKey.revokeApiKey(created.record.keyId, { revokedBy: 'user:scott' });

    expect(apiKey.findApiKeyById(created.record.keyId).revokedBy).toBe('user:scott');
  });

  test('records an api-key creator as its parent', () => {
    const parent = createUserKey({ name: 'bootstrap', scopes: ['api-keys:manage'] });
    const child = apiKey.createApiKey({
      name: 'minted',
      scopes: ['read'],
      createdBy: { kind: 'api-key', keyId: parent.record.keyId },
    });

    expect(child.record.createdBy).toBe(`api-key:${parent.record.keyId}`);
    expect(child.record.parentKeyId).toBe(parent.record.keyId);
  });
});

describe('createApiKey validation', () => {
  test('rejects an empty or whitespace-only name', () => {
    expect(() => createUserKey({ name: '   ' })).toThrow(apiKey.ApiKeyValidationError);
    expect(() => createUserKey({ name: '' })).toThrow('API key name must not be empty');
  });

  test('rejects a name longer than 64 characters and accepts one exactly 64 long', () => {
    expect(() => createUserKey({ name: 'a'.repeat(65) })).toThrow(
      'API key name must be at most 64 characters',
    );
    expect(createUserKey({ name: 'a'.repeat(64) }).record.name).toHaveLength(64);
  });

  test('rejects a scope list that is empty or not an array', () => {
    expect(() => createUserKey({ scopes: [] })).toThrow('API key scopes must be a non-empty array');
    expect(() => createUserKey({ scopes: 'read' as unknown as string[] })).toThrow(
      'API key scopes must be a non-empty array',
    );
  });

  test('rejects an empty scope entry', () => {
    expect(() => createUserKey({ scopes: ['read', '  '] })).toThrow(
      'API key scopes must not contain empty entries',
    );
  });

  test('rejects an expiry that is unparseable or not in the future', () => {
    const now = new Date('2026-08-29T12:00:00.000Z');
    expect(() => createUserKey({ expiresAt: 'not-a-date', now })).toThrow(
      'API key expiresAt must be an ISO-8601 timestamp',
    );
    expect(() => createUserKey({ expiresAt: '2026-08-29T12:00:00.000Z', now })).toThrow(
      'API key expiresAt must be in the future',
    );
    expect(() => createUserKey({ expiresAt: '2020-01-01T00:00:00.000Z', now })).toThrow(
      'API key expiresAt must be in the future',
    );
  });

  test.each([
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
    '100' as unknown as number,
    null as unknown as number,
  ])('rejects an invalid rateLimitMax value %p', (rateLimitMax) => {
    expect(() => createUserKey({ rateLimitMax })).toThrow(
      'API key rateLimitMax must be a positive safe integer',
    );
  });

  test('accepts the smallest and largest safe rateLimitMax values', () => {
    expect(createUserKey({ rateLimitMax: 1 }).record.rateLimitMax).toBe(1);
    expect(createUserKey({ rateLimitMax: Number.MAX_SAFE_INTEGER }).record.rateLimitMax).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });

  test('normalizes a future expiry and accepts an absent one', () => {
    const now = new Date('2026-08-29T12:00:00.000Z');
    expect(createUserKey({ expiresAt: '2026-12-31T00:00:00Z', now }).record.expiresAt).toBe(
      '2026-12-31T00:00:00.000Z',
    );
    expect(createUserKey({ expiresAt: null, now }).record.expiresAt).toBeNull();
    expect(createUserKey({ now }).record.expiresAt).toBeNull();
  });

  test('rejects an empty creator username', () => {
    expect(() => createUserKey({ createdBy: { kind: 'user', username: ' ' } })).toThrow(
      'API key creator username must not be empty',
    );
  });

  test('rejects a parent key that does not exist', () => {
    expect(() => createUserKey({ createdBy: { kind: 'api-key', keyId: 'aaaaaaaaaaaa' } })).toThrow(
      'Parent API key aaaaaaaaaaaa does not exist',
    );
  });

  test('throws when the collection has not been created', async () => {
    const uninitialized = await loadUninitializedModule();
    expect(() =>
      uninitialized.createApiKey({
        name: 'ci',
        scopes: ['read'],
        createdBy: { kind: 'user', username: 'scott' },
      }),
    ).toThrow('api-keys collection not initialized');
  });
});

describe('key id generation', () => {
  test('retries when a generated key id collides', () => {
    const existing = createUserKey();
    const originalRandomBytes = crypto.randomBytes.bind(crypto);
    const queued = [existing.record.keyId, 'abcdef012345'];
    const spy = vi
      .spyOn(crypto, 'randomBytes')
      .mockImplementation(((size: number) =>
        size === apiKey.API_KEY_ID_BYTES && queued.length > 0
          ? Buffer.from(queued.shift() as string, 'hex')
          : originalRandomBytes(size)) as typeof crypto.randomBytes);

    try {
      expect(createUserKey().record.keyId).toBe('abcdef012345');
      expect(mockLogWarn).toHaveBeenCalledWith(
        { keyId: existing.record.keyId },
        'Generated API key id collided with an existing key, retrying',
      );
    } finally {
      spy.mockRestore();
    }
  });

  test('gives up rather than minting a duplicate key id', () => {
    const existing = createUserKey();
    const originalRandomBytes = crypto.randomBytes.bind(crypto);
    const spy = vi
      .spyOn(crypto, 'randomBytes')
      .mockImplementation(((size: number) =>
        size === apiKey.API_KEY_ID_BYTES
          ? Buffer.from(existing.record.keyId, 'hex')
          : originalRandomBytes(size)) as typeof crypto.randomBytes);

    try {
      expect(() => createUserKey()).toThrow('Unable to generate a unique API key id');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('verifyApiKey', () => {
  test('accepts the credential it minted', () => {
    const created = createUserKey();
    const verified = apiKey.verifyApiKey(created.apiKey);

    expect(verified?.keyId).toBe(created.record.keyId);
    expect(verified?.scopes).toEqual(['read']);
  });

  test('returns null for malformed, unknown, wrong-secret, revoked and expired alike', () => {
    const created = createUserKey();
    const parsed = apiKey.parseApiKey(created.apiKey);
    const otherSecret = crypto.randomBytes(apiKey.API_KEY_SECRET_BYTES).toString('base64url');

    expect(apiKey.verifyApiKey('garbage')).toBeNull();
    expect(apiKey.verifyApiKey(`ddk_ffffffffffff_${parsed?.secret}`)).toBeNull();
    expect(apiKey.verifyApiKey(`ddk_${parsed?.keyId}_${otherSecret}`)).toBeNull();

    const expiring = createUserKey({
      name: 'expiring',
      expiresAt: '2026-09-01T00:00:00.000Z',
      now: new Date('2026-08-29T00:00:00.000Z'),
    });
    expect(
      apiKey.verifyApiKey(expiring.apiKey, { now: new Date('2026-08-30T00:00:00.000Z') }),
    ).not.toBeNull();
    expect(
      apiKey.verifyApiKey(expiring.apiKey, { now: new Date('2026-09-01T00:00:00.000Z') }),
    ).toBeNull();

    apiKey.revokeApiKey(created.record.keyId, { revokedBy: 'user:scott' });
    expect(apiKey.verifyApiKey(created.apiKey)).toBeNull();
  });

  test('returns null when the stored digest is the wrong length', () => {
    const created = createUserKey();
    const stored = collection().findOne({ keyId: created.record.keyId });
    stored.secretHash = Buffer.from('short').toString('base64');
    collection().update(stored);

    expect(apiKey.verifyApiKey(created.apiKey)).toBeNull();
  });

  test('returns null before the store is initialized', async () => {
    const uninitialized = await loadUninitializedModule();
    expect(uninitialized.verifyApiKey(`ddk_abcdef012345_${'a'.repeat(43)}`)).toBeNull();
    expect(uninitialized.findApiKeyById('abcdef012345')).toBeNull();
    expect(uninitialized.listApiKeys()).toEqual([]);
  });
});

describe('verifyApiKey ancestry', () => {
  /**
   * Revocation cascades, so a live key under a revoked one should not exist.
   * It can: the cascade writes one record at a time and LokiJS persists
   * asynchronously, so a process killed part-way through leaves exactly this
   * on disk. Authentication has to answer for the whole chain rather than
   * trust that the cascade finished.
   */
  function revokeWithoutCascade(keyId: string, revokedAt = '2026-09-01T00:00:00.000Z') {
    const stored = collection().findOne({ keyId });
    stored.revokedAt = revokedAt;
    stored.revokedBy = 'user:scott';
    collection().update(stored);
  }

  function setStoredParent(keyId: string, parentKeyId: string | null) {
    const stored = collection().findOne({ keyId });
    stored.parentKeyId = parentKeyId;
    collection().update(stored);
  }

  function mintChild(parentKeyId: string, overrides: Partial<apiKey.CreateApiKeyInput> = {}) {
    return apiKey.createApiKey({
      name: 'child',
      scopes: ['read'],
      createdBy: { kind: 'api-key', keyId: parentKeyId },
      ...overrides,
    });
  }

  test('accepts a key whose whole chain is live', () => {
    const root = createUserKey({ name: 'root' });
    const child = mintChild(root.record.keyId);
    const grandchild = mintChild(child.record.keyId, { name: 'grandchild' });

    expect(apiKey.verifyApiKey(grandchild.apiKey)?.keyId).toBe(grandchild.record.keyId);
  });

  test('never walks for a key minted from a session, which has no ancestry', () => {
    const created = createUserKey();

    expect(created.record.parentKeyId).toBeNull();
    expect(apiKey.verifyApiKey(created.apiKey)).not.toBeNull();
  });

  test.each([
    ['the parent', 1],
    ['the grandparent', 2],
  ])('refuses a live key when %s is revoked but the cascade did not reach it', (_label, depth) => {
    const root = createUserKey({ name: 'root' });
    const child = mintChild(root.record.keyId);
    const grandchild = mintChild(child.record.keyId, { name: 'grandchild' });

    revokeWithoutCascade(depth === 1 ? child.record.keyId : root.record.keyId);

    expect(apiKey.verifyApiKey(grandchild.apiKey)).toBeNull();
  });

  test('refuses a live key when an ancestor has expired', () => {
    const root = createUserKey({ name: 'root', expiresAt: '2026-10-01T00:00:00.000Z' });
    const child = mintChild(root.record.keyId, { expiresAt: '2026-12-01T00:00:00.000Z' });

    // The API refuses a child that outlives its parent; the store does not, so
    // this is the state a hand-edited store file can hold.
    expect(
      apiKey.verifyApiKey(child.apiKey, { now: new Date('2026-09-15T00:00:00.000Z') }),
    ).not.toBeNull();
    expect(
      apiKey.verifyApiKey(child.apiKey, { now: new Date('2026-11-01T00:00:00.000Z') }),
    ).toBeNull();
  });

  test('refuses a key whose parent is no longer in the store', () => {
    const root = createUserKey({ name: 'root' });
    const child = mintChild(root.record.keyId);
    collection().remove(collection().findOne({ keyId: root.record.keyId }));

    expect(apiKey.verifyApiKey(child.apiKey)).toBeNull();
  });

  test('refuses a key whose ancestry loops, rather than walking it forever', () => {
    const root = createUserKey({ name: 'root' });
    const child = mintChild(root.record.keyId);
    // A real stored cycle, not a mutated projection: the walk has to terminate
    // on the collection the process actually reads.
    setStoredParent(root.record.keyId, child.record.keyId);

    expect(apiKey.verifyApiKey(child.apiKey)).toBeNull();
  });
});

describe('isApiKeyExpired', () => {
  const base = {
    schemaVersion: 1,
    keyId: 'abcdef012345',
    name: 'ci',
    secretHash: '',
    scopes: ['read'],
    createdAt: '2026-08-29T00:00:00.000Z',
    createdBy: 'user:scott',
    parentKeyId: null,
    lastUsedAt: null,
    revokedAt: null,
  };

  test('never expires a key with no expiry', () => {
    expect(apiKey.isApiKeyExpired({ ...base, expiresAt: null })).toBe(false);
  });

  test('expires exactly at the boundary, not a millisecond later', () => {
    const record = { ...base, expiresAt: '2026-09-01T00:00:00.000Z' };
    expect(apiKey.isApiKeyExpired(record, new Date('2026-08-31T23:59:59.999Z'))).toBe(false);
    expect(apiKey.isApiKeyExpired(record, new Date('2026-09-01T00:00:00.000Z'))).toBe(true);
  });

  test('treats an unparseable expiry as expired', () => {
    expect(apiKey.isApiKeyExpired({ ...base, expiresAt: 'corrupt' })).toBe(true);
  });

  test('uses the current time when none is supplied', () => {
    expect(apiKey.isApiKeyExpired({ ...base, expiresAt: '2020-01-01T00:00:00.000Z' })).toBe(true);
  });
});

describe('listApiKeys', () => {
  test('returns every key, active and revoked', () => {
    const first = createUserKey({ name: 'one' });
    const second = createUserKey({ name: 'two' });
    apiKey.revokeApiKey(second.record.keyId, { revokedBy: 'user:scott' });

    const listed = apiKey.listApiKeys();
    expect(listed.map((record) => record.name).sort()).toEqual(['one', 'two']);
    expect(listed.find((record) => record.keyId === first.record.keyId).revokedAt).toBeNull();
    expect(listed.find((record) => record.keyId === second.record.keyId).revokedAt).not.toBeNull();
  });
});

describe('cascade revocation', () => {
  function mintChild(parentKeyId: string, name: string) {
    return apiKey.createApiKey({
      name,
      scopes: ['read'],
      createdBy: { kind: 'api-key', keyId: parentKeyId },
    });
  }

  test('revoking a parent revokes a three-deep descendant chain in one call', () => {
    const root = createUserKey({ name: 'root', scopes: ['api-keys:manage'] });
    const child = mintChild(root.record.keyId, 'child');
    const grandchild = mintChild(child.record.keyId, 'grandchild');
    const greatGrandchild = mintChild(grandchild.record.keyId, 'great-grandchild');

    const result = apiKey.revokeApiKey(root.record.keyId, { revokedBy: 'user:scott' });

    expect(result?.keyId).toBe(root.record.keyId);
    expect(result?.revokedKeyIds).toEqual([
      root.record.keyId,
      child.record.keyId,
      grandchild.record.keyId,
      greatGrandchild.record.keyId,
    ]);
    for (const created of [root, child, grandchild, greatGrandchild]) {
      expect(apiKey.findApiKeyById(created.record.keyId).revokedAt).not.toBeNull();
      expect(apiKey.findApiKeyById(created.record.keyId).revokedBy).toBe('user:scott');
    }
  });

  test('a session-minted sibling is never cascaded', () => {
    const root = createUserKey({ name: 'root', scopes: ['api-keys:manage'] });
    mintChild(root.record.keyId, 'child');
    const sibling = createUserKey({ name: 'sibling' });

    apiKey.revokeApiKey(root.record.keyId, { revokedBy: 'user:scott' });

    expect(apiKey.findApiKeyById(sibling.record.keyId).parentKeyId).toBeNull();
    expect(apiKey.findApiKeyById(sibling.record.keyId).revokedAt).toBeNull();
  });

  test('leaves an already-revoked descendant with its original revocation', () => {
    const root = createUserKey({ name: 'root', scopes: ['api-keys:manage'] });
    const child = mintChild(root.record.keyId, 'child');
    apiKey.revokeApiKey(child.record.keyId, {
      revokedBy: 'user:first',
      now: new Date('2026-08-01T00:00:00.000Z'),
    });

    const result = apiKey.revokeApiKey(root.record.keyId, {
      revokedBy: 'user:second',
      now: new Date('2026-08-29T00:00:00.000Z'),
    });

    expect(result?.revokedKeyIds).toEqual([root.record.keyId]);
    const revokedChild = apiKey.findApiKeyById(child.record.keyId);
    expect(revokedChild.revokedAt).toBe('2026-08-01T00:00:00.000Z');
    expect(revokedChild.revokedBy).toBe('user:first');
  });

  test('terminates on a corrupted parent cycle instead of looping forever', () => {
    const first = createUserKey({ name: 'first' });
    const second = createUserKey({ name: 'second' });

    const firstDocument = collection().findOne({ keyId: first.record.keyId });
    const secondDocument = collection().findOne({ keyId: second.record.keyId });
    firstDocument.parentKeyId = second.record.keyId;
    secondDocument.parentKeyId = first.record.keyId;
    collection().update(firstDocument);
    collection().update(secondDocument);

    const result = apiKey.revokeApiKey(first.record.keyId, { revokedBy: 'user:scott' });

    expect(result?.revokedKeyIds.sort()).toEqual([first.record.keyId, second.record.keyId].sort());
  });

  test('returns null for an unknown key id and before the store is initialized', async () => {
    expect(apiKey.revokeApiKey('ffffffffffff', { revokedBy: 'user:scott' })).toBeNull();

    const uninitialized = await loadUninitializedModule();
    expect(uninitialized.revokeApiKey('ffffffffffff', { revokedBy: 'user:scott' })).toBeNull();
  });
});

describe('lastUsedAt throttle', () => {
  test('100 requests in 10 seconds produce exactly one store mutation', () => {
    const created = createUserKey();
    const updateSpy = vi.spyOn(collection(), 'update');
    const start = Date.parse('2026-08-29T12:00:00.000Z');

    let writes = 0;
    for (let index = 0; index < 100; index += 1) {
      const at = new Date(start + index * 100);
      writes += apiKey.recordApiKeyUsage(created.record.keyId, at) ? 1 : 0;
    }

    expect(writes).toBe(1);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    // The buffered value is still what a reader sees.
    expect(apiKey.findApiKeyById(created.record.keyId).lastUsedAt).toBe(
      new Date(start + 99 * 100).toISOString(),
    );
    // ...while the store still holds the throttled write.
    expect(collection().findOne({ keyId: created.record.keyId }).lastUsedAt).toBe(
      new Date(start).toISOString(),
    );
  });

  test('writes again once the throttle window has passed', () => {
    const created = createUserKey();
    const start = Date.parse('2026-08-29T12:00:00.000Z');

    expect(apiKey.recordApiKeyUsage(created.record.keyId, new Date(start))).toBe(true);
    expect(
      apiKey.recordApiKeyUsage(
        created.record.keyId,
        new Date(start + apiKey.API_KEY_LAST_USED_THROTTLE_MS - 1),
      ),
    ).toBe(false);
    expect(
      apiKey.recordApiKeyUsage(
        created.record.keyId,
        new Date(start + apiKey.API_KEY_LAST_USED_THROTTLE_MS),
      ),
    ).toBe(true);
  });

  test('keeps a bucket per key', () => {
    const first = createUserKey({ name: 'one' });
    const second = createUserKey({ name: 'two' });
    const at = new Date('2026-08-29T12:00:00.000Z');

    expect(apiKey.recordApiKeyUsage(first.record.keyId, at)).toBe(true);
    expect(apiKey.recordApiKeyUsage(second.record.keyId, at)).toBe(true);
  });

  test('does nothing for an unknown key or before the store is initialized', async () => {
    expect(apiKey.recordApiKeyUsage('ffffffffffff')).toBe(false);
    expect(apiKey.recordApiKeyUsage(createUserKey().record.keyId)).toBe(true);

    const uninitialized = await loadUninitializedModule();
    expect(uninitialized.recordApiKeyUsage('ffffffffffff')).toBe(false);
    expect(uninitialized.flushApiKeyUsage()).toBe(0);
  });

  test('flushes buffered timestamps so the last minute of usage survives a restart', () => {
    const created = createUserKey();
    const start = Date.parse('2026-08-29T12:00:00.000Z');
    apiKey.recordApiKeyUsage(created.record.keyId, new Date(start));
    apiKey.recordApiKeyUsage(created.record.keyId, new Date(start + 5_000));

    expect(apiKey.flushApiKeyUsage(new Date(start + 6_000))).toBe(1);
    expect(collection().findOne({ keyId: created.record.keyId }).lastUsedAt).toBe(
      new Date(start + 5_000).toISOString(),
    );
    // Nothing pending any more.
    expect(apiKey.flushApiKeyUsage(new Date(start + 7_000))).toBe(0);
  });

  test('periodically flushes buffered timestamps at the throttle boundary', () => {
    vi.useFakeTimers();
    try {
      const localDb = new Loki('api-key.usage-timer.test.db');
      apiKey.createCollections(localDb as never);
      const created = createUserKey();
      const start = Date.parse('2026-08-29T12:00:00.000Z');
      vi.setSystemTime(start);
      const updateSpy = vi.spyOn(localDb.getCollection('api-keys'), 'update');

      apiKey.recordApiKeyUsage(created.record.keyId, new Date(start));
      apiKey.recordApiKeyUsage(created.record.keyId, new Date(start + 5_000));

      expect(updateSpy).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(apiKey.API_KEY_LAST_USED_THROTTLE_MS);

      expect(updateSpy).toHaveBeenCalledTimes(2);
      expect(
        localDb.getCollection('api-keys').findOne({ keyId: created.record.keyId }).lastUsedAt,
      ).toBe(new Date(start + 5_000).toISOString());
    } finally {
      vi.useRealTimers();
    }
  });

  test('drops a buffered timestamp whose key has gone', () => {
    const created = createUserKey();
    const start = Date.parse('2026-08-29T12:00:00.000Z');
    apiKey.recordApiKeyUsage(created.record.keyId, new Date(start));
    apiKey.recordApiKeyUsage(created.record.keyId, new Date(start + 5_000));

    collection().remove(collection().findOne({ keyId: created.record.keyId }));

    expect(apiKey.flushApiKeyUsage(new Date(start + 6_000))).toBe(0);
  });
});

describe('retention', () => {
  function revokedAt(name: string, revokedIso: string) {
    const created = createUserKey({ name });
    const document = collection().findOne({ keyId: created.record.keyId });
    document.revokedAt = revokedIso;
    document.revokedBy = 'user:scott';
    collection().update(document);
    return created.record.keyId;
  }

  test('prunes revoked rows past 90 days and keeps everything else', () => {
    const now = new Date('2026-08-29T00:00:00.000Z');
    const stale = revokedAt('stale', '2026-01-01T00:00:00.000Z');
    const recent = revokedAt('recent', '2026-08-01T00:00:00.000Z');
    const corrupt = revokedAt('corrupt', 'not-a-date');
    const active = createUserKey({ name: 'active' }).record.keyId;

    expect(apiKey.pruneRevokedApiKeys({ now })).toBe(1);
    expect(apiKey.findApiKeyById(stale)).toBeNull();
    expect(apiKey.findApiKeyById(recent)).not.toBeNull();
    expect(apiKey.findApiKeyById(corrupt)).not.toBeNull();
    expect(apiKey.findApiKeyById(active)).not.toBeNull();
  });

  test('honours an explicit retention window', () => {
    const now = new Date('2026-08-29T00:00:00.000Z');
    const recent = revokedAt('recent', '2026-08-01T00:00:00.000Z');

    expect(apiKey.pruneRevokedApiKeys({ retentionDays: 7, now })).toBe(1);
    expect(apiKey.findApiKeyById(recent)).toBeNull();
  });

  test('clears the usage buffer for a pruned key', () => {
    const now = new Date('2026-08-29T00:00:00.000Z');
    const stale = revokedAt('stale', '2026-01-01T00:00:00.000Z');
    apiKey.recordApiKeyUsage(stale, now);

    apiKey.pruneRevokedApiKeys({ now });
    expect(apiKey.flushApiKeyUsage(now)).toBe(0);
  });

  test('prunes on the insert counter as well as on demand', () => {
    const now = new Date('2026-08-29T00:00:00.000Z');
    const stale = revokedAt('stale', '2026-01-01T00:00:00.000Z');

    for (let index = 0; index < 99; index += 1) {
      createUserKey({ name: `filler-${index}`, now });
    }

    expect(apiKey.findApiKeyById(stale)).toBeNull();
  });

  test('prunes on the periodic timer', () => {
    vi.useFakeTimers();
    try {
      const localDb = new Loki('api-key.timer.test.db');
      apiKey.createCollections(localDb as never);
      const created = createUserKey({ name: 'stale' });
      const document = localDb.getCollection('api-keys').findOne({ keyId: created.record.keyId });
      document.revokedAt = '2020-01-01T00:00:00.000Z';
      localDb.getCollection('api-keys').update(document);

      vi.advanceTimersByTime(60 * 60 * 1000);

      expect(apiKey.findApiKeyById(created.record.keyId)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  test('tolerates a timer handle without unref support', () => {
    const setIntervalSpy = vi
      .spyOn(globalThis, 'setInterval')
      .mockReturnValue(0 as unknown as NodeJS.Timeout);

    try {
      expect(() =>
        apiKey.createCollections(new Loki('api-key.unref.test.db') as never),
      ).not.toThrow();
      expect(setIntervalSpy).toHaveBeenCalled();
    } finally {
      setIntervalSpy.mockRestore();
    }
  });

  test('returns zero before the store is initialized', async () => {
    const uninitialized = await loadUninitializedModule();
    expect(uninitialized.pruneRevokedApiKeys()).toBe(0);
  });
});

describe('collection wiring', () => {
  test('creates the api-keys collection with keyId and parentKeyId indices', () => {
    const created = collection();
    expect(created).not.toBeNull();
    expect(created.name).toBe('api-keys');
    expect(Object.keys(created.binaryIndices)).toEqual(
      expect.arrayContaining(['keyId', 'parentKeyId']),
    );
  });

  test('reuses an existing collection across a reload', () => {
    createUserKey({ name: 'survivor' });
    apiKey.createCollections(db as never);

    expect(apiKey.listApiKeys().map((record) => record.name)).toEqual(['survivor']);
  });

  test('logs creation without ever logging the credential', () => {
    const created = createUserKey();
    const secret = apiKey.parseApiKey(created.apiKey)?.secret ?? '';

    expect(mockLogInfo).toHaveBeenCalledWith(
      expect.objectContaining({ keyId: created.record.keyId, name: 'ci' }),
      'Created API key',
    );
    expect(JSON.stringify(mockLogInfo.mock.calls)).not.toContain(secret);
  });
});
