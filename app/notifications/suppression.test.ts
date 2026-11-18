import { ddEnvVars } from '../configuration/index.js';
import * as silenceStore from '../store/notification-silence.js';
import {
  getNotificationSuppression,
  getQuietHoursPolicy,
  getSuppressedCounts,
  recordSuppressed,
  resetSuppressionForTests,
} from './suppression.js';

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock('../log/index.js', () => ({
  default: { child: () => ({ info: vi.fn(), warn, debug: vi.fn(), error: vi.fn() }) },
}));

const KEYS = [
  'DD_ALERTS_QUIETHOURS_SCHEDULE',
  'DD_ALERTS_QUIETHOURS_TZ',
  'DD_ALERTS_QUIETHOURS_RULES',
  'DD_ALERTS_QUIETHOURS_EXEMPT',
  'DD_ALERTS_NOPE',
];
const NIGHT = new Date('2026-03-01T23:30:00Z');
const DAY = new Date('2026-03-01T12:00:00Z');

beforeEach(() => {
  for (const key of KEYS) delete ddEnvVars[key];
  silenceStore.resetSilencesForTests();
  resetSuppressionForTests();
  warn.mockClear();
});

afterEach(() => {
  for (const key of KEYS) delete ddEnvVars[key];
  silenceStore.resetSilencesForTests();
});

describe('quiet hours', () => {
  test('nothing is suppressed when no schedule is configured', () => {
    expect(getQuietHoursPolicy()).toBeUndefined();
    expect(getNotificationSuppression('container-stopped', NIGHT)).toEqual({ suppressed: false });
  });

  test('suppresses inside the window and not outside it', () => {
    ddEnvVars.DD_ALERTS_QUIETHOURS_SCHEDULE = '22:00-07:00';
    expect(getNotificationSuppression('container-stopped', NIGHT)).toEqual({
      suppressed: true,
      reason: 'quiet-hours',
    });
    expect(getNotificationSuppression('container-stopped', DAY)).toEqual({ suppressed: false });
  });

  test('exempts security-alert and update-failed by default', () => {
    ddEnvVars.DD_ALERTS_QUIETHOURS_SCHEDULE = '22:00-07:00';
    expect(getNotificationSuppression('security-alert', NIGHT).suppressed).toBe(false);
    expect(getNotificationSuppression('update-failed', NIGHT).suppressed).toBe(false);
    expect(getNotificationSuppression('update-available', NIGHT).suppressed).toBe(true);
  });

  test('the exempt list is configurable, including emptying it', () => {
    ddEnvVars.DD_ALERTS_QUIETHOURS_SCHEDULE = '22:00-07:00';
    ddEnvVars.DD_ALERTS_QUIETHOURS_EXEMPT = ' Agent-Disconnect ,';
    expect(getNotificationSuppression('agent-disconnect', NIGHT).suppressed).toBe(false);
    expect(getNotificationSuppression('security-alert', NIGHT).suppressed).toBe(true);

    ddEnvVars.DD_ALERTS_QUIETHOURS_EXEMPT = '';
    expect(getNotificationSuppression('security-alert', NIGHT).suppressed).toBe(true);
  });

  test('a rules list limits quiet hours to those rules', () => {
    ddEnvVars.DD_ALERTS_QUIETHOURS_SCHEDULE = '22:00-07:00';
    ddEnvVars.DD_ALERTS_QUIETHOURS_RULES = 'container-stopped, container-exited';
    expect(getNotificationSuppression('container-stopped', NIGHT).suppressed).toBe(true);
    expect(getNotificationSuppression('update-available', NIGHT).suppressed).toBe(false);
  });

  test('evaluates the window in the configured timezone', () => {
    ddEnvVars.DD_ALERTS_QUIETHOURS_SCHEDULE = '22:00-07:00';
    ddEnvVars.DD_ALERTS_QUIETHOURS_TZ = 'Asia/Tokyo';
    // 12:00 UTC is 21:00 in Tokyo, 23:30 UTC is 08:30 there.
    expect(getNotificationSuppression('container-stopped', DAY).suppressed).toBe(false);
    expect(getNotificationSuppression('container-stopped', NIGHT).suppressed).toBe(false);
    expect(
      getNotificationSuppression('container-stopped', new Date('2026-03-01T13:00:00Z')).suppressed,
    ).toBe(true);
  });

  test('an invalid schedule, timezone or setting is ignored with one warning', () => {
    ddEnvVars.DD_ALERTS_QUIETHOURS_SCHEDULE = 'late';
    expect(getNotificationSuppression('container-stopped', NIGHT).suppressed).toBe(false);
    getNotificationSuppression('container-stopped', NIGHT);
    expect(warn).toHaveBeenCalledTimes(1);

    ddEnvVars.DD_ALERTS_QUIETHOURS_SCHEDULE = '22:00-07:00';
    ddEnvVars.DD_ALERTS_QUIETHOURS_TZ = 'Mars/Olympus';
    expect(getQuietHoursPolicy()).toBeUndefined();
    expect(warn).toHaveBeenLastCalledWith(expect.stringContaining('Mars/Olympus'));

    delete ddEnvVars.DD_ALERTS_QUIETHOURS_TZ;
    ddEnvVars.DD_ALERTS_NOPE = 'x';
    expect(getNotificationSuppression('security-alert', NIGHT).suppressed).toBe(false);
    expect(warn).toHaveBeenLastCalledWith(expect.stringContaining('invalid'));
    expect(getQuietHoursPolicy()).toBeUndefined();
  });
});

describe('silences', () => {
  const expiresAt = new Date('2026-03-02T00:00:00Z');

  test('a rule silence mutes that rule only until it expires', () => {
    silenceStore.addSilence({ ruleId: 'container-stopped', expiresAt }, DAY.getTime());
    const decision = getNotificationSuppression('container-stopped', DAY);
    expect(decision).toMatchObject({ suppressed: true, reason: 'silenced' });
    expect(decision.silenceId).toEqual(expect.any(String));
    expect(getNotificationSuppression('container-exited', DAY).suppressed).toBe(false);
    expect(getNotificationSuppression('container-stopped', expiresAt).suppressed).toBe(false);
  });

  test('a global silence mutes everything except exempt rules', () => {
    silenceStore.addSilence({ expiresAt }, DAY.getTime());
    expect(getNotificationSuppression('update-available', DAY).reason).toBe('silenced');
    expect(getNotificationSuppression('security-alert', DAY).suppressed).toBe(false);
    expect(getNotificationSuppression('update-failed', DAY).suppressed).toBe(false);
  });

  test('a rule silence on an exempt rule is honored because it is explicit', () => {
    silenceStore.addSilence({ ruleId: 'security-alert', expiresAt }, DAY.getTime());
    expect(getNotificationSuppression('security-alert', DAY).reason).toBe('silenced');
  });

  test('a silence wins over quiet hours as the reported reason', () => {
    ddEnvVars.DD_ALERTS_QUIETHOURS_SCHEDULE = '22:00-07:00';
    silenceStore.addSilence({ ruleId: 'container-stopped', expiresAt }, NIGHT.getTime());
    expect(getNotificationSuppression('container-stopped', NIGHT).reason).toBe('silenced');
  });

  test('global silences use the configured exempt list', () => {
    ddEnvVars.DD_ALERTS_QUIETHOURS_EXEMPT = 'container-stopped';
    silenceStore.addSilence({ expiresAt }, DAY.getTime());
    expect(getNotificationSuppression('container-stopped', DAY).suppressed).toBe(false);
    expect(getNotificationSuppression('security-alert', DAY).suppressed).toBe(true);
  });
});

describe('suppressed counts', () => {
  test('counts per rule and reason, sorted', () => {
    recordSuppressed('container-stopped', 'quiet-hours');
    recordSuppressed('container-stopped', 'quiet-hours');
    recordSuppressed('container-stopped', 'silenced');
    recordSuppressed('agent-disconnect', 'silenced');
    expect(getSuppressedCounts()).toEqual([
      { ruleId: 'agent-disconnect', reason: 'silenced', count: 1 },
      { ruleId: 'container-stopped', reason: 'quiet-hours', count: 2 },
      { ruleId: 'container-stopped', reason: 'silenced', count: 1 },
    ]);
    resetSuppressionForTests();
    expect(getSuppressedCounts()).toEqual([]);
  });
});
