import { readFileSync } from 'node:fs';
import {
  getNotificationEditor,
  isNotificationProvider,
  NotificationEditorHttpError,
  notificationModes,
  notificationThresholds,
  saveNotificationEdits,
} from '@/services/notification-editor';
import { notificationOutcome, notificationSnapshot } from '../helpers/notification-editor';

describe('notification editor HTTP boundary', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('matches the existing trigger threshold choices, not notification-bell semantics', () => {
    const source = readFileSync('../app/triggers/providers/trigger-threshold.ts', 'utf8');
    const declaration = source
      .split('export const SUPPORTED_THRESHOLDS = [')[1]
      .split('] as const;')[0];
    expect(notificationThresholds).toEqual(
      [...declaration.matchAll(/'([^']+)'/g)].map((match) => match[1]),
    );
    expect(notificationModes).toEqual(['simple', 'batch', 'digest', 'batch+digest']);
    for (const type of ['docker', 'DOCKERCOMPOSE', 'portainer', 'command'])
      expect(isNotificationProvider(type)).toBe(false);
    expect(isNotificationProvider('discord')).toBe(true);
  });
  it.each([400, 409])('preserves session auth and HTTP%s refusals', async (status) => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(notificationSnapshot()))
      .mockResolvedValueOnce(
        Response.json(notificationOutcome({ status, saved: false, applied: false }), {
          status,
        }),
      );
    vi.stubGlobal('fetch', fetch);
    expect(await getNotificationEditor()).toEqual(notificationSnapshot());
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      '/api/v1/config/editor/triggers',
      expect.objectContaining({ credentials: 'include', signal: expect.any(AbortSignal) }),
    );
    const body = {
      revision: 'initial',
      changes: [
        {
          path: ['Notification', 'Discord', 'Policy', 'once'],
          operation: 'set' as const,
          value: false,
        },
      ],
    };
    expect(await saveNotificationEdits(body)).toMatchObject({ status, saved: false });
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual(body);
    expect(fetch.mock.calls[1][1]).toMatchObject({
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('reports snapshot status without attempting to parse a denied body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 403 })));
    await expect(getNotificationEditor()).rejects.toMatchObject({ status: 403 });
    expect(new NotificationEditorHttpError(504).message).toContain('504');
  });
  it.each([
    null,
    {},
    { saved: true },
    { saved: true, applied: true },
    { saved: true, applied: true, errors: [] },
    { saved: true, applied: true, errors: [], changedKeys: [] },
  ])('rejects incomplete save envelopes %j', async (body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(body)));
    await expect(
      saveNotificationEdits({ revision: 'initial', changes: [] }),
    ).rejects.toBeInstanceOf(NotificationEditorHttpError);
  });

  it.each([
    [401, 'Unauthorized', ''],
    [403, '<html>Forbidden</html>', 'text/html'],
    [429, 'Too many requests', 'text/plain'],
    [502, 'Bad gateway', 'text/plain'],
  ] as const)(
    'preserves HTTP%s when a save response is not JSON',
    async (status, body, contentType) => {
      const response = new Response(body, { status });
      response.headers.set('content-type', contentType);
      const fetch = vi.fn().mockResolvedValue(response);
      vi.stubGlobal('fetch', fetch);
      await expect(
        saveNotificationEdits({ revision: 'initial', changes: [] }),
      ).rejects.toMatchObject({ status });
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it('keeps malformed successful responses uncertain', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('invalid JSON', { headers: { 'content-type': 'application/json' } }),
        ),
    );
    await expect(saveNotificationEdits({ revision: 'initial', changes: [] })).rejects.toThrow(
      'returned invalid JSON',
    );
  });

  it.each([
    {},
    null,
    { errors: null },
    { errors: 'invalid' },
    { errors: [] },
    { applied: null, errors: [] },
    { applied: 'false', errors: [] },
    { applied: 0, errors: [] },
  ])('rejects malformed present reload %j', async (reload) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ ...notificationOutcome(), reload })),
    );
    await expect(saveNotificationEdits({ revision: 'initial', changes: [] })).rejects.toMatchObject(
      { status: 200 },
    );
  });

  it('preserves valid nested reload errors', async () => {
    const errors = [{ path: 'document', envKey: 'DD_CONFIG_FILE', message: 'Reload incomplete' }];
    const outcome = notificationOutcome({
      applied: false,
      errors,
      reload: { applied: false, errors },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(outcome)));
    await expect(saveNotificationEdits({ revision: 'initial', changes: [] })).resolves.toEqual(
      outcome,
    );
  });
});
