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

  it.each([400, 409])('preserves HTTP%s write refusals without retrying', async (status) => {
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
    const fetch = vi.fn().mockResolvedValue(Response.json(body, { status }));
    vi.stubGlobal('fetch', fetch);
    await expect(saveWatcherEdits(request)).resolves.toEqual({ status, ...body });
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

  it.each([
    [401, 'Unauthorized', ''],
    [403, '<html>Forbidden</html>', 'text/html'],
    [429, 'Too many requests', 'text/plain'],
    [502, 'Bad gateway', 'text/plain'],
  ])('preserves HTTP%s when the write response is not JSON', async (status, body, contentType) => {
    const response = new Response(body as string, { status: status as number });
    response.headers.set('content-type', contentType as string);
    const fetch = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', fetch);
    await expect(saveWatcherEdits({ revision: 'first', changes: [] })).rejects.toMatchObject({
      status,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps malformed successful responses uncertain', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('invalid JSON', { headers: { 'content-type': 'application/json' } }),
        ),
    );
    await expect(saveWatcherEdits({ revision: 'first', changes: [] })).rejects.toThrow(
      'returned invalid JSON',
    );
  });

  it.each([
    { reload: {} },
    { reload: null },
    { reload: { errors: null } },
    { reload: { errors: 'invalid' } },
    { restartRequired: undefined },
    { restartRequired: null },
    { restartRequired: 'invalid' },
  ])('rejects malformed consumed outcome collections %j', async (invalid) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          saved: true,
          applied: true,
          changedKeys: [],
          restartRequired: [],
          errors: [],
          ...invalid,
        }),
      ),
    );
    await expect(saveWatcherEdits({ revision: 'first', changes: [] })).rejects.toMatchObject({
      status: 200,
    });
  });

  it('preserves valid nested reload errors', async () => {
    const errors = [{ path: 'document', envKey: 'DD_CONFIG_FILE', message: 'Reload incomplete' }];
    const body = {
      saved: true,
      applied: false,
      changedKeys: [],
      restartRequired: [],
      errors,
      reload: { applied: false, errors },
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(body)));
    await expect(saveWatcherEdits({ revision: 'first', changes: [] })).resolves.toEqual({
      status: 200,
      ...body,
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
