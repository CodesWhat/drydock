import { DEFAULTS } from '@/preferences/schema';
import { getPreferences, updatePreferences } from '@/services/preferences';

const envelope = {
  apiVersion: 1,
  username: 'alice',
  schemaVersion: 11,
  preferences: DEFAULTS,
  updatedAt: '2026-07-11T12:00:00.000Z',
};

describe('preferences service', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });
  afterEach(() => vi.resetAllMocks());

  it('gets and parses preferences', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(envelope),
    } as any);
    await expect(getPreferences()).resolves.toEqual(envelope);
    expect(fetch).toHaveBeenCalledWith('/api/v1/preferences', { credentials: 'include' });
  });

  it.each([
    [{ error: 'Sync unavailable' }, 403, 'Sync unavailable'],
    [{}, 500, 'HTTP 500'],
  ])('reports GET API errors', async (body, status, message) => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status,
      json: vi.fn().mockResolvedValue(body),
    } as any);
    await expect(getPreferences()).rejects.toThrow(message);
  });

  it('reports unparseable GET errors', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 502,
      json: vi.fn().mockRejectedValue(new Error()),
    } as any);
    await expect(getPreferences()).rejects.toThrow('Unknown error');
  });

  it('patches the complete preferences envelope', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(envelope),
    } as any);
    await expect(updatePreferences(11, DEFAULTS)).resolves.toEqual(envelope);
    expect(fetch).toHaveBeenCalledWith('/api/v1/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ apiVersion: 1, schemaVersion: 11, preferences: DEFAULTS }),
    });
  });

  it.each([
    [
      { error: 'PREFERENCES_API_VERSION_MISMATCH', supportedApiVersion: 1 },
      409,
      'PREFERENCES_API_VERSION_MISMATCH',
    ],
    [
      { error: 'Sync is not available in anonymous mode' },
      403,
      'Sync is not available in anonymous mode',
    ],
    [{}, 500, 'HTTP 500'],
  ])('reports PATCH API errors', async (body, status, message) => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status,
      json: vi.fn().mockResolvedValue(body),
    } as any);
    await expect(updatePreferences(11, DEFAULTS)).rejects.toThrow(message);
  });

  it('reports unparseable PATCH errors', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      json: vi.fn().mockRejectedValue(new Error()),
    } as any);
    await expect(updatePreferences(11, DEFAULTS)).rejects.toThrow('Unknown error');
  });
});
