import { downloadDebugDump } from '@/services/debug';

describe('Debug Service', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('requests debug dump and returns blob + filename from response headers', async () => {
    const blob = new Blob(['{"ok":true}'], { type: 'application/json' });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      blob: vi.fn().mockResolvedValue(blob),
      headers: {
        get: vi.fn((name: string) =>
          name.toLowerCase() === 'content-disposition'
            ? 'attachment; filename="drydock-debug-dump-2026-03-18.json"'
            : null,
        ),
      },
    });

    const result = await downloadDebugDump();

    expect(global.fetch).toHaveBeenCalledWith('/api/v1/debug/dump', {
      credentials: 'include',
      headers: {
        Accept: 'application/json',
      },
    });
    expect(result.blob).toBe(blob);
    expect(result.filename).toBe('drydock-debug-dump-2026-03-18.json');
  });

  it('falls back to default filename when content-disposition is missing', async () => {
    const blob = new Blob(['{"ok":true}'], { type: 'application/json' });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      blob: vi.fn().mockResolvedValue(blob),
      headers: {
        get: vi.fn(() => null),
      },
    });

    const result = await downloadDebugDump();
    expect(result.filename).toBe('drydock-debug-dump.json');
  });

  it('decodes UTF-8 filenames and falls back to the raw value when decoding fails', async () => {
    const blob = new Blob(['{"ok":true}'], { type: 'application/json' });
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        blob: vi.fn().mockResolvedValue(blob),
        headers: {
          get: vi.fn(() => "attachment; filename*=UTF-8''drydock%20debug%20dump.json"),
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        blob: vi.fn().mockResolvedValue(blob),
        headers: {
          get: vi.fn(() => "attachment; filename*=UTF-8''drydock%ZZdebug.json"),
        },
      });

    await expect(downloadDebugDump()).resolves.toMatchObject({
      blob,
      filename: 'drydock debug dump.json',
    });
    await expect(downloadDebugDump()).resolves.toMatchObject({
      blob,
      filename: 'drydock%ZZdebug.json',
    });
  });

  it('falls back to the plain filename parameter', async () => {
    const blob = new Blob(['{"ok":true}'], { type: 'application/json' });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      blob: vi.fn().mockResolvedValue(blob),
      headers: {
        get: vi.fn(() => 'attachment; filename=drydock-debug-dump-plain.json'),
      },
    });

    const result = await downloadDebugDump();
    expect(result.filename).toBe('drydock-debug-dump-plain.json');
  });

  it('returns no filename when the content-disposition header has no filename token', async () => {
    const blob = new Blob(['{"ok":true}'], { type: 'application/json' });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      blob: vi.fn().mockResolvedValue(blob),
      headers: {
        get: vi.fn(() => 'attachment; creation-date="Wed, 18 Mar 2026 12:00:00 GMT"'),
      },
    });

    const result = await downloadDebugDump();
    expect(result.filename).toBe('drydock-debug-dump.json');
  });

  it('throws API error when request fails', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      json: vi.fn().mockResolvedValue({ error: 'Unable to generate debug dump' }),
      headers: {
        get: vi.fn(() => null),
      },
    });

    await expect(downloadDebugDump()).rejects.toThrow('Unable to generate debug dump');
  });

  it('falls back to HTTP status when the error payload is blank', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      json: vi.fn().mockResolvedValue({ error: '   ' }),
      headers: {
        get: vi.fn(() => null),
      },
    });

    await expect(downloadDebugDump()).rejects.toThrow('HTTP 500');
  });

  it('falls back to HTTP status when the error payload is not usable', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 502,
      json: vi.fn().mockRejectedValue(new Error('bad json')),
      headers: {
        get: vi.fn(() => null),
      },
    });

    await expect(downloadDebugDump()).rejects.toThrow('HTTP 502');
  });
});
