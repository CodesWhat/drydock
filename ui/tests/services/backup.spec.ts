import { getBackups, rollback } from '@/services/backup';

global.fetch = vi.fn();

describe('Backup Service', () => {
  beforeEach(() => {
    vi.mocked(fetch).mockClear();
  });

  describe('getBackups', () => {
    it('keeps HTTP status as structured data without an English UI prefix', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      } as Response);

      await expect(getBackups('bad-id')).rejects.toMatchObject({
        name: 'ApiError',
        status: 404,
        message: 'Not Found',
      });
    });

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

      expect(fetch).toHaveBeenCalledWith('/api/v1/containers/container-1/backups', {
        credentials: 'include',
      });
      expect(result).toEqual(mockBackups);
    });

    it('unwraps backups from data envelope payloads', async () => {
      const mockBackups = [
        { id: 'b1', imageTag: '1.0.0', timestamp: '2025-01-01T00:00:00Z' },
        { id: 'b2', imageTag: '0.9.0', timestamp: '2024-12-01T00:00:00Z' },
      ];
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: mockBackups, total: 2 }),
      } as any);

      const result = await getBackups('container-1');

      expect(result).toEqual(mockBackups);
    });

    it('throws when response is not ok', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        statusText: 'Not Found',
      } as any);

      await expect(getBackups('bad-id')).rejects.toThrow('Not Found');
    });
  });

  describe('rollback', () => {
    it.each([null, { error: '' }, { error: '  ' }, { error: { message: 'not a string' } }])(
      'does not stringify unusable error envelopes: %j',
      async (body) => {
        vi.mocked(fetch).mockResolvedValueOnce({
          ok: false,
          status: 503,
          statusText: '',
          json: async () => body,
        } as Response);

        await expect(rollback('container-1')).rejects.toMatchObject({
          name: 'ApiError',
          status: 503,
          message: '',
        });
      },
    );

    it('retains HTTP status when the parser throws no usable diagnostic', async () => {
      const response = new Response('', {
        status: 502,
        statusText: 'Bad Gateway',
      });
      vi.spyOn(response, 'json').mockRejectedValueOnce(null);
      vi.mocked(fetch).mockResolvedValueOnce(response);

      await expect(rollback('container-1')).rejects.toMatchObject({
        name: 'ApiError',
        status: 502,
        message: 'Bad Gateway',
      });
    });

    it('preserves server diagnostics and status without an English UI prefix', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 409,
        statusText: 'Conflict',
        json: async () => ({ error: 'Backup belongs to a different container' }),
      } as Response);

      await expect(rollback('container-1')).rejects.toMatchObject({
        name: 'ApiError',
        status: 409,
        message: 'Conflict (Backup belongs to a different container)',
      });
    });

    it('posts rollback with backupId', async () => {
      const mockResult = { message: 'Container rolled back successfully' };
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResult,
      } as any);

      const result = await rollback('container-1', 'backup-1');

      expect(fetch).toHaveBeenCalledWith('/api/v1/containers/container-1/rollback', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-DD-Confirm-Action': 'container-rollback',
        },
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

      expect(fetch).toHaveBeenCalledWith('/api/v1/containers/container-1/rollback', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-DD-Confirm-Action': 'container-rollback',
        },
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
        'Not Found (No backups found for this container)',
      );
    });

    it('preserves the parsing diagnostic without an English wrapper', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        statusText: 'Internal Server Error',
        json: async () => {
          throw new Error('parse error');
        },
      } as any);

      await expect(rollback('container-1')).rejects.toThrow('Internal Server Error (parse error)');
    });

    it('preserves string parsing diagnostics', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        statusText: 'Internal Server Error',
        json: async () => {
          throw 'parse-failed';
        },
      } as any);

      await expect(rollback('container-1')).rejects.toThrow('Internal Server Error (parse-failed)');
    });

    it('throws without error detail when body has no error field', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        statusText: 'Bad Request',
        json: async () => ({}),
      } as any);

      await expect(rollback('container-1')).rejects.toThrow('Bad Request');
    });
  });
});
