import { ddEnvVars } from '../configuration/index.js';
import { recordSuppressed, resetSuppressionForTests } from '../notifications/suppression.js';
import * as silenceStore from '../store/notification-silence.js';
import { createMockResponse } from '../test/helpers.js';
import * as silenceRouter from './notification-silence.js';

const { mockRecordAuditEvent, mockGetAuditActorForRequest } = vi.hoisted(() => ({
  mockRecordAuditEvent: vi.fn(),
  mockGetAuditActorForRequest: vi.fn(() => 'scott'),
}));

vi.mock('./audit-events.js', () => ({ recordAuditEvent: mockRecordAuditEvent }));
vi.mock('./audit-actor.js', () => ({ getAuditActorForRequest: mockGetAuditActorForRequest }));
vi.mock('../store/notification.js', () => ({
  getNotificationRule: vi.fn((id: string) => (id === 'missing' ? undefined : { id })),
}));
vi.mock('../log/index.js', () => ({
  default: { child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }) },
}));

function handlers() {
  const router = silenceRouter.init() as any;
  const find = (method: string, path: string) =>
    router.stack.find((layer: any) => layer.route?.path === path && layer.route.methods[method])
      .route.stack[0].handle;
  return {
    list: find('get', '/'),
    create: find('post', '/'),
    remove: find('delete', '/:id'),
  };
}

beforeEach(() => {
  silenceStore.resetSilencesForTests();
  resetSuppressionForTests();
  mockRecordAuditEvent.mockClear();
  mockGetAuditActorForRequest.mockReturnValue('scott');
  delete ddEnvVars.DD_ALERTS_QUIETHOURS_SCHEDULE;
});

afterEach(() => {
  silenceStore.resetSilencesForTests();
  delete ddEnvVars.DD_ALERTS_QUIETHOURS_SCHEDULE;
});

describe('notification silence routes', () => {
  test('creates a rule silence with a duration and records an audit entry', () => {
    const res = createMockResponse();
    handlers().create(
      { body: { ruleId: 'Container-Stopped', durationMinutes: 30, reason: 'deploy window' } },
      res,
    );

    expect(res.status).toHaveBeenCalledWith(201);
    const silence = (res.json as any).mock.calls[0][0];
    expect(silence).toMatchObject({
      ruleId: 'container-stopped',
      reason: 'deploy window',
      createdBy: 'scott',
    });
    expect(Date.parse(silence.expiresAt) - Date.parse(silence.createdAt)).toBe(30 * 60_000);
    expect(mockRecordAuditEvent).toHaveBeenCalledWith({
      action: 'notification-silence-set',
      status: 'success',
      containerName: 'notifications',
      details: `rule=container-stopped; expires=${silence.expiresAt}; reason=deploy window`,
    });
  });

  test('creates a global silence from an absolute expiry, without a reason', () => {
    const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
    const res = createMockResponse();
    handlers().create({ body: { expiresAt, reason: '' } }, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const silence = (res.json as any).mock.calls[0][0];
    expect(silence.ruleId).toBeUndefined();
    expect(silence.reason).toBeUndefined();
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ details: `rule=all; expires=${silence.expiresAt}` }),
    );
  });

  test.each([
    ['neither duration nor expiry', {}],
    ['both duration and expiry', { durationMinutes: 5, expiresAt: '2999-01-01T00:00:00Z' }],
    ['a zero duration', { durationMinutes: 0 }],
    ['an over-long duration', { durationMinutes: 999_999 }],
    ['a long reason', { durationMinutes: 5, reason: 'x'.repeat(201) }],
  ])('rejects %s', (_name, body) => {
    const res = createMockResponse();
    handlers().create({ body }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(silenceStore.getActiveSilences()).toEqual([]);
    expect(mockRecordAuditEvent).not.toHaveBeenCalled();
  });

  test('rejects a missing body', () => {
    const res = createMockResponse();
    handlers().create({}, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('rejects an expiry in the past or beyond the maximum', () => {
    const past = createMockResponse();
    handlers().create({ body: { expiresAt: '2020-01-01T00:00:00Z' } }, past);
    expect(past.status).toHaveBeenCalledWith(400);

    const far = createMockResponse();
    handlers().create({ body: { expiresAt: '2999-01-01T00:00:00Z' } }, far);
    expect(far.status).toHaveBeenCalledWith(400);
    expect(silenceStore.getActiveSilences()).toEqual([]);
  });

  test('answers 404 for an unknown rule', () => {
    const res = createMockResponse();
    handlers().create({ body: { ruleId: 'missing', durationMinutes: 5 } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('answers 500 when the silence cannot be stored', () => {
    for (let i = 0; i < silenceStore.MAX_NOTIFICATION_SILENCES; i += 1) {
      silenceStore.addSilence({ expiresAt: new Date(Date.now() + 60_000) });
    }
    const res = createMockResponse();
    handlers().create({ body: { durationMinutes: 5 } }, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  test('lists active silences, quiet hours state and suppressed counts', () => {
    ddEnvVars.DD_ALERTS_QUIETHOURS_SCHEDULE = '00:00-24:00';
    silenceStore.addSilence({ expiresAt: new Date(Date.now() + 60_000) });
    recordSuppressed('container-stopped', 'quiet-hours');

    const res = createMockResponse();
    handlers().list({}, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect((res.json as any).mock.calls[0][0]).toMatchObject({
      total: 1,
      quietHours: {
        schedule: '00:00-24:00',
        timezone: 'UTC',
        rules: [],
        exempt: ['security-alert', 'update-failed'],
        activeNow: true,
      },
      suppressed: [{ ruleId: 'container-stopped', reason: 'quiet-hours', count: 1 }],
    });
  });

  test('lists null quiet hours when none are configured', () => {
    const res = createMockResponse();
    handlers().list({}, res);
    expect((res.json as any).mock.calls[0][0]).toMatchObject({
      data: [],
      total: 0,
      quietHours: null,
    });
  });

  test('deletes a silence and records an audit entry, then 404s on a repeat', () => {
    const silence = silenceStore.addSilence({
      ruleId: 'agent-disconnect',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const res = createMockResponse();
    handlers().remove({ params: { id: silence.id } }, res);

    expect(res.status).toHaveBeenCalledWith(204);
    expect(mockRecordAuditEvent).toHaveBeenCalledWith({
      action: 'notification-silence-cleared',
      status: 'success',
      containerName: 'notifications',
      details: `rule=agent-disconnect; was set to expire ${silence.expiresAt}`,
    });

    const global = silenceStore.addSilence({ expiresAt: new Date(Date.now() + 60_000) });
    handlers().remove({ params: { id: global.id } }, createMockResponse());
    expect(mockRecordAuditEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({ details: expect.stringContaining('rule=all;') }),
    );

    const again = createMockResponse();
    handlers().remove({ params: { id: silence.id } }, again);
    expect(again.status).toHaveBeenCalledWith(404);
  });

  test('answers 500 when listing or deleting throws', () => {
    const spy = vi.spyOn(silenceStore, 'getActiveSilences').mockImplementation(() => {
      throw new Error('boom');
    });
    const listRes = createMockResponse();
    handlers().list({}, listRes);
    expect(listRes.status).toHaveBeenCalledWith(500);
    spy.mockRestore();

    const removeSpy = vi.spyOn(silenceStore, 'removeSilence').mockImplementation(() => {
      throw new Error('boom');
    });
    const removeRes = createMockResponse();
    handlers().remove({ params: { id: 'x' } }, removeRes);
    expect(removeRes.status).toHaveBeenCalledWith(500);
    removeSpy.mockRestore();
  });
});
