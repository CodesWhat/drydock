import {
  deleteOutboxEntry,
  getOutboxEntries,
  type NotificationOutboxEntry,
  type NotificationOutboxResponse,
  retryOutboxEntry,
} from '@/services/notification-outbox';

function makeEntry(overrides: Partial<NotificationOutboxEntry> = {}): NotificationOutboxEntry {
  return {
    id: 'entry-1',
    eventName: 'update-available',
    triggerId: 'slack.ops',
    attempts: 1,
    maxAttempts: 3,
    nextAttemptAt: '2026-04-29T10:00:00.000Z',
    status: 'dead-letter',
    createdAt: '2026-04-29T09:00:00.000Z',
    payload: {},
    ...overrides,
  };
}

function makeResponse(
  overrides: Partial<NotificationOutboxResponse> = {},
): NotificationOutboxResponse {
  return {
    data: [makeEntry()],
    total: 1,
    counts: { pending: 0, delivered: 0, deadLetter: 1 },
    ...overrides,
  };
}

describe('notification-outbox service', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('getOutboxEntries', () => {
    it('fetches /api/notifications/outbox without status param when called with no args', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(makeResponse()),
      });

      const result = await getOutboxEntries();

      expect(global.fetch).toHaveBeenCalledWith('/api/notifications/outbox', {
        credentials: 'include',
      });
      expect(result).toEqual(makeResponse());
    });

    it('appends ?status=pending when called with pending', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(makeResponse({ data: [], total: 0 })),
      });

      await getOutboxEntries('pending');

      expect(global.fetch).toHaveBeenCalledWith('/api/notifications/outbox?status=pending', {
        credentials: 'include',
      });
    });

    it('appends ?status=delivered when called with delivered', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(makeResponse()),
      });

      await getOutboxEntries('delivered');

      expect(global.fetch).toHaveBeenCalledWith('/api/notifications/outbox?status=delivered', {
        credentials: 'include',
      });
    });

    it('appends ?status=dead-letter (URL-encoded) when called with dead-letter', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(makeResponse()),
      });

      await getOutboxEntries('dead-letter');

      expect(global.fetch).toHaveBeenCalledWith('/api/notifications/outbox?status=dead-letter', {
        credentials: 'include',
      });
    });

    it('throws with server error message from body on !ok', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        statusText: 'Internal Server Error',
        json: vi.fn().mockResolvedValue({ error: 'Database unavailable' }),
      });

      await expect(getOutboxEntries()).rejects.toThrow('Database unavailable');
    });

    it('falls back to statusText when body parse fails on !ok', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        statusText: 'Service Unavailable',
        json: vi.fn().mockRejectedValue(new Error('not json')),
      });

      await expect(getOutboxEntries()).rejects.toThrow(
        'Failed to load outbox: Service Unavailable',
      );
    });

    it('falls back to statusText when body has no error field on !ok', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        statusText: 'Bad Gateway',
        json: vi.fn().mockResolvedValue({}),
      });

      await expect(getOutboxEntries()).rejects.toThrow('Failed to load outbox: Bad Gateway');
    });
  });

  describe('retryOutboxEntry', () => {
    it('POSTs to /api/notifications/outbox/:id/retry and returns parsed entry', async () => {
      const entry = makeEntry({ id: 'entry-42', status: 'pending' });
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(entry),
      });

      const result = await retryOutboxEntry('entry-42');

      expect(global.fetch).toHaveBeenCalledWith('/api/notifications/outbox/entry-42/retry', {
        method: 'POST',
        credentials: 'include',
      });
      expect(result).toEqual(entry);
    });

    it('URL-encodes special characters in the id', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(makeEntry()),
      });

      await retryOutboxEntry('entry/with spaces');

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/notifications/outbox/entry%2Fwith%20spaces/retry',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('throws with body error on !ok and attaches statusCode', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 409,
        statusText: 'Conflict',
        json: vi.fn().mockResolvedValue({ error: 'Already retrying' }),
      });

      const err = await retryOutboxEntry('entry-1').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe('Already retrying');
      expect((err as Error & { statusCode?: number }).statusCode).toBe(409);
    });

    it('falls back to statusText and attaches statusCode when body parse fails on !ok', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: vi.fn().mockRejectedValue(new Error('not json')),
      });

      const err = await retryOutboxEntry('entry-1').catch((e: unknown) => e);
      expect((err as Error).message).toBe('Failed to retry entry: Internal Server Error');
      expect((err as Error & { statusCode?: number }).statusCode).toBe(500);
    });
  });

  describe('deleteOutboxEntry', () => {
    it('DELETEs /api/notifications/outbox/:id and resolves undefined on success', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({}),
      });

      const result = await deleteOutboxEntry('entry-99');

      expect(global.fetch).toHaveBeenCalledWith('/api/notifications/outbox/entry-99', {
        method: 'DELETE',
        credentials: 'include',
      });
      expect(result).toBeUndefined();
    });

    it('URL-encodes special characters in the id', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({}),
      });

      await deleteOutboxEntry('entry/with spaces');

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/notifications/outbox/entry%2Fwith%20spaces',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });

    it('throws with body error on !ok and attaches statusCode', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: vi.fn().mockResolvedValue({ error: 'Entry not found' }),
      });

      const err = await deleteOutboxEntry('missing').catch((e: unknown) => e);
      expect((err as Error).message).toBe('Entry not found');
      expect((err as Error & { statusCode?: number }).statusCode).toBe(404);
    });

    it('falls back to statusText and attaches statusCode when body parse fails on !ok', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        json: vi.fn().mockRejectedValue(new Error('not json')),
      });

      const err = await deleteOutboxEntry('entry-1').catch((e: unknown) => e);
      expect((err as Error).message).toBe('Failed to delete entry: Service Unavailable');
      expect((err as Error & { statusCode?: number }).statusCode).toBe(503);
    });
  });
});
