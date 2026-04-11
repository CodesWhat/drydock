import {
  restartContainer,
  startContainer,
  stopContainer,
  updateContainer,
  updateContainers,
} from '@/services/container-actions';

global.fetch = vi.fn();

describe('Container Actions Service', () => {
  beforeEach(() => {
    vi.mocked(fetch).mockClear();
  });

  describe('startContainer', () => {
    it('posts to start endpoint', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: 'Container started' }),
      } as any);

      const result = await startContainer('abc123');

      expect(fetch).toHaveBeenCalledWith('/api/v1/containers/abc123/start', {
        method: 'POST',
        credentials: 'include',
      });
      expect(result).toEqual({ message: 'Container started' });
    });

    it('throws with server error message on failure', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        statusText: 'Forbidden',
        json: async () => ({ error: 'Feature disabled' }),
      } as any);

      await expect(startContainer('abc123')).rejects.toThrow('Feature disabled');
    });

    it('throws with statusText when response body parsing fails', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        statusText: 'Internal Server Error',
        json: async () => {
          throw new Error('parse error');
        },
      } as any);

      await expect(startContainer('abc123')).rejects.toThrow(
        'Failed to start container: Internal Server Error',
      );
    });
  });

  describe('stopContainer', () => {
    it('posts to stop endpoint', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: 'Container stopped' }),
      } as any);

      const result = await stopContainer('abc123');

      expect(fetch).toHaveBeenCalledWith('/api/v1/containers/abc123/stop', {
        method: 'POST',
        credentials: 'include',
      });
      expect(result).toEqual({ message: 'Container stopped' });
    });

    it('throws with server error message on failure', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        statusText: 'Forbidden',
        json: async () => ({ error: 'Feature disabled' }),
      } as any);

      await expect(stopContainer('abc123')).rejects.toThrow('Feature disabled');
    });

    it('throws with statusText when response body parsing fails', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        statusText: 'Internal Server Error',
        json: async () => {
          throw new Error('parse error');
        },
      } as any);

      await expect(stopContainer('abc123')).rejects.toThrow(
        'Failed to stop container: Internal Server Error',
      );
    });
  });

  describe('restartContainer', () => {
    it('posts to restart endpoint', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: 'Container restarted' }),
      } as any);

      const result = await restartContainer('abc123');

      expect(fetch).toHaveBeenCalledWith('/api/v1/containers/abc123/restart', {
        method: 'POST',
        credentials: 'include',
      });
      expect(result).toEqual({ message: 'Container restarted' });
    });

    it('throws with server error message on failure', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        statusText: 'Forbidden',
        json: async () => ({ error: 'Feature disabled' }),
      } as any);

      await expect(restartContainer('abc123')).rejects.toThrow('Feature disabled');
    });

    it('throws with statusText when response body parsing fails', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        statusText: 'Internal Server Error',
        json: async () => {
          throw new Error('parse error');
        },
      } as any);

      await expect(restartContainer('abc123')).rejects.toThrow(
        'Failed to restart container: Internal Server Error',
      );
    });
  });

  describe('updateContainer', () => {
    it('posts to update endpoint', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: 'Container update accepted', operationId: 'op-123' }),
      } as any);

      const result = await updateContainer('abc123');

      expect(fetch).toHaveBeenCalledWith('/api/v1/containers/abc123/update', {
        method: 'POST',
        credentials: 'include',
      });
      expect(result).toEqual({ message: 'Container update accepted', operationId: 'op-123' });
    });

    it('does not post client-authored batch metadata for single updates', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: 'Container update accepted', operationId: 'op-123' }),
      } as any);

      await updateContainer('abc123');

      expect(fetch).toHaveBeenCalledWith('/api/v1/containers/abc123/update', {
        method: 'POST',
        credentials: 'include',
      });
    });

    it('throws with server error message on failure', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        statusText: 'Bad Request',
        json: async () => ({ error: 'No update available for this container' }),
      } as any);

      await expect(updateContainer('abc123')).rejects.toThrow(
        'No update available for this container',
      );
    });

    it('throws with statusText when response body parsing fails', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        statusText: 'Internal Server Error',
        json: async () => {
          throw new Error('parse error');
        },
      } as any);

      await expect(updateContainer('abc123')).rejects.toThrow(
        'Failed to update container: Internal Server Error',
      );
    });
  });

  describe('updateContainers', () => {
    it('posts to the bulk update endpoint', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: 'Container update requests processed',
          accepted: [{ containerId: 'abc123', containerName: 'nginx', operationId: 'op-123' }],
          rejected: [
            {
              containerId: 'def456',
              containerName: 'redis',
              statusCode: 400,
              message: 'No update available for this container',
            },
          ],
        }),
      } as any);

      const result = await updateContainers(['abc123', 'def456']);

      expect(fetch).toHaveBeenCalledWith('/api/v1/containers/update', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          containerIds: ['abc123', 'def456'],
        }),
      });
      expect(result).toEqual({
        message: 'Container update requests processed',
        accepted: [{ containerId: 'abc123', containerName: 'nginx', operationId: 'op-123' }],
        rejected: [
          {
            containerId: 'def456',
            containerName: 'redis',
            statusCode: 400,
            message: 'No update available for this container',
          },
        ],
      });
    });
  });
});
