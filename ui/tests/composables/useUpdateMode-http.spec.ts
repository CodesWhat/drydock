describe('update mode with real settings error responses', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.resetModules();
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('exposes the HTTP load error and retries without treating the default mode as loaded', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response('null', { status: 503 }))
      .mockResolvedValueOnce(Response.json({ internetlessMode: true, updateMode: 'notify' }));
    const { useUpdateMode } = await import('@/composables/useUpdateMode');
    const state = useUpdateMode({ autoLoad: false });
    await state.loadUpdateMode();
    expect(state.error.value).toBe('HTTP 503');
    expect(state.loaded.value).toBe(false);
    expect(state.updateMode.value).toBe('manual');

    await state.loadUpdateMode();
    expect(state.loaded.value).toBe(true);
    expect(state.updateMode.value).toBe('notify');
    expect(state.internetlessMode.value).toBe(true);
    expect(state.error.value).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenLastCalledWith('/api/v1/settings', { credentials: 'include' });
  });

  it('keeps the saved mode after a null-body save failure and allows a later save', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ internetlessMode: false, updateMode: 'notify' }))
      .mockResolvedValueOnce(new Response('null', { status: 503 }))
      .mockResolvedValueOnce(Response.json({ internetlessMode: false, updateMode: 'manual' }));
    const { useUpdateMode } = await import('@/composables/useUpdateMode');
    const state = useUpdateMode({ autoLoad: false });
    await state.loadUpdateMode();
    await expect(state.setUpdateMode('auto')).rejects.toThrow('HTTP 503');
    expect(state.updateMode.value).toBe('notify');
    expect(state.error.value).toBe('HTTP 503');
    expect(state.loaded.value).toBe(true);
    expect(state.saving.value).toBe(false);

    await state.setUpdateMode('manual');
    expect(state.updateMode.value).toBe('manual');
    expect(state.error.value).toBeNull();
    expect(state.saving.value).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/v1/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ updateMode: 'auto' }),
    });
  });
});
