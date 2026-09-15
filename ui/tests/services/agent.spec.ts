import { getAgentRoster, getAgents } from '@/services/agent';

global.fetch = vi.fn();

describe('Agent Service', () => {
  beforeEach(() => {
    vi.mocked(fetch).mockReset();
  });

  it('reads the roster with credentials and projects only exact names', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        data: [{ name: 'Local', host: 'private' }, { name: 'local' }],
        total: 2,
      }),
    );
    expect(await getAgentRoster()).toEqual([{ name: 'Local' }, { name: 'local' }]);
    expect(fetch).toHaveBeenCalledWith('/api/v1/agents/roster', { credentials: 'include' });
  });

  it.each([
    null,
    [],
    {},
    { data: null },
    { data: [null] },
    { data: [7] },
    { data: [{}] },
    { data: [{ name: 7 }] },
    { data: [{ name: '' }] },
  ])(
    'rejects malformed roster payloads rather than treating them as an empty roster: %j',
    async (payload) => {
      vi.mocked(fetch).mockResolvedValueOnce(Response.json(payload));
      await expect(getAgentRoster()).rejects.toThrow('Invalid agent roster response');
    },
  );

  it('accepts an authoritative empty roster', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ data: [], total: 0 }));
    expect(await getAgentRoster()).toEqual([]);
  });

  it.each([403, 404, 503])('rejects HTTP %i roster failures', async (status) => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status }));
    await expect(getAgentRoster()).rejects.toThrow(`Failed to get agent roster: ${status}`);
  });

  it('rejects unreadable JSON and network failures', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('{', { headers: { 'content-type': 'application/json' } }),
    );
    await expect(getAgentRoster()).rejects.toThrow('invalid JSON');
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
    await expect(getAgentRoster()).rejects.toThrow('offline');
  });

  describe('getAgents', () => {
    it('fetches agents successfully', async () => {
      const mockAgents = [
        { name: 'node1', connected: true },
        { name: 'node2', connected: false },
      ];
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockAgents,
      } as any);

      const agents = await getAgents();

      expect(fetch).toHaveBeenCalledWith('/api/v1/agents', { credentials: 'include' });
      expect(agents).toEqual(mockAgents);
    });

    it('unwraps agents from collection envelope payloads', async () => {
      const mockAgents = [
        { name: 'node1', connected: true },
        { name: 'node2', connected: false },
      ];
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: mockAgents, total: 2 }),
      } as any);

      const agents = await getAgents();
      expect(agents).toEqual(mockAgents);
    });

    it('throws an error when request fails', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        statusText: 'Internal Server Error',
      } as any);

      await expect(getAgents()).rejects.toThrow('Failed to get agents: Internal Server Error');
    });
  });
});
