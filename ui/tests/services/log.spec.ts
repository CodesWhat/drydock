import { getLog, getLogEntries } from '@/services/log';

let fetchMock: ReturnType<typeof vi.fn>;

describe('Log Service', () => {
  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('should get log', async () => {
    const mockResponse = { logs: [] };
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(mockResponse),
    });

    const result = await getLog();

    expect(fetchMock).toHaveBeenCalledWith('/api/log', { credentials: 'include' });
    expect(result).toEqual(mockResponse);
  });

  it('should throw when fetching log fails', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      statusText: 'Internal Server Error',
      json: vi.fn().mockResolvedValue({}),
    });

    await expect(getLog()).rejects.toThrow('Failed to get log: Internal Server Error');
  });

  describe('getLogEntries', () => {
    it('should fetch log entries with default params', async () => {
      const mockEntries = [
        { timestamp: Date.now(), level: 'info', component: 'test', msg: 'hello' },
      ];
      fetchMock.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockEntries),
      });

      const result = await getLogEntries();

      expect(fetchMock).toHaveBeenCalledWith('/api/log/entries', { credentials: 'include' });
      expect(result).toEqual(mockEntries);
    });

    it('should fetch log entries with custom level and tail params', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue([]),
      });

      await getLogEntries({ level: 'error', tail: 50 });

      const calledUrl = fetchMock.mock.calls[0][0];
      expect(calledUrl).toContain('/api/log/entries?');
      expect(calledUrl).toContain('level=error');
      expect(calledUrl).toContain('tail=50');
    });

    it('should not include level param when level is all', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue([]),
      });

      await getLogEntries({ level: 'all', tail: 100 });

      const calledUrl = fetchMock.mock.calls[0][0];
      expect(calledUrl).not.toContain('level=');
      expect(calledUrl).toContain('tail=100');
    });

    it('should include component param when provided', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue([]),
      });

      await getLogEntries({ component: 'api-server' });

      const calledUrl = fetchMock.mock.calls[0][0];
      expect(calledUrl).toContain('component=api-server');
    });

    it('should not include component param when not provided', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue([]),
      });

      await getLogEntries({ level: 'info' });

      const calledUrl = fetchMock.mock.calls[0][0];
      expect(calledUrl).not.toContain('component=');
    });

    it('should throw on non-ok response', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        statusText: 'Internal Server Error',
      });

      await expect(getLogEntries()).rejects.toThrow(
        'Failed to fetch log entries: Internal Server Error',
      );
    });

    it('should fetch from agent endpoint when agent param is provided', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue([]),
      });

      await getLogEntries({ agent: 'my-agent', tail: 100 });

      const calledUrl = fetchMock.mock.calls[0][0];
      expect(calledUrl).toContain('/api/agents/my-agent/log/entries');
      expect(calledUrl).toContain('tail=100');
    });

    it('should encode agent name in URL', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue([]),
      });

      await getLogEntries({ agent: 'agent with spaces' });

      const calledUrl = fetchMock.mock.calls[0][0];
      expect(calledUrl).toContain('/api/agents/agent%20with%20spaces/log/entries');
    });

    it('should fetch from server endpoint when agent is undefined', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue([]),
      });

      await getLogEntries({ agent: undefined });

      const calledUrl = fetchMock.mock.calls[0][0];
      expect(calledUrl).toBe('/api/log/entries');
    });
  });
});
