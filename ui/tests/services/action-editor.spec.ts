import {
  ActionEditorHttpError,
  actionAutoModes,
  getActionEditor,
  isActionProvider,
  saveActionEdits,
} from '@/services/action-editor';
import { actionOutcome, actionSnapshot } from '../helpers/action-editor';

describe('action editor HTTP boundary', () => {
  afterEach(() => vi.unstubAllGlobals());
  const request = {
    revision: 'initial',
    changes: [
      { path: ['Action', 'Docker', 'Policy', 'order'], operation: 'set' as const, value: -2.5 },
    ],
  };
  it('uses session credentials, exact typed leaves and the action endpoint', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(actionSnapshot()))
      .mockResolvedValueOnce(Response.json(actionOutcome()));
    vi.stubGlobal('fetch', fetch);
    expect(await getActionEditor()).toEqual(actionSnapshot());
    expect(await saveActionEdits(request)).toEqual(actionOutcome());
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      '/api/v1/config/editor/actions',
      expect.objectContaining({ credentials: 'include', signal: expect.any(AbortSignal) }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/api/v1/config/editor/actions',
      expect.objectContaining({
        method: 'PATCH',
        credentials: 'include',
        body: JSON.stringify(request),
        signal: expect.any(AbortSignal),
      }),
    );
    expect(actionAutoModes).toEqual(['all', 'oninclude', 'onauto', 'none']);
    for (const type of ['docker', 'DOCKERCOMPOSE', 'command', 'portainer'])
      expect(isActionProvider(type)).toBe(true);
    expect(isActionProvider('discord')).toBe(false);
  });
  it.each([401, 403, 404, 429, 501])('preserves snapshot HTTP%s', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status })));
    await expect(getActionEditor()).rejects.toMatchObject({ status });
  });
  it.each([400, 409])('retains valid refusal HTTP%s', async (status) => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json(actionOutcome({ saved: false, applied: false }), { status }),
        ),
    );
    expect(await saveActionEdits(request)).toMatchObject({ status, saved: false });
  });
  it.each([
    null,
    {},
    { saved: true },
    { saved: true, applied: true },
    { saved: true, applied: true, errors: [] },
    { saved: true, applied: true, errors: [], changedKeys: [] },
  ])('refuses incomplete envelope %j', async (body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(body)));
    await expect(saveActionEdits(request)).rejects.toBeInstanceOf(ActionEditorHttpError);
  });
  it.each([
    null,
    {},
    { errors: [] },
    { applied: 'false', errors: [] },
    { applied: false, errors: null },
  ])('refuses malformed reload %j', async (reload) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ ...actionOutcome(), reload })),
    );
    await expect(saveActionEdits(request)).rejects.toMatchObject({ status: 200 });
  });
  it('preserves valid nested false rather than claiming application', async () => {
    const outcome = actionOutcome({ reload: { applied: false, errors: [] } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(outcome)));
    expect(await saveActionEdits(request)).toEqual(outcome);
  });
  it.each([403, 429, 502])('preserves HTTP%s with a non-JSON error', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Denied', { status })));
    await expect(saveActionEdits(request)).rejects.toMatchObject({ status });
  });
  it('keeps invalid success JSON uncertain', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('bad', { headers: { 'content-type': 'application/json' } }),
        ),
    );
    await expect(saveActionEdits(request)).rejects.toThrow('invalid JSON');
  });
});
