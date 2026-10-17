import {
  cancelUpdateOperation,
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

  it.each([
    ['start', () => startContainer('abc123')],
    ['stop', () => stopContainer('abc123')],
    ['restart', () => restartContainer('abc123')],
    ['update', () => updateContainer('abc123')],
    ['bulk update', () => updateContainers(['abc123'])],
    ['cancel', () => cancelUpdateOperation('op-123')],
  ] as const)('preserves a nonempty %s diagnostic verbatim', async (_name, request) => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ error: '  Provider diagnostic  ' }, { status: 503 }),
    );
    await expect(request()).rejects.toMatchObject({ message: '  Provider diagnostic  ' });
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

    it('leaves missing diagnostics empty for the caller to localize', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        statusText: 'Internal Server Error',
        json: async () => {
          throw new Error('parse error');
        },
      } as any);

      await expect(startContainer('abc123')).rejects.toMatchObject({ message: '' });
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

    it('leaves missing diagnostics empty for the caller to localize', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        statusText: 'Internal Server Error',
        json: async () => {
          throw new Error('parse error');
        },
      } as any);

      await expect(stopContainer('abc123')).rejects.toMatchObject({ message: '' });
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

    it('leaves missing diagnostics empty for the caller to localize', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        statusText: 'Internal Server Error',
        json: async () => {
          throw new Error('parse error');
        },
      } as any);

      await expect(restartContainer('abc123')).rejects.toMatchObject({ message: '' });
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

    it('leaves missing diagnostics empty for the caller to localize', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        statusText: 'Internal Server Error',
        json: async () => {
          throw new Error('parse error');
        },
      } as any);

      await expect(updateContainer('abc123')).rejects.toMatchObject({ message: '' });
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

    it('throws with server error message on bulk update failure', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        statusText: 'Conflict',
        json: async () => ({ error: 'Queue already active' }),
      } as any);

      await expect(updateContainers(['abc123'])).rejects.toThrow('Queue already active');
    });

    it('leaves missing bulk diagnostics empty for the caller to localize', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        statusText: 'Internal Server Error',
        json: async () => {
          throw new Error('parse error');
        },
      } as any);

      await expect(updateContainers(['abc123'])).rejects.toMatchObject({ message: '' });
    });
  });

  describe('cancelUpdateOperation', () => {
    it('posts to cancel endpoint and resolves with cancelled outcome on 200', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { id: 'op-123', status: 'cancelled' } }),
      } as any);

      await expect(cancelUpdateOperation('op-123')).resolves.toBe('cancelled');

      expect(fetch).toHaveBeenCalledWith('/api/v1/operations/op-123/cancel', {
        method: 'POST',
        credentials: 'include',
      });
    });

    it('resolves with cancel-requested outcome on 202', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 202,
        json: async () => ({ data: { id: 'op-456', cancelRequested: true } }),
      } as any);

      await expect(cancelUpdateOperation('op-456')).resolves.toBe('cancel-requested');
    });

    it('URL-encodes the operation id', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
      } as any);

      await cancelUpdateOperation('op/with/slashes');

      expect(fetch).toHaveBeenCalledWith('/api/v1/operations/op%2Fwith%2Fslashes/cancel', {
        method: 'POST',
        credentials: 'include',
      });
    });

    it('throws with server error message on failure', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 409,
        statusText: 'Conflict',
        json: async () => ({ error: 'Operation already in progress' }),
      } as any);

      await expect(cancelUpdateOperation('op-123')).rejects.toThrow(
        'Operation already in progress',
      );
    });

    it('attaches statusCode to thrown error', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({ error: 'Operation not found' }),
      } as any);

      let caught: unknown;
      try {
        await cancelUpdateOperation('op-missing');
      } catch (e) {
        caught = e;
      }
      expect((caught as { statusCode?: number }).statusCode).toBe(404);
    });

    it('leaves missing diagnostics empty while preserving the cancellation status', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => {
          throw new Error('parse error');
        },
      } as any);

      await expect(cancelUpdateOperation('op-123')).rejects.toMatchObject({
        message: '',
        statusCode: 500,
      });
    });
  });
});
