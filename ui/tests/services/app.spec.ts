import { getAppInfos } from '@/services/app';
import { getServer } from '@/services/server';

let fetchMock: ReturnType<typeof vi.fn>;

describe('App Service', () => {
  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should get app infos', async () => {
    const mockResponse = { name: 'drydock', version: '1.0.0' };
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(mockResponse),
    });

    const result = await getAppInfos();

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/app', { credentials: 'include' });
    expect(result).toEqual(mockResponse);
  });

  it('should throw when fetching app infos fails', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      statusText: 'Internal Server Error',
      json: vi.fn().mockResolvedValue({}),
    });

    await expect(getAppInfos()).rejects.toThrow('Failed to get app infos: Internal Server Error');
  });
});

describe('Server Service', () => {
  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('should get server data', async () => {
    const mockResponse = { configuration: {} };
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(mockResponse),
    });

    const result = await getServer();

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/server', { credentials: 'include' });
    expect(result).toEqual(mockResponse);
  });
});
