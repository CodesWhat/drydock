import {
  getAllWatchers,
  getWatcher,
  getWatcherProviderColor,
  getWatcherProviderIcon,
} from '@/services/watcher';

let fetchMock: ReturnType<typeof vi.fn>;

describe('Watcher Service', () => {
  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
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
    const mockWatchers = [{ id: 'docker.local' }];
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ data: mockWatchers, total: 1 }),
    });

    const result = await getAllWatchers();

    expect(fetchMock).toHaveBeenCalledWith('/api/watchers', { credentials: 'include' });
    expect(result).toEqual(mockWatchers);
  });

  it('supports array payload shape when listing watchers', async () => {
    const mockWatchers = [{ id: 'array-shape' }];
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(mockWatchers),
    });

    const result = await getAllWatchers();
    expect(result).toEqual(mockWatchers);
  });

  it('supports items payload shape when listing watchers', async () => {
    const mockWatchers = [{ id: 'items-shape' }];
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ items: mockWatchers }),
    });

    const result = await getAllWatchers();
    expect(result).toEqual(mockWatchers);
  });

  it('supports entries payload shape when listing watchers', async () => {
    const mockWatchers = [{ id: 'ignored' }];
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ entries: mockWatchers }),
    });

    const result = await getAllWatchers();
    expect(result).toEqual(mockWatchers);
  });

  it('returns empty array when watcher payload is not an object', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue('not-an-object'),
    });

    const result = await getAllWatchers();
    expect(result).toEqual([]);
  });

  it('throws when fetching all watchers fails', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      statusText: 'Internal Server Error',
      json: vi.fn().mockResolvedValue({}),
    });

    await expect(getAllWatchers()).rejects.toThrow('Failed to get watchers: Internal Server Error');
  });

  it('fetches a specific watcher by type and name', async () => {
    const mockWatcher = { id: 'docker.local', type: 'docker', name: 'local' };
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(mockWatcher),
    });

    const result = await getWatcher({ type: 'docker', name: 'local' });

    expect(fetchMock).toHaveBeenCalledWith('/api/watchers/docker/local', {
      credentials: 'include',
    });
    expect(result).toEqual(mockWatcher);
  });

  it('throws when fetching a specific watcher fails', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      statusText: 'Not Found',
      json: vi.fn().mockResolvedValue({}),
    });

    await expect(getWatcher({ type: 'docker', name: 'local' })).rejects.toThrow(
      'Failed to get watcher: Not Found',
    );
  });

  it('fetches an agent-scoped watcher when agent is provided', async () => {
    const mockWatcher = { id: 'edge.docker.local', type: 'docker', name: 'local', agent: 'edge' };
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(mockWatcher),
    });

    const result = await getWatcher({ agent: 'edge', type: 'docker', name: 'local' });

    expect(fetchMock).toHaveBeenCalledWith('/api/watchers/docker/local/edge', {
      credentials: 'include',
    });
    expect(result).toEqual(mockWatcher);
  });
});
