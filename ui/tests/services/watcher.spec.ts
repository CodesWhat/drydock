import { getWatcherIcon, getWatcherProviderIcon, getAllWatchers } from '@/services/watcher';

describe('Watcher Service', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it('should return watcher icon', () => {
    expect(getWatcherIcon()).toBe('fas fa-eye');
  });

  it('returns docker icon for docker provider', () => {
    expect(getWatcherProviderIcon('docker')).toBe('fab fa-docker');
  });

  it('returns default icon for unknown provider', () => {
    expect(getWatcherProviderIcon('kubernetes')).toBe('fas fa-eye');
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
