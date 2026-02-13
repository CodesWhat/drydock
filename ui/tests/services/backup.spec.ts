import { getBackups, rollback } from '@/services/backup';

global.fetch = vi.fn();

describe('Backup Service', () => {
  beforeEach(() => {
    vi.mocked(fetch).mockClear();
  });

  describe('getBackups', () => {
    it('fetches backups for a container', async () => {
      const mockBackups = [
        { id: 'b1', imageTag: '1.0.0', timestamp: '2025-01-01T00:00:00Z' },
        { id: 'b2', imageTag: '0.9.0', timestamp: '2024-12-01T00:00:00Z' },
      ];
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockBackups,
      } as any);

      const result = await getBackups('container-1');

      expect(fetch).toHaveBeenCalledWith('/api/containers/container-1/backups', {
        credentials: 'include',
      });
      expect(result).toEqual(mockBackups);
    });

    it('throws when response is not ok', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        statusText: 'Not Found',
      } as any);

      await expect(getBackups('bad-id')).rejects.toThrow(
        'Failed to get backups for container bad-id: Not Found',
      );
    });
  });

  describe('rollback', () => {
    it('posts rollback with backupId', async () => {
      const mockResult = { message: 'Container rolled back successfully' };
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResult,
      } as any);

      const result = await rollback('container-1', 'backup-1');

      expect(fetch).toHaveBeenCalledWith('/api/containers/container-1/rollback', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backupId: 'backup-1' }),
      });
      expect(result).toEqual(mockResult);
    });

    it('posts rollback without backupId', async () => {
      const mockResult = { message: 'Container rolled back successfully' };
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResult,
      } as any);

      const result = await rollback('container-1');

      expect(fetch).toHaveBeenCalledWith('/api/containers/container-1/rollback', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      expect(result).toEqual(mockResult);
    });

    it('throws with error detail when response body has error', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        statusText: 'Not Found',
        json: async () => ({ error: 'No backups found for this container' }),
      } as any);

      await expect(rollback('container-1', 'bad-backup')).rejects.toThrow(
        'Rollback failed: Not Found (No backups found for this container)',
      );
    });

    it('throws without detail when response body parsing fails', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        statusText: 'Internal Server Error',
        json: async () => {
          throw new Error('parse error');
        },
      } as any);

      await expect(rollback('container-1')).rejects.toThrow(
        'Rollback failed: Internal Server Error',
      );
    });

    it('throws without error detail when body has no error field', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        statusText: 'Bad Request',
        json: async () => ({}),
      } as any);

      await expect(rollback('container-1')).rejects.toThrow('Rollback failed: Bad Request');
    });
  });
});
