import {
  getAllWatchers,
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
});
