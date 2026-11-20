import { listPortwingKeys, registerPortwingKey, revokePortwingKey } from '@/services/portwing-key';
import { ApiError } from '@/utils/error';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('portwing key service', () => {
  it('lists keys', async () => {
    const rows = [{ keyId: 'a', label: 'x', pubkey: 'p', createdAt: 'c', revokedAt: null }];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(rows)));
    await expect(listPortwingKeys()).resolves.toEqual(rows);
    expect(fetch).toHaveBeenCalledWith('/api/v1/portwing/keys', { credentials: 'include' });
  });

  it('treats a non-array list body as empty', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ nope: true })));
    await expect(listPortwingKeys()).resolves.toEqual([]);
  });

  it('turns 401 and 403 into a forbidden ApiError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 403 })));
    await expect(listPortwingKeys()).rejects.toMatchObject({ status: 403 });
    await expect(listPortwingKeys()).rejects.toBeInstanceOf(ApiError);
  });

  it('uses the server error text, then falls back to the localized message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ error: 'already active' }, { status: 409 })),
    );
    await expect(registerPortwingKey({ pubkeyBase64: 'k', label: 'l' })).rejects.toThrow(
      'already active',
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>', { status: 502 })));
    await expect(listPortwingKeys()).rejects.toThrow('(HTTP 502)');
  });

  it('posts a registration', async () => {
    const created = { keyId: 'k1', label: 'l', createdAt: 'c' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(created, { status: 201 })));
    await expect(registerPortwingKey({ pubkeyBase64: 'pk', label: 'l' })).resolves.toEqual(created);
    expect(fetch).toHaveBeenCalledWith('/api/v1/portwing/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ pubkeyBase64: 'pk', label: 'l' }),
    });
  });

  it('revokes a key and surfaces failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(revokePortwingKey('0123456789abcdef')).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledWith('/api/v1/portwing/keys/0123456789abcdef', {
      method: 'DELETE',
      credentials: 'include',
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('null', { status: 404 })));
    await expect(revokePortwingKey('0123456789abcdef')).rejects.toThrow('(HTTP 404)');
  });
});
