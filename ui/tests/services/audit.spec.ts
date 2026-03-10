import { getAuditLog } from '@/services/audit';

describe('audit service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('calls GET /api/audit with a default limit when no params are provided', async () => {
    const mockResponse = { data: [], total: 0, limit: 50, offset: 0, hasMore: false };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const result = await getAuditLog();

    expect(global.fetch).toHaveBeenCalledWith('/api/audit?limit=50', { credentials: 'include' });
    expect(result).toEqual({
      ...mockResponse,
      entries: [],
    });
  });

  it('uses default limit for page-derived offset when limit is not provided', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [], total: 0 }),
    });

    await getAuditLog({ page: 2 });

    const calledUrl = (global.fetch as any).mock.calls[0][0];
    expect(calledUrl).toContain('offset=50');
    expect(calledUrl).toContain('limit=50');
  });

  it('appends query parameters', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [], total: 0 }),
    });

    await getAuditLog({
      page: 2,
      limit: 10,
      action: 'update-applied',
      container: 'nginx',
      from: '2026-01-01',
      to: '2026-01-31',
    });

    const calledUrl = (global.fetch as any).mock.calls[0][0];
    expect(calledUrl).toContain('offset=10');
    expect(calledUrl).toContain('limit=10');
    expect(calledUrl).toContain('action=update-applied');
    expect(calledUrl).toContain('container=nginx');
    expect(calledUrl).toContain('from=2026-01-01');
    expect(calledUrl).toContain('to=2026-01-31');
  });

  it('prefers explicit offset over page-derived offset', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [], total: 0 }),
    });

    await getAuditLog({
      page: 8,
      offset: 5,
      limit: 25,
    });

    const calledUrl = (global.fetch as any).mock.calls[0][0];
    expect(calledUrl).toContain('offset=5');
    expect(calledUrl).toContain('limit=25');
  });

  it('normalizes negative page offsets to zero', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [], total: 0 }),
    });

    await getAuditLog({
      page: 0,
      limit: 10,
    });

    const calledUrl = (global.fetch as any).mock.calls[0][0];
    expect(calledUrl).toContain('offset=0');
  });

  it('maps items payload to entries', async () => {
    const items = [{ id: 'evt-1' }];
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ items, total: 1 }),
    });

    const result = await getAuditLog();
    expect(result.entries).toEqual(items);
  });

  it('maps entries payload to entries', async () => {
    const entries = [{ id: 'evt-2' }];
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ entries, total: 1 }),
    });

    const result = await getAuditLog();
    expect(result.entries).toEqual(entries);
  });

  it('returns empty entries array when object payload has no recognized collection field', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ total: 0 }),
    });

    const result = await getAuditLog();
    expect(result.entries).toEqual([]);
  });

  it('returns raw payload for non-object responses', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve('raw-audit-payload'),
    });

    const result = await getAuditLog();
    expect(result).toBe('raw-audit-payload');
  });

  it('throws when response is not ok', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      statusText: 'Internal Server Error',
    });

    await expect(getAuditLog()).rejects.toThrow('Failed to fetch audit log: Internal Server Error');
  });
});
