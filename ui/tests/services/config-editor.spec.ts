import { getWatcherEditor, saveWatcherEdits } from '@/services/config-editor';

describe('watcher configuration editor service', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads only the explicit session-only snapshot endpoint', async () => {
    const body = { available: false, watchers: [] };
    const fetch = vi.fn().mockResolvedValue(Response.json(body));
    vi.stubGlobal('fetch', fetch);
    await expect(getWatcherEditor()).resolves.toEqual(body);
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/config/editor/watchers',
      expect.objectContaining({ credentials: 'include' }),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('preserves conflict and saved-but-unapplied outcomes without retrying', async () => {
    const request = {
      revision: 'old',
      changes: [{ path: ['watcher', 'local', 'cron'], operation: 'set' as const, value: '' }],
    };
    const body = {
      saved: false,
      applied: false,
      changedKeys: [],
      restartRequired: [],
      errors: [{ path: 'document', envKey: 'DD_CONFIG_FILE', message: 'Configuration changed' }],
    };
    const fetch = vi.fn().mockResolvedValue(Response.json(body, { status: 409 }));
    vi.stubGlobal('fetch', fetch);
    await expect(saveWatcherEdits(request)).resolves.toEqual({ status: 409, ...body });
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/config/editor/watchers',
      expect.objectContaining({
        method: 'PATCH',
        credentials: 'include',
        body: JSON.stringify(request),
      }),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([403, 404, 429, 500])(
    'reports snapshot HTTP%s without another request',
    async (status) => {
      const fetch = vi.fn().mockResolvedValue(Response.json({ error: 'Unavailable' }, { status }));
      vi.stubGlobal('fetch', fetch);
      await expect(getWatcherEditor()).rejects.toMatchObject({ status });
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    null,
    {},
    { saved: true },
    { saved: true, applied: true },
    { saved: true, applied: true, errors: 'invalid' },
  ])('rejects incomplete write envelopes %j', async (body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(body, { status: 500 })));
    await expect(saveWatcherEdits({ revision: 'first', changes: [] })).rejects.toMatchObject({
      status: 500,
    });
  });

  it('does not discard audit failures in an otherwise applied200 outcome', async () => {
    const body = {
      saved: true,
      applied: true,
      revision: 'next',
      changedKeys: ['DD_WATCHER_LOCAL_CRON'],
      restartRequired: [],
      errors: [{ path: 'document', envKey: 'DD_CONFIG_FILE', message: 'Audit failed' }],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(body)));
    await expect(saveWatcherEdits({ revision: 'first', changes: [] })).resolves.toEqual({
      status: 200,
      ...body,
    });
  });
});
