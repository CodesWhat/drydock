import { getTriggerIcon, getAllTriggers, runTrigger } from '@/services/trigger';

global.fetch = vi.fn();

describe('Trigger Service', () => {
  beforeEach(() => {
    vi.mocked(fetch).mockClear();
  });

  describe('getTriggerIcon', () => {
    it('returns the trigger icon', () => {
      expect(getTriggerIcon()).toBe('mdi-bell-ring');
    });
  });

  describe('getAllTriggers', () => {
    it('fetches all triggers successfully', async () => {
      const mockTriggers = [{ type: 'webhook', name: 'hook1' }];
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockTriggers,
      } as any);

      const result = await getAllTriggers();

      expect(fetch).toHaveBeenCalledWith('/api/triggers', { credentials: 'include' });
      expect(result).toEqual(mockTriggers);
    });
  });

  describe('runTrigger', () => {
    it('runs trigger successfully and returns result', async () => {
      const mockResult = { success: true };
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResult,
      } as any);

      const container = { id: 'c1', name: 'test' };
      const result = await runTrigger({
        triggerType: 'webhook',
        triggerName: 'hook1',
        container,
      });

      expect(fetch).toHaveBeenCalledWith('/api/triggers/webhook/hook1', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(container),
      });
      expect(result).toEqual(mockResult);
    });

    it('throws when trigger run fails with error message', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Trigger execution failed' }),
      } as any);

      await expect(runTrigger({
        triggerType: 'webhook',
        triggerName: 'hook1',
        container: { id: 'c1' },
      })).rejects.toThrow('Trigger execution failed');
    });

    it('throws "Unknown error" when no error message in response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({}),
      } as any);

      await expect(runTrigger({
        triggerType: 'webhook',
        triggerName: 'hook1',
        container: { id: 'c1' },
      })).rejects.toThrow('Unknown error');
    });
  });
});
