import { getAppInfos } from '@/services/app';
import { getServer, getServerIcon } from '@/services/server';
import { getStore, getStoreIcon } from '@/services/store';

describe('App Service', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should get app infos', async () => {
    const mockResponse = { name: 'drydock', version: '1.0.0' };
    global.fetch.mockResolvedValue({
      json: vi.fn().mockResolvedValue(mockResponse),
    });

    const result = await getAppInfos();

    expect(global.fetch).toHaveBeenCalledWith('/api/app', { credentials: 'include' });
    expect(result).toEqual(mockResponse);
  });
});

describe('Server Service', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it('should return server icon', () => {
    expect(getServerIcon()).toBe('sh-server');
  });

  it('should get server data', async () => {
    const mockResponse = { configuration: {} };
    global.fetch.mockResolvedValue({
      json: vi.fn().mockResolvedValue(mockResponse),
    });

    const result = await getServer();

    expect(global.fetch).toHaveBeenCalledWith('/api/server', { credentials: 'include' });
    expect(result).toEqual(mockResponse);
  });
});

describe('Store Service', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it('should return store icon', () => {
    expect(getStoreIcon()).toBe('sh-copy');
  });

  it('should get store data', async () => {
    const mockResponse = { data: 'store' };
    global.fetch.mockResolvedValue({
      json: vi.fn().mockResolvedValue(mockResponse),
    });

    const result = await getStore();

    expect(global.fetch).toHaveBeenCalledWith('/api/store', { credentials: 'include' });
    expect(result).toEqual(mockResponse);
  });
});
