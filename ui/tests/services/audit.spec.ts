import { getAuditIcon, getAuditLog } from '@/services/audit';

describe('audit service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('calls GET /api/audit with no params', async () => {
    const mockResponse = { entries: [], total: 0, page: 1, limit: 50 };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const result = await getAuditLog();

    expect(global.fetch).toHaveBeenCalledWith('/api/audit', { credentials: 'include' });
    expect(result).toEqual(mockResponse);
  });

  it('appends query parameters', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ entries: [], total: 0 }),
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
    expect(calledUrl).toContain('page=2');
    expect(calledUrl).toContain('limit=10');
    expect(calledUrl).toContain('action=update-applied');
    expect(calledUrl).toContain('container=nginx');
    expect(calledUrl).toContain('from=2026-01-01');
    expect(calledUrl).toContain('to=2026-01-31');
  });

  it('throws when response is not ok', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      statusText: 'Internal Server Error',
    });

    await expect(getAuditLog()).rejects.toThrow('Failed to fetch audit log: Internal Server Error');
  });

  it('getAuditIcon returns the correct icon', () => {
    expect(getAuditIcon()).toBe('sh-clock-rotate-left');
  });
});
