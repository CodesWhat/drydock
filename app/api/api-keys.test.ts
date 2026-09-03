/**
 * Tests for the API key management router.
 *
 * The express Router is mocked so handlers can be called directly, but the
 * store is real and backed by LokiJS: cascade revocation and the minting
 * ceiling are the whole point of this router, and a mocked store would only
 * assert that the code calls itself.
 */
import Loki from 'lokijs';
import { createMockRequest, createMockResponse } from '../test/helpers.js';

const { mockRouter, mockRecordCreated, mockRecordRevoked, mockCloseSseClients } = vi.hoisted(
  () => ({
    mockRouter: { use: vi.fn(), get: vi.fn(), post: vi.fn(), delete: vi.fn() },
    mockRecordCreated: vi.fn(),
    mockRecordRevoked: vi.fn(),
    mockCloseSseClients: vi.fn(),
  }),
);

vi.mock('express', () => ({
  default: { Router: vi.fn(() => mockRouter) },
}));
vi.mock('nocache', () => ({ default: vi.fn(() => 'nocache-middleware') }));
vi.mock('./api-key-audit.js', () => ({
  recordApiKeyCreatedAuditEvent: mockRecordCreated,
  recordApiKeyRevokedAuditEvent: mockRecordRevoked,
}));
vi.mock('./sse.js', () => ({
  closeSseClientsForRevokedApiKeys: mockCloseSseClients,
}));
vi.mock('../log/index.js', () => ({
  default: {
    child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() })),
  },
}));

import * as apiKeyStore from '../store/api-key.js';
import * as apiKeysRouter from './api-keys.js';
import {
  ANCESTOR_REVOKE_MESSAGE,
  EXPIRY_CEILING_MESSAGE,
  INVALID_CURSOR_MESSAGE,
  SCOPE_CEILING_MESSAGE,
  SELF_REVOKE_MESSAGE,
  UNKNOWN_KEY_MESSAGE,
} from './api-keys.js';
import { getRouteScope } from './route-scopes.js';

type Handler = (req: unknown, res: unknown) => void;

function handlerFor(method: 'get' | 'post' | 'delete', routePath: string): Handler {
  const call = mockRouter[method].mock.calls.find((entry) => entry[0] === routePath);
  if (!call) {
    throw new Error(`No ${method.toUpperCase()} ${routePath} route registered`);
  }
  return call[call.length - 1] as Handler;
}

function sessionRequest(overrides: Record<string, unknown> = {}) {
  return createMockRequest({
    principal: { kind: 'session', username: 'scott' },
    ...overrides,
  });
}

function keyRequest(
  principal: { keyId: string; scopes: string[]; parentKeyId?: string | null },
  overrides: Record<string, unknown> = {},
) {
  return createMockRequest({
    principal: {
      kind: 'api-key',
      username: 'automation',
      parentKeyId: null,
      ...principal,
    },
    ...overrides,
  });
}

function bodyOf(res: ReturnType<typeof createMockResponse>): Record<string, unknown> {
  return (res.json as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as Record<
    string,
    unknown
  >;
}

function mint(name: string, scopes: string[], overrides: Record<string, unknown> = {}) {
  return apiKeyStore.createApiKey({
    name,
    scopes,
    createdBy: { kind: 'user', username: 'scott' },
    ...overrides,
  });
}

let db: InstanceType<typeof Loki>;

/**
 * Reach past the store's projections. `findApiKeyById` hands back a copy, so
 * mutating one leaves the collection the walk actually reads untouched, and a
 * test that did that would assert nothing.
 */
function storedRecord(keyId: string) {
  return db.getCollection('api-keys').findOne({ keyId });
}

function setStoredParent(keyId: string, parentKeyId: string) {
  const stored = storedRecord(keyId);
  stored.parentKeyId = parentKeyId;
  db.getCollection('api-keys').update(stored);
}

beforeEach(() => {
  vi.clearAllMocks();
  db = new Loki('api-keys-router.test.db');
  apiKeyStore.createCollections(db as never);
  apiKeysRouter.init();
});

describe('route registration', () => {
  test('declares every route as api-keys:manage', () => {
    expect(getRouteScope(handlerFor('get', '/'))).toBe('api-keys:manage');
    expect(getRouteScope(handlerFor('post', '/'))).toBe('api-keys:manage');
    expect(getRouteScope(handlerFor('delete', '/:keyId'))).toBe('api-keys:manage');
  });

  test('puts revocation behind a destructive-action confirmation', () => {
    const deleteCall = mockRouter.delete.mock.calls.find((entry) => entry[0] === '/:keyId');
    expect(deleteCall).toHaveLength(3);
  });

  test('disables caching, so key material is never held by an intermediary', () => {
    expect(mockRouter.use).toHaveBeenCalledWith('nocache-middleware');
  });

  test('registers no verb that edits an existing key', () => {
    // No-self-extension is structural: there is nothing to PATCH.
    expect(mockRouter).not.toHaveProperty('patch.mock.calls.length', expect.anything());
    expect(Object.keys(mockRouter)).toStrictEqual(['use', 'get', 'post', 'delete']);
  });
});

describe('listing', () => {
  test('never returns the stored digest', () => {
    mint('ci', ['read']);
    const res = createMockResponse();

    handlerFor('get', '/')(sessionRequest(), res);

    const payload = bodyOf(res);
    expect(JSON.stringify(payload)).not.toContain('secretHash');
    expect((payload.data as unknown[])[0]).not.toHaveProperty('secretHash');
  });

  test('returns a display prefix rather than anything usable', () => {
    const created = mint('ci', ['read']);
    const res = createMockResponse();

    handlerFor('get', '/')(sessionRequest(), res);

    const [first] = bodyOf(res).data as Array<Record<string, unknown>>;
    expect(first.displayPrefix).toBe(`ddk_${created.record.keyId}…`);
    expect(JSON.stringify(bodyOf(res))).not.toContain(created.apiKey);
  });

  test('reports status per key', () => {
    const active = mint('active', ['read']);
    const revoked = mint('revoked', ['read']);
    apiKeyStore.revokeApiKey(revoked.record.keyId, { revokedBy: 'user:scott' });
    const res = createMockResponse();

    handlerFor('get', '/')(sessionRequest(), res);

    const byId = Object.fromEntries(
      (bodyOf(res).data as Array<Record<string, unknown>>).map((view) => [view.keyId, view.status]),
    );
    expect(byId[active.record.keyId]).toBe('active');
    expect(byId[revoked.record.keyId]).toBe('revoked');
  });

  test('reports an expired key as expired rather than active', () => {
    mint('short', ['read'], { expiresAt: new Date(Date.now() + 1_000).toISOString() });
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 10_000));
    try {
      const res = createMockResponse();
      handlerFor('get', '/')(sessionRequest(), res);
      expect((bodyOf(res).data as Array<Record<string, unknown>>)[0].status).toBe('expired');
    } finally {
      vi.useRealTimers();
    }
  });

  test('surfaces revokedBy and rateLimitMax when present', () => {
    const created = mint('capped', ['read'], { rateLimitMax: 30 });
    apiKeyStore.revokeApiKey(created.record.keyId, { revokedBy: 'user:scott' });
    const res = createMockResponse();

    handlerFor('get', '/')(sessionRequest(), res);

    expect((bodyOf(res).data as Array<Record<string, unknown>>)[0]).toMatchObject({
      revokedBy: 'user:scott',
      rateLimitMax: 30,
    });
  });

  function listPage(query: Record<string, unknown> = {}) {
    const res = createMockResponse();
    handlerFor('get', '/')(sessionRequest({ query }), res);
    return { res, body: bodyOf(res) };
  }

  function idsOf(body: Record<string, unknown>): string[] {
    return (body.data as Array<Record<string, unknown>>).map((view) => view.keyId as string);
  }

  test('pages on a cursor rather than an offset', () => {
    for (let index = 0; index < 3; index += 1) {
      mint(`key-${index}`, ['read']);
    }

    const first = listPage({ limit: '2' }).body;

    expect(first).toMatchObject({ total: 3, limit: 2, hasMore: true });
    expect(first).not.toHaveProperty('offset');
    expect(idsOf(first).length).toBe(2);
    expect(typeof first.nextCursor).toBe('string');

    const second = listPage({ limit: '2', cursor: first.nextCursor }).body;

    expect(second).toMatchObject({ total: 3, limit: 2, hasMore: false });
    expect(second).not.toHaveProperty('nextCursor');
    expect(idsOf(second).length).toBe(1);
    expect(new Set([...idsOf(first), ...idsOf(second)]).size).toBe(3);
  });

  test('a key minted mid-walk cannot displace one that has not been read yet', () => {
    // The bug offset paging had: inserting at the head shifts every unread row
    // down by one, so the second page skips whatever landed on the boundary
    // and the walk can finish with hasMore false having never returned it.
    // Minting is exactly what an operator does while this screen is open.
    vi.useFakeTimers();
    try {
      const original: string[] = [];
      for (let index = 0; index < 3; index += 1) {
        vi.setSystemTime(new Date(Date.UTC(2026, 8, 3, 0, 0, index)));
        original.push(mint(`key-${index}`, ['read']).record.keyId);
      }

      const first = listPage({ limit: '2' }).body;

      vi.setSystemTime(new Date(Date.UTC(2026, 8, 3, 0, 1, 0)));
      const midWalk = mint('minted-mid-walk', ['read']).record.keyId;

      const second = listPage({ limit: '2', cursor: first.nextCursor }).body;

      // The new key sorts ahead of the cursor, so this walk never sees it, and
      // the row it would have pushed off the boundary still arrives.
      expect([...idsOf(first), ...idsOf(second)]).toStrictEqual([...original].reverse());
      expect(idsOf(second)).not.toContain(midWalk);
      expect(second).toMatchObject({ total: 4, hasMore: false });
    } finally {
      vi.useRealTimers();
    }
  });

  test('breaks ties on the key id, so keys minted in the same millisecond still page', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-03T00:00:00.000Z'));
    try {
      const minted = [0, 1, 2].map((index) => mint(`same-ms-${index}`, ['read']).record.keyId);
      const createdAts = new Set(
        (listPage().body.data as Array<Record<string, unknown>>).map((view) => view.createdAt),
      );
      expect(createdAts.size).toBe(1);

      const walked: string[] = [];
      let cursor: unknown;
      for (let page = 0; page < 3; page += 1) {
        const body = listPage({ limit: '1', ...(cursor === undefined ? {} : { cursor }) }).body;
        walked.push(...idsOf(body));
        cursor = body.nextCursor;
      }

      expect(new Set(walked)).toEqual(new Set(minted));
      expect(cursor).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  test('walks keys minted at distinct times newest first', () => {
    vi.useFakeTimers();
    try {
      const minted: string[] = [];
      for (let index = 0; index < 3; index += 1) {
        vi.setSystemTime(new Date(Date.UTC(2026, 8, 3, 0, 0, index)));
        minted.push(mint(`staggered-${index}`, ['read']).record.keyId);
      }

      const walked: string[] = [];
      let cursor: unknown;
      for (let page = 0; page < 3; page += 1) {
        const body = listPage({ limit: '1', ...(cursor === undefined ? {} : { cursor }) }).body;
        walked.push(...idsOf(body));
        cursor = body.nextCursor;
      }

      expect(walked).toStrictEqual([...minted].reverse());
      expect(cursor).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  test('a hand-built cursor for a position the caller never received still works', () => {
    // By design. A cursor is a position in the sort order, not a capability:
    // it names public data (a timestamp and a key id) and reaches nothing the
    // caller could not reach by paging there.
    const only = mint('ci', ['read']).record;
    const cursor = Buffer.from(`${only.createdAt}|${only.keyId}`).toString('base64url');

    expect(listPage({ cursor }).body).toMatchObject({ data: [], total: 1, hasMore: false });
  });

  const CANONICAL_CURSOR = Buffer.from('2026-09-03T00:00:00.000Z|a1b2c3d4e5f6').toString(
    'base64url',
  );

  test.each([
    ['not base64 at all', '!!!!'],
    ['empty', ''],
    ['missing the separator', Buffer.from('2026-09-03T00:00:00.000Z').toString('base64url')],
    [
      'carrying a key id that is not 12 hex characters',
      Buffer.from('2026-09-03T00:00:00.000Z|nothex').toString('base64url'),
    ],
    [
      'carrying a timestamp that will not parse',
      Buffer.from('not-a-date|a1b2c3d4e5f6').toString('base64url'),
    ],
    [
      'carrying a timestamp outside the range a Date can hold',
      Buffer.from('275760-09-14T00:00:00.000Z|a1b2c3d4e5f6').toString('base64url'),
    ],
    [
      'carrying a timestamp in a shape the store never writes',
      Buffer.from('2026|a1b2c3d4e5f6').toString('base64url'),
    ],
    [
      'carrying a timestamp with no milliseconds',
      Buffer.from('2026-09-03T00:00:00Z|a1b2c3d4e5f6').toString('base64url'),
    ],
    [
      'carrying a timestamp at a non-UTC offset',
      Buffer.from('2026-09-03T02:00:00.000+02:00|a1b2c3d4e5f6').toString('base64url'),
    ],
    ['with trailing characters outside the alphabet', `${CANONICAL_CURSOR}!!!`],
    ['with trailing whitespace', `${CANONICAL_CURSOR} `],
    ['with padding it was not issued with', `${CANONICAL_CURSOR}=`],
    [
      'whose final character carries bits no byte of the payload uses',
      `${CANONICAL_CURSOR.slice(0, -1)}h`,
    ],
    ['repeated in the query string', ['one', 'two']],
  ])('rejects a cursor %s rather than silently restarting the walk', (_label, cursor) => {
    // Restarting from the top would loop a paging client forever, and Node's
    // base64 decoder drops characters outside the alphabet, so every
    // non-canonical spelling above decodes to a payload that would otherwise
    // have been accepted.
    mint('ci', ['read']);

    const { res, body } = listPage({ cursor });

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.status).not.toHaveBeenCalledWith(500);
    expect(body.error).toBe(INVALID_CURSOR_MESSAGE);
  });

  test('accepts the cursor it issued, byte for byte', () => {
    for (let index = 0; index < 3; index += 1) {
      mint(`key-${index}`, ['read']);
    }

    const first = listPage({ limit: '2' }).body;
    const { res } = listPage({ limit: '2', cursor: first.nextCursor });

    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('falls back to the default limit for an unparseable one', () => {
    mint('ci', ['read']);

    expect(listPage({ limit: '10ms' }).body).toMatchObject({ limit: 50, hasMore: false });
  });

  test('reads the first value when limit arrives repeated', () => {
    // A repeated limit has a safe reading and a bad cursor does not, which is
    // why one falls back and the other 400s.
    mint('ci', ['read']);

    expect(listPage({ limit: ['2', '9999'] }).body).toMatchObject({ limit: 2 });
  });

  test('clamps an oversized limit', () => {
    mint('ci', ['read']);

    expect(listPage({ limit: '9999' }).body).toMatchObject({ limit: 200 });
  });

  test('returns an empty envelope before any key exists', () => {
    expect(listPage().body).toMatchObject({ data: [], total: 0, hasMore: false });
  });

  test('links carry the cursor, so a client can walk on the envelope alone', () => {
    for (let index = 0; index < 3; index += 1) {
      mint(`key-${index}`, ['read']);
    }

    const first = listPage({ limit: '2' }).body;
    const links = first._links as { self: string; next?: string };

    expect(links.self).toBe('/api/v1/api-keys?limit=2');
    expect(links.next).toBe(
      `/api/v1/api-keys?limit=2&cursor=${encodeURIComponent(first.nextCursor as string)}`,
    );

    const second = listPage({ limit: '2', cursor: first.nextCursor }).body;
    const secondLinks = second._links as { self: string; next?: string };

    expect(secondLinks.self).toBe(
      `/api/v1/api-keys?limit=2&cursor=${encodeURIComponent(first.nextCursor as string)}`,
    );
    expect(secondLinks).not.toHaveProperty('next');
  });
});

describe('creation', () => {
  test('returns the credential exactly once, on the 201', () => {
    const res = createMockResponse();

    handlerFor('post', '/')(sessionRequest({ body: { name: 'wud-card', scopes: ['read'] } }), res);

    expect(res.status).toHaveBeenCalledWith(201);
    const credential = bodyOf(res).apiKey as string;
    expect(credential).toMatch(/^ddk_[0-9a-f]{12}_[A-Za-z0-9_-]{43}$/);

    // Sliced past the fixed-width prefix rather than split on '_': base64url
    // includes the underscore, so splitting keeps only the secret's first
    // fragment and the assertion silently shrinks to whatever precedes the
    // first one. It also fails outright when that fragment is a single
    // character the response happens to contain elsewhere.
    const secret = credential.slice('ddk_'.length + 12 + 1);
    expect(secret).toHaveLength(43);

    // The list read afterwards must not contain it anywhere.
    const listRes = createMockResponse();
    handlerFor('get', '/')(sessionRequest(), listRes);
    expect(JSON.stringify(bodyOf(listRes))).not.toContain(secret);
    expect(JSON.stringify(bodyOf(listRes))).not.toContain(credential);
  });

  test('records the creation for audit', () => {
    const res = createMockResponse();

    handlerFor('post', '/')(sessionRequest({ body: { name: 'ci', scopes: ['read'] } }), res);

    expect(mockRecordCreated).toHaveBeenCalledWith(bodyOf(res).keyId, 'user:scott', ['read']);
  });

  test('a session-minted key has no parent and never cascades', () => {
    const res = createMockResponse();

    handlerFor('post', '/')(sessionRequest({ body: { name: 'root', scopes: ['read'] } }), res);

    expect(bodyOf(res)).toMatchObject({ parentKeyId: null, createdBy: 'user:scott' });
  });

  test('a key-minted key records its parent', () => {
    const parent = mint('bootstrap', ['api-keys:manage', 'read']);
    const res = createMockResponse();

    handlerFor('post', '/')(
      keyRequest(
        { keyId: parent.record.keyId, scopes: ['api-keys:manage', 'read'] },
        { body: { name: 'child', scopes: ['read'] } },
      ),
      res,
    );

    expect(bodyOf(res)).toMatchObject({
      parentKeyId: parent.record.keyId,
      createdBy: `api-key:${parent.record.keyId}`,
    });
  });

  test('carries an optional per-key rate limit through', () => {
    const res = createMockResponse();

    handlerFor('post', '/')(
      sessionRequest({ body: { name: 'chatty', scopes: ['read'], rateLimitMax: 25 } }),
      res,
    );

    expect(bodyOf(res)).toMatchObject({ rateLimitMax: 25 });
  });

  test('falls back to an unnamed key being rejected rather than defaulted', () => {
    const res = createMockResponse();

    handlerFor('post', '/')(sessionRequest({ body: { scopes: ['read'] } }), res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test.each([
    ['an unknown scope', { name: 'x', scopes: ['containers:updates'] }],
    ['a non-string scope', { name: 'x', scopes: [7] }],
    ['scopes that are not an array', { name: 'x', scopes: 'read' }],
    ['a missing body', undefined],
  ])('rejects %s with 400', (_label, body) => {
    const res = createMockResponse();

    handlerFor('post', '/')(sessionRequest({ body }), res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('rejects an expiry in the past with 400', () => {
    const res = createMockResponse();

    handlerFor('post', '/')(
      sessionRequest({
        body: { name: 'x', scopes: ['read'], expiresAt: '2020-01-01T00:00:00.000Z' },
      }),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('rethrows an unexpected store failure rather than answering 400', () => {
    const failure = new Error('loki exploded');
    const spy = vi.spyOn(apiKeyStore, 'createApiKey').mockImplementation(() => {
      throw failure;
    });
    try {
      expect(() =>
        handlerFor('post', '/')(
          sessionRequest({ body: { name: 'x', scopes: ['read'] } }),
          createMockResponse(),
        ),
      ).toThrow(failure);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('the minting ceiling', () => {
  test('a key cannot mint scopes it does not hold', () => {
    const caller = mint('limited', ['api-keys:manage', 'read']);
    const res = createMockResponse();

    handlerFor('post', '/')(
      keyRequest(
        { keyId: caller.record.keyId, scopes: ['api-keys:manage', 'read'] },
        { body: { name: 'wider', scopes: ['admin'] } },
      ),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(bodyOf(res)).toMatchObject({
      error: SCOPE_CEILING_MESSAGE,
      details: { scopes: ['admin'] },
    });
  });

  test('a key holding admin cannot mint api-keys:manage without holding it', () => {
    // admin implies every scope except this one, which is the whole reason
    // api-keys:manage is separate.
    const caller = mint('admin-manager', ['api-keys:manage', 'admin']);
    const res = createMockResponse();

    handlerFor('post', '/')(
      keyRequest(
        { keyId: caller.record.keyId, scopes: ['admin'] },
        { body: { name: 'escalated', scopes: ['api-keys:manage'] } },
      ),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('a key holding api-keys:manage can mint it', () => {
    const caller = mint('bootstrap', ['api-keys:manage']);
    const res = createMockResponse();

    handlerFor('post', '/')(
      keyRequest(
        { keyId: caller.record.keyId, scopes: ['api-keys:manage'] },
        { body: { name: 'peer', scopes: ['api-keys:manage'] } },
      ),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('an admin key can mint any ordinary scope, because admin implies them', () => {
    const caller = mint('ops', ['api-keys:manage', 'admin']);
    const res = createMockResponse();

    handlerFor('post', '/')(
      keyRequest(
        { keyId: caller.record.keyId, scopes: ['api-keys:manage', 'admin'] },
        { body: { name: 'narrow', scopes: ['read', 'containers:update'] } },
      ),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('a session is not subject to the ceiling', () => {
    const res = createMockResponse();

    handlerFor('post', '/')(
      sessionRequest({ body: { name: 'anything', scopes: ['admin', 'api-keys:manage'] } }),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('an expiring key cannot mint a never-expiring child', () => {
    const caller = mint('short-lived', ['api-keys:manage', 'read'], {
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const res = createMockResponse();

    handlerFor('post', '/')(
      keyRequest(
        { keyId: caller.record.keyId, scopes: ['api-keys:manage', 'read'] },
        { body: { name: 'immortal', scopes: ['read'] } },
      ),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(bodyOf(res)).toMatchObject({ error: EXPIRY_CEILING_MESSAGE });
  });

  test('an expiring key cannot mint a longer-lived child', () => {
    const caller = mint('short-lived', ['api-keys:manage', 'read'], {
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const res = createMockResponse();

    handlerFor('post', '/')(
      keyRequest(
        { keyId: caller.record.keyId, scopes: ['api-keys:manage', 'read'] },
        {
          body: {
            name: 'longer',
            scopes: ['read'],
            expiresAt: new Date(Date.now() + 600_000).toISOString(),
          },
        },
      ),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('an expiring key can mint a shorter-lived child', () => {
    const caller = mint('short-lived', ['api-keys:manage', 'read'], {
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    });
    const res = createMockResponse();

    handlerFor('post', '/')(
      keyRequest(
        { keyId: caller.record.keyId, scopes: ['api-keys:manage', 'read'] },
        {
          body: {
            name: 'shorter',
            scopes: ['read'],
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          },
        },
      ),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('a never-expiring key may mint a never-expiring child', () => {
    const caller = mint('eternal', ['api-keys:manage', 'read']);
    const res = createMockResponse();

    handlerFor('post', '/')(
      keyRequest(
        { keyId: caller.record.keyId, scopes: ['api-keys:manage', 'read'] },
        { body: { name: 'child', scopes: ['read'] } },
      ),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('an unparseable requested expiry falls through to the store validator', () => {
    const caller = mint('short-lived', ['api-keys:manage', 'read'], {
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    });
    const res = createMockResponse();

    handlerFor('post', '/')(
      keyRequest(
        { keyId: caller.record.keyId, scopes: ['api-keys:manage', 'read'] },
        { body: { name: 'bad', scopes: ['read'], expiresAt: 'not-a-date' } },
      ),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('a caller key that no longer exists is not treated as expiring', () => {
    const res = createMockResponse();

    handlerFor('post', '/')(
      keyRequest(
        { keyId: 'ffffffffffff', scopes: ['api-keys:manage', 'read'] },
        { body: { name: 'orphan', scopes: ['read'] } },
      ),
      res,
    );

    // The store still refuses, because the parent it would record is unknown.
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('revocation', () => {
  test('cascades three deep in one call and reports the count', () => {
    const root = mint('root', ['api-keys:manage']);
    const child = apiKeyStore.createApiKey({
      name: 'child',
      scopes: ['read'],
      createdBy: { kind: 'api-key', keyId: root.record.keyId },
    });
    const grandchild = apiKeyStore.createApiKey({
      name: 'grandchild',
      scopes: ['read'],
      createdBy: { kind: 'api-key', keyId: child.record.keyId },
    });
    const res = createMockResponse();

    handlerFor('delete', '/:keyId')(sessionRequest({ params: { keyId: root.record.keyId } }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(bodyOf(res).cascadeCount).toBe(3);
    expect(bodyOf(res).revokedKeyIds).toStrictEqual([
      root.record.keyId,
      child.record.keyId,
      grandchild.record.keyId,
    ]);
  });

  test('a session-minted key is never cascaded by an unrelated revocation', () => {
    const root = mint('root', ['api-keys:manage']);
    const sibling = mint('sibling', ['read']);
    const res = createMockResponse();

    handlerFor('delete', '/:keyId')(sessionRequest({ params: { keyId: root.record.keyId } }), res);

    expect(bodyOf(res).revokedKeyIds).toStrictEqual([root.record.keyId]);
    expect(apiKeyStore.findApiKeyById(sibling.record.keyId)?.revokedAt).toBeNull();
  });

  test('closes the SSE streams every revoked key had open', () => {
    const root = mint('root', ['api-keys:manage']);
    const child = apiKeyStore.createApiKey({
      name: 'child',
      scopes: ['read'],
      createdBy: { kind: 'api-key', keyId: root.record.keyId },
    });

    handlerFor('delete', '/:keyId')(
      sessionRequest({ params: { keyId: root.record.keyId } }),
      createMockResponse(),
    );

    // The whole cascade, not just the named key: the child's stream was opened
    // with a credential that is no longer valid either.
    expect(mockCloseSseClients).toHaveBeenCalledWith([root.record.keyId, child.record.keyId]);
  });

  test('does not touch the SSE streams when the revocation is refused', () => {
    const res = createMockResponse();

    handlerFor('delete', '/:keyId')(sessionRequest({ params: { keyId: 'nosuchkey000' } }), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockCloseSseClients).not.toHaveBeenCalled();
  });

  test('records the revocation for audit', () => {
    const created = mint('ci', ['read']);

    handlerFor('delete', '/:keyId')(
      sessionRequest({ params: { keyId: created.record.keyId } }),
      createMockResponse(),
    );

    expect(mockRecordRevoked).toHaveBeenCalledWith(created.record.keyId, 'user:scott', [
      created.record.keyId,
    ]);
  });

  test('a key cannot revoke itself', () => {
    const caller = mint('self', ['api-keys:manage']);
    const res = createMockResponse();

    handlerFor('delete', '/:keyId')(
      keyRequest(
        { keyId: caller.record.keyId, scopes: ['api-keys:manage'] },
        { params: { keyId: caller.record.keyId } },
      ),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(bodyOf(res)).toMatchObject({ error: SELF_REVOKE_MESSAGE });
  });

  test('a key cannot revoke the key that minted it', () => {
    // Either would let a compromised key cut the branch it is being hunted
    // from.
    const parent = mint('parent', ['api-keys:manage']);
    const child = apiKeyStore.createApiKey({
      name: 'child',
      scopes: ['api-keys:manage'],
      createdBy: { kind: 'api-key', keyId: parent.record.keyId },
    });
    const res = createMockResponse();

    handlerFor('delete', '/:keyId')(
      keyRequest(
        {
          keyId: child.record.keyId,
          scopes: ['api-keys:manage'],
          parentKeyId: parent.record.keyId,
        },
        { params: { keyId: parent.record.keyId } },
      ),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(bodyOf(res)).toMatchObject({ error: ANCESTOR_REVOKE_MESSAGE });
  });

  test('a key cannot revoke a grandparent, only the immediate parent was checked', () => {
    const root = mint('root', ['api-keys:manage']);
    const child = apiKeyStore.createApiKey({
      name: 'child',
      scopes: ['api-keys:manage'],
      createdBy: { kind: 'api-key', keyId: root.record.keyId },
    });
    const grandchild = apiKeyStore.createApiKey({
      name: 'grandchild',
      scopes: ['api-keys:manage'],
      createdBy: { kind: 'api-key', keyId: child.record.keyId },
    });
    const res = createMockResponse();

    handlerFor('delete', '/:keyId')(
      keyRequest(
        {
          keyId: grandchild.record.keyId,
          scopes: ['api-keys:manage'],
          parentKeyId: child.record.keyId,
        },
        { params: { keyId: root.record.keyId } },
      ),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(bodyOf(res)).toMatchObject({ error: ANCESTOR_REVOKE_MESSAGE });
    // Nothing was revoked: cutting the root would take the whole chain,
    // including the caller, which is exactly the escape the rule blocks.
    for (const keyId of [root.record.keyId, child.record.keyId, grandchild.record.keyId]) {
      expect(apiKeyStore.findApiKeyById(keyId)?.revokedAt).toBeNull();
    }
    expect(mockRecordRevoked).not.toHaveBeenCalled();
  });

  test('the walk terminates on a parent chain that loops', () => {
    // Not reachable through the API — a parent always predates its child — but
    // the chain is read back off a JSON file on disk, and an unbounded walk
    // over a corrupted one would hang the process rather than answer a request.
    const first = mint('first', ['api-keys:manage']);
    const second = mint('second', ['api-keys:manage']);
    const target = mint('target', ['read']);
    setStoredParent(first.record.keyId, second.record.keyId);
    setStoredParent(second.record.keyId, first.record.keyId);
    const res = createMockResponse();

    handlerFor('delete', '/:keyId')(
      keyRequest(
        {
          keyId: first.record.keyId,
          scopes: ['api-keys:manage'],
          parentKeyId: second.record.keyId,
        },
        { params: { keyId: target.record.keyId } },
      ),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('a caller whose parent has been pruned from the store still revokes', () => {
    const caller = mint('orphan', ['api-keys:manage']);
    const target = mint('target', ['read']);
    const res = createMockResponse();

    handlerFor('delete', '/:keyId')(
      keyRequest(
        {
          keyId: caller.record.keyId,
          scopes: ['api-keys:manage'],
          parentKeyId: 'ffffffffffff',
        },
        { params: { keyId: target.record.keyId } },
      ),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('a key may revoke an unrelated key', () => {
    const caller = mint('manager', ['api-keys:manage']);
    const target = mint('target', ['read']);
    const res = createMockResponse();

    handlerFor('delete', '/:keyId')(
      keyRequest(
        { keyId: caller.record.keyId, scopes: ['api-keys:manage'] },
        { params: { keyId: target.record.keyId } },
      ),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockRecordRevoked).toHaveBeenCalledWith(
      target.record.keyId,
      `api-key:${caller.record.keyId}`,
      [target.record.keyId],
    );
  });

  test('an unknown key is a 404', () => {
    const res = createMockResponse();

    handlerFor('delete', '/:keyId')(sessionRequest({ params: { keyId: 'ffffffffffff' } }), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(bodyOf(res)).toMatchObject({ error: UNKNOWN_KEY_MESSAGE });
  });

  test('reads a repeated path parameter as its first value', () => {
    const created = mint('ci', ['read']);
    const res = createMockResponse();

    handlerFor('delete', '/:keyId')(
      sessionRequest({ params: { keyId: [created.record.keyId, 'other'] } }),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('principal fallbacks', () => {
  test('attributes a creation with no principal to an unknown user', () => {
    const res = createMockResponse();

    handlerFor('post', '/')(createMockRequest({ body: { name: 'orphan', scopes: ['read'] } }), res);

    expect(bodyOf(res)).toMatchObject({ createdBy: 'user:unknown' });
  });

  test('attributes a revocation with no principal to an unknown user', () => {
    const created = mint('ci', ['read']);

    handlerFor('delete', '/:keyId')(
      createMockRequest({ params: { keyId: created.record.keyId } }),
      createMockResponse(),
    );

    expect(mockRecordRevoked).toHaveBeenCalledWith(created.record.keyId, 'user:unknown', [
      created.record.keyId,
    ]);
  });
});
