import { extractCollectionData, readJsonResponse } from '@/utils/api';

describe('extractCollectionData', () => {
  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

  it('returns direct array payloads', () => {
    const payload = [{ id: 'a' }, { id: 'b' }];

    expect(extractCollectionData(payload)).toEqual(payload);
  });

  it('returns data envelope payloads', () => {
    const payload = { data: [{ id: 'a' }, { id: 'b' }] };

    expect(extractCollectionData(payload)).toEqual(payload.data);
  });

  it('returns items envelope payloads', () => {
    const payload = { items: [{ id: 'a' }, { id: 'b' }] };

    expect(extractCollectionData(payload)).toEqual(payload.items);
  });

  it('returns entries envelope payloads', () => {
    const payload = { entries: [{ id: 'a' }, { id: 'b' }] };

    expect(extractCollectionData(payload)).toEqual(payload.entries);
  });

  it('returns direct arrays without validating entry shapes', () => {
    const payload = [{ id: 'a' }, 'non-object-entry', null];

    expect(extractCollectionData(payload)).toEqual(payload);
  });

  it('returns data envelope arrays without validating entry shapes', () => {
    const payload = { data: [{ id: 'a' }, 42] };

    expect(extractCollectionData(payload)).toEqual(payload.data);
  });

  it('returns empty array for null and undefined payloads', () => {
    expect(extractCollectionData(null)).toEqual([]);
    expect(extractCollectionData(undefined)).toEqual([]);
  });

  it.each([42, 'invalid', true])('returns empty array for primitive payloads (%p)', (payload) => {
    expect(extractCollectionData(payload)).toEqual([]);
  });

  it('returns empty array for envelope payloads without data/items arrays', () => {
    const payloads = [
      {},
      { data: undefined },
      { items: undefined },
      { data: null, items: null },
      { data: {}, items: 'invalid' },
    ];

    payloads.forEach((payload) => {
      expect(extractCollectionData(payload)).toEqual([]);
    });
  });

  it('prefers data over items when both envelopes contain arrays', () => {
    const payload = {
      data: [{ id: 'from-data' }],
      items: [{ id: 'from-items' }],
    };

    expect(extractCollectionData(payload)).toEqual(payload.data);
  });

  it('applies an item validator when provided', () => {
    const payload = { data: [{ id: 'a' }, { id: 'b' }] };

    expect(extractCollectionData(payload, isRecord)).toEqual(payload.data);
  });

  it('returns empty array when the item validator fails', () => {
    const payload = { data: [{ id: 'a' }, 42] };

    expect(extractCollectionData(payload, isRecord)).toEqual([]);
  });
});

describe('readJsonResponse', () => {
  it('throws a clearer error for invalid JSON payloads', async () => {
    const response = new Response('not-json', {
      headers: { 'content-type': 'application/json' },
    });

    await expect(readJsonResponse(response, 'Test API')).rejects.toThrow(
      'Test API returned invalid JSON.',
    );
  });

  it('uses the original response body when clone is unavailable while checking content type', async () => {
    const response = {
      headers: {
        get: () => 'text/html',
      },
      clone: undefined,
      bodyUsed: false,
      text: vi.fn().mockResolvedValue('<!DOCTYPE html><html></html>'),
    } as unknown as Response;

    await expect(readJsonResponse(response, 'Test API')).rejects.toThrow(
      'Test API returned HTML instead of JSON',
    );
  });

  it('does not consume an already-used body when clone is unavailable', async () => {
    const text = vi.fn();
    const response = {
      headers: {
        get: () => 'text/plain',
      },
      clone: undefined,
      bodyUsed: true,
      text,
    } as unknown as Response;

    await expect(readJsonResponse(response, 'Test API')).rejects.toThrow(
      'Test API returned text/plain instead of JSON.',
    );
    expect(text).not.toHaveBeenCalled();
  });

  it('falls back to the content-type message when preview reading fails', async () => {
    const response = {
      headers: {
        get: () => 'text/plain',
      },
      clone: vi.fn(() => {
        throw new Error('clone unavailable');
      }),
      text: vi.fn(),
    } as unknown as Response;

    await expect(readJsonResponse(response, 'Test API')).rejects.toThrow(
      'Test API returned text/plain instead of JSON.',
    );
  });
});
