import {
  clearNotificationSkip,
  clearNotificationSkipsForContainer,
  clearNotificationSkipsForTrigger,
  getNotificationSkipsForContainer,
  getNotificationSkipsForTrigger,
  getNotificationSkipsSnapshot,
  markNotificationTriggerRegistered,
  NOTIFICATION_SKIP_MAX_DETAIL_LENGTH,
  NOTIFICATION_SKIP_MAX_ENTRIES,
  recordNotificationSkip,
  resetNotificationSkips,
} from './notification-skips.js';

describe('notification skip store', () => {
  beforeEach(() => {
    resetNotificationSkips();
  });

  test('keeps only the last skip per trigger and container', () => {
    recordNotificationSkip('smtp.a', 'c1', 'threshold-not-met', 'threshold=major');
    recordNotificationSkip('smtp.a', 'c1', 'once-already-sent');

    const snapshot = getNotificationSkipsSnapshot();
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]).toMatchObject({
      trigger: 'smtp.a',
      containerId: 'c1',
      reason: 'once-already-sent',
    });
    expect(snapshot[0].detail).toBeUndefined();
    expect(Date.parse(snapshot[0].at)).not.toBeNaN();
  });

  test('truncates detail', () => {
    recordNotificationSkip('smtp.a', 'c1', 'trigger-excluded', 'x'.repeat(500));
    expect(getNotificationSkipsSnapshot()[0].detail).toHaveLength(
      NOTIFICATION_SKIP_MAX_DETAIL_LENGTH,
    );
  });

  test('clear removes the pair and tolerates a missing one', () => {
    recordNotificationSkip('smtp.a', 'c1', 'rule-disabled');
    clearNotificationSkip('smtp.a', 'c1');
    clearNotificationSkip('smtp.a', 'c1');
    expect(getNotificationSkipsSnapshot()).toEqual([]);
  });

  test('lists skips for one container without detail', () => {
    recordNotificationSkip('smtp.a', 'c1', 'rule-disabled', 'secret-ish');
    recordNotificationSkip('slack.b', 'c1', 'digest-buffered');
    recordNotificationSkip('smtp.a', 'c2', 'recently-applied');

    const forC1 = getNotificationSkipsForContainer('c1');
    expect(forC1.map((s) => s.trigger)).toEqual(['smtp.a', 'slack.b']);
    expect(forC1[0]).toEqual({
      trigger: 'smtp.a',
      reason: 'rule-disabled',
      at: expect.any(String),
    });
    expect(getNotificationSkipsForContainer('missing')).toEqual([]);
  });

  test("lists one trigger's skips newest first", () => {
    recordNotificationSkip('smtp.a', 'c1', 'rule-disabled');
    recordNotificationSkip('slack.b', 'c1', 'digest-buffered');
    recordNotificationSkip('smtp.a', 'c2', 'recently-applied');
    // Re-recording c1 moves it to the newest position.
    recordNotificationSkip('smtp.a', 'c1', 'once-already-sent');

    expect(getNotificationSkipsForTrigger('smtp.a').map((s) => [s.containerId, s.reason])).toEqual([
      ['c1', 'once-already-sent'],
      ['c2', 'recently-applied'],
    ]);
    expect(getNotificationSkipsForTrigger('missing')).toEqual([]);
  });

  test('enforces the cap by dropping the oldest entry', () => {
    for (let i = 0; i < NOTIFICATION_SKIP_MAX_ENTRIES; i += 1) {
      recordNotificationSkip('t', `c${i}`, 'threshold-not-met');
    }
    // Refreshing c0 makes c1 the oldest.
    recordNotificationSkip('t', 'c0', 'rule-disabled');
    recordNotificationSkip('t', 'overflow', 'threshold-not-met');

    const snapshot = getNotificationSkipsSnapshot();
    expect(snapshot).toHaveLength(NOTIFICATION_SKIP_MAX_ENTRIES);
    expect(snapshot.some((s) => s.containerId === 'c1')).toBe(false);
    expect(snapshot.some((s) => s.containerId === 'c0')).toBe(true);
    expect(snapshot.at(-1)?.containerId).toBe('overflow');
  });

  test('clearing a container drops its entries for every trigger', () => {
    recordNotificationSkip('smtp.a', 'c1', 'rule-disabled');
    recordNotificationSkip('slack.b', 'c1', 'rule-disabled');
    recordNotificationSkip('smtp.a', 'c2', 'rule-disabled');

    clearNotificationSkipsForContainer('c1');

    expect(getNotificationSkipsSnapshot().map((skip) => skip.containerId)).toEqual(['c2']);
  });

  test('clearing a trigger drops its entries and refuses new ones until it registers again', () => {
    recordNotificationSkip('smtp.a', 'c1', 'rule-disabled');
    recordNotificationSkip('slack.b', 'c1', 'rule-disabled');

    clearNotificationSkipsForTrigger('smtp.a');
    recordNotificationSkip('smtp.a', 'c2', 'rule-disabled');
    expect(getNotificationSkipsForContainer('c1').map((skip) => skip.trigger)).toEqual(['slack.b']);
    expect(getNotificationSkipsForContainer('c2')).toEqual([]);

    markNotificationTriggerRegistered('smtp.a');
    recordNotificationSkip('smtp.a', 'c2', 'rule-disabled');
    expect(getNotificationSkipsForContainer('c2')).toHaveLength(1);
  });

  test('reset also forgets removed triggers', () => {
    clearNotificationSkipsForTrigger('smtp.a');
    resetNotificationSkips();
    recordNotificationSkip('smtp.a', 'c1', 'rule-disabled');
    expect(getNotificationSkipsSnapshot()).toHaveLength(1);
  });
});
