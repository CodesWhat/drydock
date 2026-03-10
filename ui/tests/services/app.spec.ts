import { getAppInfos } from '@/services/app';
import { getServer } from '@/services/server';

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
      ok: true,
      json: vi.fn().mockResolvedValue(mockResponse),
    });

    const result = await getAppInfos();

    expect(global.fetch).toHaveBeenCalledWith('/api/app', { credentials: 'include' });
    expect(result).toEqual(mockResponse);
  });

  it('should throw when fetching app infos fails', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      statusText: 'Internal Server Error',
      json: vi.fn().mockResolvedValue({}),
    });

    await expect(getAppInfos()).rejects.toThrow('Failed to get app infos: Internal Server Error');
  });
});

describe('Server Service', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it('should get server data', async () => {
    const mockResponse = { configuration: {} };
    global.fetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(mockResponse),
    });

    const result = await getServer();

    expect(global.fetch).toHaveBeenCalledWith('/api/server', { credentials: 'include' });
    expect(result).toEqual(mockResponse);
  });
});
