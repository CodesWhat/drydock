import {
  createGroupPolicy,
  deleteGroupPolicy,
  GroupPolicyHttpError,
  listGroupPolicies,
  replaceGroupPolicy,
} from '@/services/group-policy';

const policy = {
  id: 'p1',
  group: 'payments',
  revision: 2,
  updatePolicy: { maturityMode: 'mature' },
  actions: {},
  createdAt: '2026-10-01T00:00:00.000Z',
  createdBy: 'user:scott',
  updatedAt: '2026-10-01T00:00:00.000Z',
  updatedBy: 'user:scott',
  members: { count: 2, agents: [null, 'edge1'] },
};

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    headers: { get: () => 'application/json' },
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('group policy service', () => {
  it('lists policies with their members', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [policy], total: 1 }));
    await expect(listGroupPolicies()).resolves.toEqual([policy]);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/group-policies', { credentials: 'include' });
  });

  it('treats a body without a data array as an empty list', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    await expect(listGroupPolicies()).resolves.toEqual([]);
  });

  it('throws an http error that keeps the status and the server message', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'nope' }, { ok: false, status: 403 }));
    const error = await listGroupPolicies().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(GroupPolicyHttpError);
    expect(error).toMatchObject({ status: 403, message: 'nope' });
  });

  it('falls back to a status message when the error body is not usable', async () => {
    const bad = jsonResponse(null, { ok: false, status: 500 });
    vi.mocked(bad.json).mockRejectedValue(new Error('not json'));
    fetchMock.mockResolvedValueOnce(bad);
    await expect(listGroupPolicies()).rejects.toMatchObject({
      status: 500,
      message: 'Group policy request failed (HTTP 500)',
    });
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: '   ' }, { ok: false, status: 502 }));
    await expect(listGroupPolicies()).rejects.toMatchObject({
      message: 'Group policy request failed (HTTP 502)',
    });
    fetchMock.mockResolvedValueOnce(jsonResponse('text', { ok: false, status: 503 }));
    await expect(listGroupPolicies()).rejects.toMatchObject({
      message: 'Group policy request failed (HTTP 503)',
    });
  });

  it('creates a policy and omits empty bodies', async () => {
    const result = { policy, applied: { members: 2 }, warnings: [] };
    fetchMock.mockResolvedValue(jsonResponse(result, { status: 201 }));
    await expect(
      createGroupPolicy(' payments ', {
        updatePolicy: { maturityMode: 'mature' },
        actions: {},
      }),
    ).resolves.toEqual(result);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/group-policies', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group: ' payments ', updatePolicy: { maturityMode: 'mature' } }),
    });
  });

  it('creates with action rules only', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ policy, applied: { members: 0 }, warnings: [] }));
    await createGroupPolicy('g', { updatePolicy: {}, actions: { updateMode: 'manual' } });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      group: 'g',
      actions: { updateMode: 'manual' },
    });
  });

  it('surfaces a create failure', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'exists' }, { ok: false, status: 409 }));
    await expect(createGroupPolicy('g', { updatePolicy: {}, actions: {} })).rejects.toMatchObject({
      status: 409,
      message: 'exists',
    });
  });

  it('replaces a policy by id with the revision', async () => {
    const result = { changed: true, policy, applied: { members: 1 }, warnings: ['w'] };
    fetchMock.mockResolvedValue(jsonResponse(result));
    await expect(
      replaceGroupPolicy('a/b', 2, { updatePolicy: {}, actions: { exclude: ['docker.local'] } }),
    ).resolves.toEqual(result);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/group-policies/a%2Fb', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision: 2, actions: { exclude: ['docker.local'] } }),
    });
  });

  it('surfaces a stale replace', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'stale' }, { ok: false, status: 409 }));
    await expect(
      replaceGroupPolicy('p1', 1, { updatePolicy: {}, actions: {} }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('deletes with the revision in the query', async () => {
    const result = { changed: true, policy, applied: { members: 2 }, warnings: [] };
    fetchMock.mockResolvedValue(jsonResponse(result));
    await expect(deleteGroupPolicy('p 1', 3)).resolves.toEqual(result);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/group-policies/p%201?revision=3', {
      method: 'DELETE',
      credentials: 'include',
    });
  });

  it('surfaces a stale delete', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'stale' }, { ok: false, status: 409 }));
    await expect(deleteGroupPolicy('p1', 1)).rejects.toMatchObject({ status: 409 });
  });
});
