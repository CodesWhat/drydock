const { mockFindBundledIconPath } = vi.hoisted(() => ({
  mockFindBundledIconPath: vi.fn(),
}));

vi.mock('./storage.js', () => ({
  findBundledIconPath: mockFindBundledIconPath,
}));

import { sendCachedIcon, sendMissingIconResponse } from './response.js';

function createResponse() {
  return {
    set: vi.fn().mockReturnThis(),
    type: vi.fn().mockReturnThis(),
    sendFile: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  };
}

describe('icons/response', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockFindBundledIconPath.mockResolvedValue(null);
  });

  test('sends cached icon with immutable cache control headers', () => {
    const res = createResponse();

    sendCachedIcon(res as never, '/store/icons/simple/docker.svg', 'image/svg+xml');

    expect(res.set).toHaveBeenCalledWith('Cache-Control', 'public, max-age=31536000, immutable');
    expect(res.type).toHaveBeenCalledWith('image/svg+xml');
    expect(res.sendFile).toHaveBeenCalledWith('docker.svg', {
      root: '/store/icons/simple',
    });
  });

  test('serves bundled fallback image for browser image requests', async () => {
    mockFindBundledIconPath.mockResolvedValue('/runtime/assets/icons/selfhst/docker.png');
    const res = createResponse();

    await sendMissingIconResponse({
      req: {
        headers: {
          'sec-fetch-dest': 'image',
        },
      } as never,
      res: res as never,
      errorMessage: 'Icon selfhst/missing was not found',
    });

    expect(mockFindBundledIconPath).toHaveBeenCalledWith('selfhst', 'docker', 'png');
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    expect(res.sendFile).toHaveBeenCalledWith('docker.png', {
      root: '/runtime/assets/icons/selfhst',
    });
  });

  test('supports image fallback detection when accept header is an array', async () => {
    mockFindBundledIconPath.mockResolvedValue('/runtime/assets/icons/selfhst/docker.png');
    const res = createResponse();

    await sendMissingIconResponse({
      req: {
        headers: {
          accept: ['text/html', 'image/webp'],
        },
      } as never,
      res: res as never,
      errorMessage: 'Icon selfhst/missing was not found',
    });

    expect(res.sendFile).toHaveBeenCalledWith('docker.png', {
      root: '/runtime/assets/icons/selfhst',
    });
  });

  test('returns 404 metadata when request is not image-oriented', async () => {
    const res = createResponse();

    await sendMissingIconResponse({
      req: {
        headers: {
          accept: 'text/html',
        },
      } as never,
      res: res as never,
      errorMessage: 'Icon simple/missing was not found',
    });

    expect(mockFindBundledIconPath).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Icon simple/missing was not found',
      fallbackIcon: 'fab fa-docker',
    });
  });

  test('returns 404 metadata when fallback image cannot be found', async () => {
    mockFindBundledIconPath.mockResolvedValue(null);
    const res = createResponse();

    await sendMissingIconResponse({
      req: {
        headers: {
          accept: 'image/png',
        },
      } as never,
      res: res as never,
      errorMessage: 'Icon selfhst/missing was not found',
    });

    expect(mockFindBundledIconPath).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Icon selfhst/missing was not found',
      fallbackIcon: 'fab fa-docker',
    });
  });
});
