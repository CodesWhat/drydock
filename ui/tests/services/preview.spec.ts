import { normalizePreviewPayload, previewContainer } from '@/services/preview';

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

    expect(global.fetch).toHaveBeenCalledWith('/api/v1/containers/abc-123/preview', {
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

  it('deduplicates compose files collected from compose context variants', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          compose: {
            files: ['__dedupe_probe__/a.yml', '__dedupe_probe__/b.yml'],
            composeFiles: ['__dedupe_probe__/a.yml'],
          },
          composePreview: {
            paths: ['__dedupe_probe__/b.yml', '__dedupe_probe__/c.yml'],
          },
          composeContext: {
            file: '__dedupe_probe__/c.yml',
          },
          composeFiles: '__dedupe_probe__/a.yml,__dedupe_probe__/d.yml',
          composePaths: '__dedupe_probe__/d.yml',
          compose_file: '__dedupe_probe__/e.yml',
        }),
    });

    const result = await previewContainer('compose-dedupe');

    expect(result.compose?.files).toEqual([
      '__dedupe_probe__/a.yml',
      '__dedupe_probe__/b.yml',
      '__dedupe_probe__/c.yml',
      '__dedupe_probe__/d.yml',
      '__dedupe_probe__/e.yml',
    ]);
  });

  it('normalizes patch arrays and infers willWrite from dryRun when explicit write flags are absent', () => {
    const result = normalizePreviewPayload({
      compose: {
        files: [' /opt/stack/compose.yml ', '', 42],
        patch: ['@@ -1,3 +1,3 @@  ', '   ', '+ image: nginx:1.1', null],
      },
      composePreview: {
        composeFiles: '["/opt/stack/compose.yml", "/opt/stack/compose.override.yml"]',
      },
      dryRun: true,
    });

    expect(result.compose).toEqual({
      files: ['/opt/stack/compose.yml', '/opt/stack/compose.override.yml'],
      patch: '@@ -1,3 +1,3 @@\n+ image: nginx:1.1',
      willWrite: false,
    });
  });

  it('infers compose.willWrite=true when dryRun is false and compose metadata exists', () => {
    const result = normalizePreviewPayload({
      composePreview: {
        service: 'api',
      },
      dryRun: false,
    });

    expect(result.compose).toEqual({
      files: [],
      service: 'api',
      willWrite: true,
    });
  });

  it('returns an empty payload when preview payload is invalid', () => {
    expect(normalizePreviewPayload(null)).toEqual({});
    expect(normalizePreviewPayload('invalid')).toEqual({});
    expect(normalizePreviewPayload(['invalid'])).toEqual({});
  });

  it('treats blank compose string fields as empty and omits compose when no details remain', () => {
    const result = normalizePreviewPayload({
      composeFiles: '   ',
      composePaths: '\n  ',
    });

    expect(result).toEqual({
      composeFiles: '   ',
      composePaths: '\n  ',
    });
    expect(result.compose).toBeUndefined();
  });

  it('omits malformed empty compose objects instead of inferring compose details', () => {
    const result = normalizePreviewPayload({
      compose: {},
      composePreview: {},
      composeContext: {},
      dryRun: false,
    });

    expect(result.compose).toBeUndefined();
    expect(result).toEqual({
      composePreview: {},
      composeContext: {},
      dryRun: false,
    });
  });

  it('falls back from blank service values, keeps writable file details, and tolerates non-array parse results', () => {
    const parseSpy = vi.spyOn(JSON, 'parse').mockReturnValueOnce({ unexpected: true });

    const result = normalizePreviewPayload({
      composeFiles: '["/opt/stack/compose.yml"]',
      compose: {
        service: '   ',
      },
      composeService: 'api',
      composeWritableFile: '/opt/stack/compose.yml',
      composePatch: '',
    });

    expect(result.compose).toEqual({
      files: ['["/opt/stack/compose.yml"]'],
      service: 'api',
      writableFile: '/opt/stack/compose.yml',
    });

    parseSpy.mockRestore();
  });

  it('drops empty patch arrays from compose preview metadata', () => {
    const result = normalizePreviewPayload({
      compose: {
        patch: ['   ', '', '\t'],
      },
    });

    expect(result.compose).toBeUndefined();
  });
});
