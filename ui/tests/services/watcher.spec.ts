import { getWatcherIcon, getAllWatchers } from '@/services/watcher';

describe('Watcher Service', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it('should return watcher icon', () => {
    expect(getWatcherIcon()).toBe('mdi-update');
  });

  it('should get all watchers', async () => {
    const mockResponse = { watchers: [] };
    global.fetch.mockResolvedValue({
      json: vi.fn().mockResolvedValue(mockResponse)
    });

    const result = await getAllWatchers();

    expect(global.fetch).toHaveBeenCalledWith('/api/watchers', { credentials: 'include' });
    expect(result).toEqual(mockResponse);
  });
});