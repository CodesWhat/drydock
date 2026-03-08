import { previewContainer } from '@/services/preview';

describe('preview service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('calls POST /api/containers/:id/preview', async () => {
    const mockResponse = { currentImage: 'nginx:1.0', newImage: 'nginx:1.1' };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const result = await previewContainer('abc-123');

    expect(global.fetch).toHaveBeenCalledWith('/api/containers/abc-123/preview', {
      method: 'POST',
      credentials: 'include',
    });
    expect(result).toEqual(mockResponse);
  });

  it('throws when response is not ok', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      statusText: 'Not Found',
    });

    await expect(previewContainer('bad-id')).rejects.toThrow('Preview failed: Not Found');
  });

  it('normalizes compose preview fields while preserving generic preview fields', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          containerName: 'web',
          currentImage: 'nginx:1.0',
          newImage: 'nginx:1.1',
          composeFiles: '/opt/stack/compose.yml,/opt/stack/compose.override.yml',
          composeService: 'web',
          composeWillWrite: false,
          composePatchPreview: '@@ -1,3 +1,3 @@',
        }),
    });

    const result = await previewContainer('compose-123');

    expect(result).toMatchObject({
      containerName: 'web',
      currentImage: 'nginx:1.0',
      newImage: 'nginx:1.1',
      compose: {
        files: ['/opt/stack/compose.yml', '/opt/stack/compose.override.yml'],
        service: 'web',
        willWrite: false,
        patch: '@@ -1,3 +1,3 @@',
      },
    });
  });
});
