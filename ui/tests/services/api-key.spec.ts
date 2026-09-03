import {
  API_KEY_PAGE_SIZE,
  API_SCOPES,
  createApiKey,
  listApiKeys,
  revokeApiKey,
} from '@/services/api-key';

const record = {
  keyId: 'a1b2c3d4e5f6',
  name: 'ci',
  displayPrefix: 'ddk_a1b2c3d4e5f6…',
  scopes: ['read'],
  status: 'active',
  createdAt: '2026-09-01T00:00:00.000Z',
  createdBy: 'user:scott',
  parentKeyId: null,
  expiresAt: null,
  lastUsedAt: null,
  revokedAt: null,
};

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    headers: { get: () => 'application/json' },
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe('api-key service', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });
  afterEach(() => vi.resetAllMocks());

  it('exposes the six scopes the API enforces', () => {
    expect([...API_SCOPES]).toStrictEqual([
      'read',
      'containers:watch',
      'containers:update',
      'triggers:test',
      'admin',
      'api-keys:manage',
    ]);
  });

  describe('listApiKeys', () => {
    it('keeps the page metadata, so the caller can tell there is more', async () => {
      vi.mocked(fetch).mockResolvedValue(
        jsonResponse({ data: [record], total: 120, hasMore: true, nextCursor: 'cursor-50' }),
      );

      await expect(listApiKeys()).resolves.toStrictEqual({
        data: [record],
        total: 120,
        hasMore: true,
        nextCursor: 'cursor-50',
      });
      expect(fetch).toHaveBeenCalledWith(`/api/v1/api-keys?limit=${API_KEY_PAGE_SIZE}`, {
        credentials: 'include',
      });
    });

    it('asks for the page it was given, cursor and all', async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ data: [], total: 120 }));

      await listApiKeys({ limit: 200, cursor: 'cursor+with/reserved=chars' });

      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/api-keys?limit=200&cursor=cursor%2Bwith%2Freserved%3Dchars',
        { credentials: 'include' },
      );
    });

    it('returns an empty page when the envelope carries no data array', async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ total: 0 }));

      await expect(listApiKeys()).resolves.toStrictEqual({ data: [], total: 0, hasMore: false });
    });

    it('counts what arrived when the server omits the total', async () => {
      // An older server, or a proxy that rewrote the body. Counting what
      // arrived is better than reporting a total of zero next to a full table.
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ data: [record] }));

      await expect(listApiKeys({ cursor: 'cursor-50' })).resolves.toStrictEqual({
        data: [record],
        total: 1,
        hasMore: false,
      });
    });

    it('reports no more pages when the server claims more but sends no cursor', async () => {
      // There would be nothing to ask for, and repeating the cursor-less
      // request would hand the caller the rows it already has.
      vi.mocked(fetch).mockResolvedValue(
        jsonResponse({ data: [record], total: 120, hasMore: true }),
      );

      await expect(listApiKeys()).resolves.toStrictEqual({
        data: [record],
        total: 120,
        hasMore: false,
      });
    });

    it('ignores a cursor that is not a string', async () => {
      vi.mocked(fetch).mockResolvedValue(
        jsonResponse({ data: [record], total: 120, hasMore: true, nextCursor: 7 }),
      );

      await expect(listApiKeys()).resolves.toStrictEqual({
        data: [record],
        total: 120,
        hasMore: false,
      });
    });

    it('surfaces the server error message', async () => {
      vi.mocked(fetch).mockResolvedValue(
        jsonResponse(
          { error: 'API key is missing the required scope' },
          { ok: false, status: 403 },
        ),
      );

      await expect(listApiKeys()).rejects.toThrow('API key is missing the required scope');
    });

    it('falls back to a status message when the error body is unreadable', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 502,
        json: vi.fn().mockRejectedValue(new Error('not json')),
      } as unknown as Response);

      await expect(listApiKeys()).rejects.toThrow('Failed to load API keys (HTTP 502)');
    });

    it('falls back to a status message when the error body has no error string', async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ detail: 5 }, { ok: false, status: 500 }));

      await expect(listApiKeys()).rejects.toThrow('Failed to load API keys (HTTP 500)');
    });
  });

  describe('createApiKey', () => {
    it('posts the minimal body and returns the credential', async () => {
      const created = { ...record, apiKey: `ddk_a1b2c3d4e5f6_${'A'.repeat(43)}` };
      vi.mocked(fetch).mockResolvedValue(jsonResponse(created, { status: 201 }));

      await expect(createApiKey({ name: 'ci', scopes: ['read'] })).resolves.toStrictEqual(created);
      expect(fetch).toHaveBeenCalledWith('/api/v1/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: 'ci', scopes: ['read'] }),
      });
    });

    it('includes an expiry and a rate limit when given', async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ ...record, apiKey: 'ddk_x' }));

      await createApiKey({
        name: 'ci',
        scopes: ['read'],
        expiresAt: '2027-01-01T00:00:00.000Z',
        rateLimitMax: 25,
      });

      expect(vi.mocked(fetch).mock.calls[0][1]?.body).toBe(
        JSON.stringify({
          name: 'ci',
          scopes: ['read'],
          expiresAt: '2027-01-01T00:00:00.000Z',
          rateLimitMax: 25,
        }),
      );
    });

    it.each([
      ['a null expiry', { expiresAt: null }],
      ['an empty expiry', { expiresAt: '' }],
      ['an undefined rate limit', { rateLimitMax: undefined }],
    ])('omits %s rather than sending it', async (_label, extra) => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ ...record, apiKey: 'ddk_x' }));

      await createApiKey({ name: 'ci', scopes: ['read'], ...extra });

      expect(vi.mocked(fetch).mock.calls[0][1]?.body).toBe(
        JSON.stringify({ name: 'ci', scopes: ['read'] }),
      );
    });

    it('surfaces a ceiling refusal verbatim', async () => {
      vi.mocked(fetch).mockResolvedValue(
        jsonResponse(
          { error: 'An API key cannot grant scopes it does not hold itself' },
          { ok: false, status: 403 },
        ),
      );

      await expect(createApiKey({ name: 'wider', scopes: ['admin'] })).rejects.toThrow(
        'An API key cannot grant scopes it does not hold itself',
      );
    });
  });

  describe('revokeApiKey', () => {
    it('sends the destructive-action confirmation header', async () => {
      vi.mocked(fetch).mockResolvedValue(
        jsonResponse({ keyId: record.keyId, revokedKeyIds: [record.keyId], cascadeCount: 1 }),
      );

      await expect(revokeApiKey(record.keyId)).resolves.toStrictEqual({
        keyId: record.keyId,
        revokedKeyIds: [record.keyId],
        cascadeCount: 1,
      });
      expect(fetch).toHaveBeenCalledWith(`/api/v1/api-keys/${record.keyId}`, {
        method: 'DELETE',
        headers: { 'X-DD-Confirm-Action': 'api-key-revoke' },
        credentials: 'include',
      });
    });

    it('escapes the key id into the path', async () => {
      vi.mocked(fetch).mockResolvedValue(
        jsonResponse({ keyId: 'x', revokedKeyIds: ['x'], cascadeCount: 1 }),
      );

      await revokeApiKey('../settings');

      expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/v1/api-keys/..%2Fsettings');
    });

    it('surfaces a 404 for an unknown key', async () => {
      vi.mocked(fetch).mockResolvedValue(
        jsonResponse({ error: 'API key not found' }, { ok: false, status: 404 }),
      );

      await expect(revokeApiKey('ffffffffffff')).rejects.toThrow('API key not found');
    });
  });
});
