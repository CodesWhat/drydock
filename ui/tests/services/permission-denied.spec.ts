const toasts = vi.hoisted(() => ({ warning: vi.fn() }));
vi.mock('@/composables/useToast', () => ({ useToast: () => toasts }));
vi.mock('@/boot/i18n', () => ({ i18n: { global: { t: (key: string) => key } } }));

describe('installPermissionDeniedToast', () => {
  const realFetch = globalThis.fetch;
  let upstream: ReturnType<typeof vi.fn>;
  let install: () => void;

  beforeEach(async () => {
    vi.resetModules();
    toasts.warning.mockReset();
    upstream = vi.fn();
    globalThis.fetch = upstream as unknown as typeof fetch;
    ({ installPermissionDeniedToast: install } = await import('@/services/permission-denied'));
    install();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('toasts a role denial and returns the response untouched', async () => {
    const response = new Response(JSON.stringify({ error: 'Role does not permit this action' }), {
      status: 403,
    });
    upstream.mockResolvedValue(response);
    const result = await fetch('/api/v1/containers/x/update', { method: 'POST' });
    expect(result).toBe(response);
    expect(toasts.warning).toHaveBeenCalledWith(
      'appShell.layout.permissionDenied.title',
      'appShell.layout.permissionDenied.body',
    );
    expect(await result.json()).toEqual({ error: 'Role does not permit this action' });
  });

  it('stays quiet for other 403s, non-JSON bodies and other statuses', async () => {
    upstream.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'csrf' }), { status: 403 }),
    );
    await fetch('/a');
    upstream.mockResolvedValueOnce(new Response('nope', { status: 403 }));
    await fetch('/b');
    upstream.mockResolvedValueOnce(new Response('null', { status: 403 }));
    await fetch('/c');
    upstream.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    await fetch('/d');
    expect(toasts.warning).not.toHaveBeenCalled();
  });

  it('installs once', () => {
    const wrapped = globalThis.fetch;
    install();
    expect(globalThis.fetch).toBe(wrapped);
  });
});
