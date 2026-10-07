import {
  getLabelOverrides,
  LabelOverrideHttpError,
  patchLabelOverrides,
  resetLabelOverrides,
} from '@/services/label-override';

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    headers: { get: () => 'application/json' },
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

const snapshot = { containerId: 'c1', revision: 0, overrideId: null, fields: {}, warnings: [] };
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('label override service', () => {
  it('reads the snapshot for a container', async () => {
    fetchMock.mockResolvedValue(jsonResponse(snapshot));
    await expect(getLabelOverrides('a/b')).resolves.toEqual(snapshot);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/containers/a%2Fb/label-overrides', {
      credentials: 'include',
    });
  });

  it('patches one change with the revision and override id', async () => {
    const result = { ...snapshot, revision: 3, changed: ['displayName'] };
    fetchMock.mockResolvedValue(jsonResponse(result));
    await expect(
      patchLabelOverrides('c1', {
        revision: 2,
        overrideId: 'o1',
        changes: [{ field: 'displayName', op: 'set', value: 'TV' }],
      }),
    ).resolves.toEqual(result);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/containers/c1/label-overrides', {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        revision: 2,
        overrideId: 'o1',
        changes: [{ field: 'displayName', op: 'set', value: 'TV' }],
      }),
    });
  });

  it('omits the override id before a row exists', async () => {
    fetchMock.mockResolvedValue(jsonResponse(snapshot));
    await patchLabelOverrides('c1', {
      revision: 0,
      overrideId: null,
      changes: [{ field: 'displayIcon', op: 'remove' }],
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      revision: 0,
      changes: [{ field: 'displayIcon', op: 'remove' }],
    });
  });

  it('resets everything with the revision and override id in the query', async () => {
    fetchMock.mockResolvedValue(jsonResponse(snapshot));
    await expect(resetLabelOverrides('c 1', 4, 'o 1')).resolves.toEqual(snapshot);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/containers/c%201/label-overrides?revision=4&overrideId=o%201',
      { method: 'DELETE', credentials: 'include' },
    );
  });

  it('resets without an override id when no row exists', async () => {
    fetchMock.mockResolvedValue(jsonResponse(snapshot));
    await resetLabelOverrides('c1', 0, null);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/containers/c1/label-overrides?revision=0');
  });

  it('keeps the status, message and field errors of a rejected request', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          error: 'Invalid label override request',
          errors: [{ field: 'displayIcon', code: 'invalid-icon' }],
        },
        { ok: false, status: 400 },
      ),
    );
    const error = await patchLabelOverrides('c1', {
      revision: 0,
      overrideId: null,
      changes: [{ field: 'displayIcon', op: 'set', value: 'x' }],
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LabelOverrideHttpError);
    expect(error).toMatchObject({
      status: 400,
      message: 'Invalid label override request',
      errors: [{ field: 'displayIcon', code: 'invalid-icon' }],
    });
  });

  it('keeps the current snapshot, read-only reason and cycle of a conflict', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'stale', snapshot }, { ok: false, status: 409 }),
    );
    await expect(getLabelOverrides('c1')).rejects.toMatchObject({ status: 409, snapshot });
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { error: 'rollback', readOnlyReason: 'rollback-container' },
        { ok: false, status: 409 },
      ),
    );
    await expect(getLabelOverrides('c1')).rejects.toMatchObject({
      readOnlyReason: 'rollback-container',
    });
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'cycle', cycle: ['a', 'b'] }, { ok: false, status: 422 }),
    );
    await expect(getLabelOverrides('c1')).rejects.toMatchObject({ cycle: ['a', 'b'] });
  });

  it('ignores malformed error extras', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          error: 'x',
          errors: [{ field: 1 }, 'text', { field: 'f', code: 'c', entries: ['a', 2] }],
          snapshot: 'no',
          readOnlyReason: 5,
          cycle: 'no',
        },
        { ok: false, status: 400 },
      ),
    );
    const error = (await getLabelOverrides('c1').catch((caught: unknown) => caught)) as {
      errors: unknown[];
      snapshot: unknown;
      readOnlyReason: unknown;
      cycle: unknown;
    };
    expect(error.errors).toEqual([{ field: 'f', code: 'c', entries: ['a'] }]);
    expect(error.snapshot).toBeUndefined();
    expect(error.readOnlyReason).toBeUndefined();
    expect(error.cycle).toBeUndefined();
  });

  it('falls back to a status message when the error body is not usable', async () => {
    const bad = jsonResponse(null, { ok: false, status: 500 });
    vi.mocked(bad.json).mockRejectedValue(new Error('not json'));
    fetchMock.mockResolvedValueOnce(bad);
    await expect(getLabelOverrides('c1')).rejects.toMatchObject({
      status: 500,
      message: 'Label override request failed (HTTP 500)',
    });
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: '  ' }, { ok: false, status: 502 }));
    await expect(getLabelOverrides('c1')).rejects.toMatchObject({
      message: 'Label override request failed (HTTP 502)',
    });
    fetchMock.mockResolvedValueOnce(jsonResponse('text', { ok: false, status: 503 }));
    await expect(getLabelOverrides('c1')).rejects.toMatchObject({ status: 503 });
  });

  it('fails the write calls on a non-ok response too', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'no' }, { ok: false, status: 403 }));
    await expect(
      patchLabelOverrides('c1', { revision: 0, overrideId: null, changes: [] }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(resetLabelOverrides('c1', 1, 'o1')).rejects.toMatchObject({ status: 403 });
  });
});
