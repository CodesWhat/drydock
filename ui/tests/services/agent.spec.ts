import { getAgentIcon, getAgents } from '@/services/agent';

global.fetch = vi.fn();

describe('Agent Service', () => {
  beforeEach(() => {
    vi.mocked(fetch).mockClear();
  });

  describe('getAgentIcon', () => {
    it('returns the agent icon', () => {
      expect(getAgentIcon()).toBe('sh-robot');
    });
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

      expect(fetch).toHaveBeenCalledWith('/api/agents', { credentials: 'include' });
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
