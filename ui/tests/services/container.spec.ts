import {
  deleteContainer,
  getAllContainers,
  getContainerIcon,
  getContainerLogs,
  getContainerTriggers,
  refreshAllContainers,
  refreshContainer,
  runTrigger,
  updateContainerPolicy,
} from '@/services/container';

// Mock fetch globally
global.fetch = vi.fn();

describe('Container Service', () => {
  beforeEach(() => {
    vi.mocked(fetch).mockClear();
  });

  describe('getContainerIcon', () => {
    it('returns the docker icon', () => {
      expect(getContainerIcon()).toBe('fab fa-docker');
    });
  });

  describe('getAllContainers', () => {
    it('fetches all containers successfully', async () => {
      const mockContainers = [
        { id: '1', name: 'container1' },
        { id: '2', name: 'container2' },
      ];
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockContainers,
      } as any);

      const containers = await getAllContainers();

      expect(fetch).toHaveBeenCalledWith('/api/containers', {
        credentials: 'include',
      });
      expect(containers).toEqual(mockContainers);
    });
  });

  describe('refreshAllContainers', () => {
    it('refreshes all containers successfully', async () => {
      const mockResult = { refreshed: 10 };
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResult,
      } as any);

      const result = await refreshAllContainers();

      expect(fetch).toHaveBeenCalledWith('/api/containers/watch', {
        method: 'POST',
        credentials: 'include',
      });
      expect(result).toEqual(mockResult);
    });

    it('throws when refresh fails', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        statusText: 'Service Unavailable',
      } as any);

      await expect(refreshAllContainers()).rejects.toThrow(
        'Failed to refresh all containers: Service Unavailable',
      );
    });
  });

  describe('refreshContainer', () => {
    it('refreshes specific container successfully', async () => {
      const mockResult = { id: 'container1', refreshed: true };
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResult,
      } as any);

      const result = await refreshContainer('container1');

      expect(fetch).toHaveBeenCalledWith('/api/containers/container1/watch', {
        method: 'POST',
        credentials: 'include',
      });
      expect(result).toEqual(mockResult);
    });

    it('returns undefined when container not found (404)', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 404,
      } as any);

      const result = await refreshContainer('nonexistent');
      expect(result).toBeUndefined();
    });

    it('throws when refresh fails with non-404 error', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      } as any);

      await expect(refreshContainer('c1')).rejects.toThrow(
        'Failed to refresh container c1: Internal Server Error',
      );
    });
  });

  describe('deleteContainer', () => {
    it('deletes container successfully', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
      } as any);

      const result = await deleteContainer('container1');

      expect(fetch).toHaveBeenCalledWith('/api/containers/container1', {
        method: 'DELETE',
        credentials: 'include',
      });
      expect(result).toBeDefined();
    });

    it('throws when delete fails', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        statusText: 'Forbidden',
      } as any);

      await expect(deleteContainer('c1')).rejects.toThrow(
        'Failed to delete container c1: Forbidden',
      );
    });
  });

  describe('getContainerTriggers', () => {
    it('fetches container triggers successfully', async () => {
      const mockTriggers = [
        { type: 'webhook', name: 'trigger1' },
        { type: 'email', name: 'trigger2' },
      ];
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockTriggers,
      } as any);

      const triggers = await getContainerTriggers('container1');

      expect(fetch).toHaveBeenCalledWith('/api/containers/container1/triggers', {
        credentials: 'include',
      });
      expect(triggers).toEqual(mockTriggers);
    });

    it('throws when fetching triggers fails', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        statusText: 'Not Found',
      } as any);

      await expect(getContainerTriggers('c1')).rejects.toThrow(
        'Failed to get triggers for container c1: Not Found',
      );
    });
  });

  describe('runTrigger', () => {
    it('runs trigger without agent successfully', async () => {
      const mockResult = { success: true };
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResult,
      } as any);

      const result = await runTrigger({
        containerId: 'container1',
        triggerType: 'webhook',
        triggerName: 'trigger1',
      });

      expect(fetch).toHaveBeenCalledWith('/api/containers/container1/triggers/webhook/trigger1', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      expect(result).toEqual(mockResult);
    });

    it('runs trigger with agent successfully', async () => {
      const mockResult = { success: true };
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResult,
      } as any);

      const result = await runTrigger({
        containerId: 'container1',
        triggerType: 'webhook',
        triggerName: 'trigger1',
        triggerAgent: 'agent1',
      });

      expect(fetch).toHaveBeenCalledWith(
        '/api/containers/container1/triggers/agent1/webhook/trigger1',
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        },
      );
      expect(result).toEqual(mockResult);
    });

    it('throws when trigger run fails', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        statusText: 'Bad Request',
      } as any);

      await expect(
        runTrigger({
          containerId: 'c1',
          triggerType: 'webhook',
          triggerName: 't1',
        }),
      ).rejects.toThrow('Failed to run trigger webhook/t1: Bad Request');
    });
  });

  describe('updateContainerPolicy', () => {
    it('updates container policy successfully', async () => {
      const mockResult = { updated: true };
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResult,
      } as any);

      const result = await updateContainerPolicy('c1', 'enable', { schedule: '0 * * * *' });

      expect(fetch).toHaveBeenCalledWith('/api/containers/c1/update-policy', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'enable', schedule: '0 * * * *' }),
      });
      expect(result).toEqual(mockResult);
    });

    it('updates container policy with no extra payload', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ updated: true }),
      } as any);

      await updateContainerPolicy('c1', 'disable');

      expect(fetch).toHaveBeenCalledWith('/api/containers/c1/update-policy', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'disable' }),
      });
    });

    it('throws with error detail when response body has error', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        statusText: 'Bad Request',
        json: async () => ({ error: 'Invalid action' }),
      } as any);

      await expect(updateContainerPolicy('c1', 'invalid')).rejects.toThrow(
        'Failed to update container policy invalid: Bad Request (Invalid action)',
      );
    });

    it('throws without detail when response body has no error field', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        statusText: 'Bad Request',
        json: async () => ({}),
      } as any);

      await expect(updateContainerPolicy('c1', 'invalid')).rejects.toThrow(
        'Failed to update container policy invalid: Bad Request',
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

      await expect(updateContainerPolicy('c1', 'enable')).rejects.toThrow(
        'Failed to update container policy enable: Internal Server Error',
      );
    });
  });

  describe('getContainerLogs', () => {
    it('fetches container logs successfully', async () => {
      const mockLogs = { logs: 'line1\nline2\nline3' };
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockLogs,
      } as any);

      const result = await getContainerLogs('container1');

      expect(fetch).toHaveBeenCalledWith('/api/containers/container1/logs?tail=100', {
        credentials: 'include',
      });
      expect(result).toEqual(mockLogs);
    });

    it('fetches container logs with custom tail count', async () => {
      const mockLogs = { logs: 'line1' };
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockLogs,
      } as any);

      const result = await getContainerLogs('container1', 50);

      expect(fetch).toHaveBeenCalledWith('/api/containers/container1/logs?tail=50', {
        credentials: 'include',
      });
      expect(result).toEqual(mockLogs);
    });

    it('throws when fetching logs fails', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        statusText: 'Internal Server Error',
      } as any);

      await expect(getContainerLogs('c1')).rejects.toThrow(
        'Failed to get logs for container c1: Internal Server Error',
      );
    });
  });
});
