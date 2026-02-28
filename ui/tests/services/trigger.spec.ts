import {
  getAllTriggers,
  getTrigger,
  getTriggerIcon,
  getTriggerProviderColor,
  getTriggerProviderIcon,
  runTrigger,
} from '@/services/trigger';

global.fetch = vi.fn();

describe('Trigger Service', () => {
  beforeEach(() => {
    vi.mocked(fetch).mockClear();
  });

  describe('getTriggerIcon', () => {
    it('returns the trigger icon', () => {
      expect(getTriggerIcon()).toBe('sh-bolt');
    });
  });

  describe('getTriggerProviderIcon', () => {
    it.each([
      ['http', 'sh-globe'],
      ['smtp', 'sh-envelope'],
      ['slack', 'sh-slack'],
      ['discord', 'sh-discord'],
      ['telegram', 'sh-telegram'],
      ['mqtt', 'sh-mqtt'],
      ['kafka', 'sh-apache-kafka'],
      ['pushover', 'sh-pushover'],
      ['gotify', 'sh-gotify'],
      ['ntfy', 'sh-ntfy'],
      ['ifttt', 'sh-ifttt'],
      ['apprise', 'sh-apprise'],
      ['command', 'sh-terminal'],
      ['dockercompose', 'sh-docker'],
      ['rocketchat', 'sh-rocket-chat'],
      ['mattermost', 'sh-mattermost'],
      ['teams', 'sh-microsoft-teams'],
      ['matrix', 'sh-matrix'],
      ['googlechat', 'sh-google-chat'],
      ['docker', 'sh-docker'],
      ['unknown', 'sh-bolt'],
    ])('returns %s icon', (type, icon) => {
      expect(getTriggerProviderIcon(type)).toBe(icon);
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

  describe('getTriggerProviderColor', () => {
    it.each([
      ['slack', '#4A154B'],
      ['discord', '#5865F2'],
      ['telegram', '#26A5E4'],
      ['smtp', '#EA4335'],
      ['mqtt', '#660066'],
      ['kafka', '#231F20'],
      ['http', '#0096C7'],
      ['pushover', '#249DF1'],
      ['gotify', '#00BCD4'],
      ['ntfy', '#57A143'],
      ['ifttt', '#33CCFF'],
      ['apprise', '#3B82F6'],
      ['command', '#10B981'],
      ['docker', '#2496ED'],
      ['dockercompose', '#2496ED'],
      ['rocketchat', '#F5455C'],
      ['mattermost', '#0058CC'],
      ['teams', '#6264A7'],
      ['matrix', '#0DBD8B'],
      ['googlechat', '#34A853'],
      ['unknown', '#6B7280'],
      [undefined, '#6B7280'],
    ])('returns %s color', (type, color) => {
      expect(getTriggerProviderColor(type)).toBe(color);
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

      await expect(
        runTrigger({
          triggerType: 'webhook',
          triggerName: 'hook1',
          container: { id: 'c1' },
        }),
      ).rejects.toThrow('Trigger execution failed');
    });

    it('throws "Unknown error" when no error message in response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({}),
      } as any);

      await expect(
        runTrigger({
          triggerType: 'webhook',
          triggerName: 'hook1',
          container: { id: 'c1' },
        }),
      ).rejects.toThrow('Unknown error');
    });
  });

  describe('getTrigger', () => {
    it('fetches a specific trigger by type and name', async () => {
      const mockTrigger = { id: 'slack.alerts', type: 'slack', name: 'alerts' };
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockTrigger,
      } as any);

      const result = await getTrigger({ type: 'slack', name: 'alerts' });

      expect(fetch).toHaveBeenCalledWith('/api/triggers/slack/alerts', {
        credentials: 'include',
      });
      expect(result).toEqual(mockTrigger);
    });

    it('fetches an agent-scoped trigger when agent is provided', async () => {
      const mockTrigger = { id: 'edge.slack.alerts', type: 'slack', name: 'alerts', agent: 'edge' };
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockTrigger,
      } as any);

      const result = await getTrigger({ agent: 'edge', type: 'slack', name: 'alerts' });

      expect(fetch).toHaveBeenCalledWith('/api/triggers/edge/slack/alerts', {
        credentials: 'include',
      });
      expect(result).toEqual(mockTrigger);
    });
  });
});
