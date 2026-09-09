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
  it('loads via session and preserves a valid error outcome without retrying', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(notificationSnapshot()))
      .mockResolvedValueOnce(
        Response.json(notificationOutcome({ status: 409, saved: false, applied: false }), {
          status: 409,
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
    expect(await saveNotificationEdits(body)).toMatchObject({ status: 409, saved: false });
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
});
