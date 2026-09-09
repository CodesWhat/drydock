import { getImages, getPrunePreview, pruneImages } from '@/services/images';
import { ApiError } from '@/utils/error';

describe('images service', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('getImages', () => {
    it('fetches /api/v1/images with no query string when called with no args', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ data: [], total: 0, hosts: [] }),
      });

      await getImages();

      expect(global.fetch).toHaveBeenCalledWith('/api/v1/images', { credentials: 'include' });
    });

    it('encodes host in the query string when provided', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ data: [], total: 0, hosts: [] }),
      });

      await getImages({ host: 'edge 1' });

      expect(global.fetch).toHaveBeenCalledWith('/api/v1/images?host=edge+1', {
        credentials: 'include',
      });
    });

    it('unwraps data into images and hosts from the collection envelope', async () => {
      const image = {
        id: 'sha256:abc',
        repoTags: ['app:latest'],
        repoDigests: ['app@sha256:abc'],
        size: 1024,
        reclaimable: 512,
        created: '2026-08-01T00:00:00.000Z',
        containers: 1,
        dangling: false,
        watcher: 'local',
      };
      const host = { id: 'host-1', name: 'local', supported: true };
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ data: [image], total: 1, hosts: [host] }),
      });

      const result = await getImages();

      expect(result).toEqual({ images: [image], hosts: [host] });
    });

    it('defaults hosts to an empty array when the envelope omits it', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ data: [], total: 0 }),
      });

      const result = await getImages();

      expect(result.hosts).toEqual([]);
    });

    it('throws an ApiError with the body error message on failure', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: vi.fn().mockResolvedValue({ error: 'Invalid host' }),
      });

      const err = await getImages().catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).message).toBe('Invalid host');
      expect((err as ApiError).status).toBe(400);
    });

    it('falls back to statusText when the error body cannot be parsed', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: vi.fn().mockRejectedValue(new Error('not json')),
      });

      const err = await getImages().catch((e: unknown) => e);

      expect((err as ApiError).message).toBe('Failed to load images: Internal Server Error');
    });
  });

  describe('getPrunePreview', () => {
    it('fetches /api/v1/images/prune-preview with host and mode', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: vi
          .fn()
          .mockResolvedValue({ host: 'host-1', mode: 'dangling', images: 3, reclaimable: 2048 }),
      });

      const result = await getPrunePreview({ host: 'host-1', mode: 'dangling' });

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/v1/images/prune-preview?host=host-1&mode=dangling',
        { credentials: 'include' },
      );
      expect(result).toEqual({ host: 'host-1', mode: 'dangling', images: 3, reclaimable: 2048 });
    });

    it('encodes the host in the query string', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: vi
          .fn()
          .mockResolvedValue({ host: 'edge 1', mode: 'unused', images: 0, reclaimable: 0 }),
      });

      await getPrunePreview({ host: 'edge 1', mode: 'unused' });

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/v1/images/prune-preview?host=edge+1&mode=unused',
        { credentials: 'include' },
      );
    });

    it('throws an ApiError with the body error message on failure', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: vi.fn().mockResolvedValue({ error: 'Unknown host' }),
      });

      const err = await getPrunePreview({ host: 'missing', mode: 'unused' }).catch(
        (e: unknown) => e,
      );

      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).message).toBe('Unknown host');
      expect((err as ApiError).status).toBe(404);
    });

    it('falls back to statusText when the error body cannot be parsed', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: vi.fn().mockRejectedValue(new Error('not json')),
      });

      const err = await getPrunePreview({ host: 'host-1', mode: 'dangling' }).catch(
        (e: unknown) => e,
      );

      expect((err as ApiError).message).toBe('Failed to load prune preview: Internal Server Error');
    });
  });

  describe('pruneImages', () => {
    it('POSTs to /api/v1/images/prune with the confirm-action header and unwraps the result', async () => {
      const result = { host: 'host-1', mode: 'dangling', imagesDeleted: 2, spaceReclaimed: 4096 };
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ message: 'Images pruned', result }),
      });

      const outcome = await pruneImages({ host: 'host-1', mode: 'dangling' });

      expect(global.fetch).toHaveBeenCalledWith('/api/v1/images/prune', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-DD-Confirm-Action': 'image-prune',
        },
        body: JSON.stringify({ host: 'host-1', mode: 'dangling' }),
      });
      expect(outcome).toEqual(result);
    });

    it('throws an ApiError with the body error message on failure', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 409,
        statusText: 'Conflict',
        json: vi.fn().mockResolvedValue({ error: 'Prune already in progress' }),
      });

      const err = await pruneImages({ host: 'host-1', mode: 'unused' }).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).message).toBe('Prune already in progress');
      expect((err as ApiError).status).toBe(409);
    });

    it('falls back to statusText when the error body cannot be parsed', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: vi.fn().mockRejectedValue(new Error('not json')),
      });

      const err = await pruneImages({ host: 'host-1', mode: 'unused' }).catch((e: unknown) => e);

      expect((err as ApiError).message).toBe('Failed to prune images: Internal Server Error');
    });
  });
});
