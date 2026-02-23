import {
  getAllNotificationRules,
  updateNotificationRule,
  type NotificationRule,
} from '@/services/notification';

describe('Notification Service', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('getAllNotificationRules', () => {
    it('should fetch notification rules', async () => {
      const mockRules: NotificationRule[] = [
        {
          id: 'update-available',
          name: 'Update Available',
          description: 'When a container has a new version',
          enabled: true,
          triggers: ['slack.ops'],
        },
      ];

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockRules),
      });

      const result = await getAllNotificationRules();

      expect(global.fetch).toHaveBeenCalledWith('/api/notifications', { credentials: 'include' });
      expect(result).toEqual(mockRules);
    });

    it('should throw when fetching notification rules fails', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        statusText: 'Internal Server Error',
      });

      await expect(getAllNotificationRules()).rejects.toThrow(
        'Failed to get notifications: Internal Server Error',
      );
    });
  });

  describe('updateNotificationRule', () => {
    it('should patch one notification rule', async () => {
      const updatedRule: NotificationRule = {
        id: 'update-available',
        name: 'Update Available',
        description: 'When a container has a new version',
        enabled: false,
        triggers: ['smtp.ops'],
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(updatedRule),
      });

      const result = await updateNotificationRule('update-available', {
        enabled: false,
        triggers: ['smtp.ops'],
      });

      expect(global.fetch).toHaveBeenCalledWith('/api/notifications/update-available', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          enabled: false,
          triggers: ['smtp.ops'],
        }),
      });
      expect(result).toEqual(updatedRule);
    });

    it('should throw the backend error when patch fails', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 400,
        json: vi.fn().mockResolvedValue({ error: 'Validation failed' }),
      });

      await expect(updateNotificationRule('update-available', { enabled: true })).rejects.toThrow(
        'Validation failed',
      );
    });

    it('should handle non-JSON error responses', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 500,
        json: vi.fn().mockRejectedValue(new Error('not json')),
      });

      await expect(updateNotificationRule('update-available', { enabled: true })).rejects.toThrow(
        'Unknown error',
      );
    });

    it('should fallback to HTTP status when backend error payload has no error field', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 503,
        json: vi.fn().mockResolvedValue({}),
      });

      await expect(updateNotificationRule('update-available', { enabled: true })).rejects.toThrow(
        'HTTP 503',
      );
    });
  });
});
