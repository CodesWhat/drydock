import { getSettings, updateSettings } from '@/services/settings';

describe('Settings Service', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('getSettings', () => {
    it('should fetch settings from API', async () => {
      const mockSettings = { internetlessMode: false };
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        json: vi.fn().mockResolvedValue(mockSettings),
      });

      const result = await getSettings();

      expect(global.fetch).toHaveBeenCalledWith('/api/settings', { credentials: 'include' });
      expect(result).toEqual(mockSettings);
    });

    it('should return settings with internetless mode enabled', async () => {
      const mockSettings = { internetlessMode: true };
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        json: vi.fn().mockResolvedValue(mockSettings),
      });

      const result = await getSettings();

      expect(result.internetlessMode).toBe(true);
    });
  });

  describe('updateSettings', () => {
    it('should send PUT request with settings payload', async () => {
      const updated = { internetlessMode: true };
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(updated),
      });

      const result = await updateSettings({ internetlessMode: true });

      expect(global.fetch).toHaveBeenCalledWith('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ internetlessMode: true }),
      });
      expect(result).toEqual(updated);
    });

    it('should throw on validation error', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 400,
        json: vi.fn().mockResolvedValue({ error: '"internetlessMode" must be a boolean' }),
      });

      await expect(updateSettings({} as any)).rejects.toThrow(
        '"internetlessMode" must be a boolean',
      );
    });

    it('should handle non-JSON error responses', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 500,
        json: vi.fn().mockRejectedValue(new Error('not json')),
      });

      await expect(updateSettings({ internetlessMode: true })).rejects.toThrow('Unknown error');
    });
  });
});
