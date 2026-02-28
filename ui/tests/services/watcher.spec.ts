import {
  getAllWatchers,
  getWatcher,
  getWatcherIcon,
  getWatcherProviderColor,
  getWatcherProviderIcon,
} from '@/services/watcher';

describe('Watcher Service', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it('should return watcher icon', () => {
    expect(getWatcherIcon()).toBe('sh-eye');
  });

  it('returns docker icon for docker provider', () => {
    expect(getWatcherProviderIcon('docker')).toBe('sh-docker');
  });

  it('returns default icon for unknown provider', () => {
    expect(getWatcherProviderIcon('kubernetes')).toBe('sh-eye');
  });

  it('returns docker color for docker provider', () => {
    expect(getWatcherProviderColor('docker')).toBe('#2496ED');
  });

  it('returns default color for unknown provider', () => {
    expect(getWatcherProviderColor('kubernetes')).toBe('#6B7280');
  });

  it('should get all watchers', async () => {
    const mockResponse = { watchers: [] };
    global.fetch.mockResolvedValue({
      json: vi.fn().mockResolvedValue(mockResponse),
    });

    const result = await getAllWatchers();

    expect(global.fetch).toHaveBeenCalledWith('/api/watchers', { credentials: 'include' });
    expect(result).toEqual(mockResponse);
  });

  it('fetches a specific watcher by type and name', async () => {
    const mockWatcher = { id: 'docker.local', type: 'docker', name: 'local' };
    global.fetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(mockWatcher),
    });

    const result = await getWatcher({ type: 'docker', name: 'local' });

    expect(global.fetch).toHaveBeenCalledWith('/api/watchers/docker/local', {
      credentials: 'include',
    });
    expect(result).toEqual(mockWatcher);
  });

  it('fetches an agent-scoped watcher when agent is provided', async () => {
    const mockWatcher = { id: 'edge.docker.local', type: 'docker', name: 'local', agent: 'edge' };
    global.fetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(mockWatcher),
    });

    const result = await getWatcher({ agent: 'edge', type: 'docker', name: 'local' });

    expect(global.fetch).toHaveBeenCalledWith('/api/watchers/edge/docker/local', {
      credentials: 'include',
    });
    expect(result).toEqual(mockWatcher);
  });
});
