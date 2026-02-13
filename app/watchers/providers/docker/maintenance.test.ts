import { afterEach, describe, expect, it, vi } from 'vitest';
import { getNextMaintenanceWindow, isInMaintenanceWindow } from './maintenance.js';

describe('isInMaintenanceWindow', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return true when current time matches the cron expression', () => {
    // Fix time to 2024-06-15 14:30:00 UTC (Saturday)
    vi.useFakeTimers({ now: new Date('2024-06-15T14:30:00Z') });
    // minute=30, hour=14, day=15, month=6, weekday=6(sat)
    expect(isInMaintenanceWindow('30 14 * * *', 'UTC')).toBe(true);
  });

  it('should return false when current time does not match the cron expression', () => {
    vi.useFakeTimers({ now: new Date('2024-06-15T14:30:00Z') });
    // Only matches at minute 0, hour 3
    expect(isInMaintenanceWindow('0 3 * * *', 'UTC')).toBe(false);
  });

  it('should match wildcard cron (every minute)', () => {
    vi.useFakeTimers({ now: new Date('2024-06-15T14:30:00Z') });
    expect(isInMaintenanceWindow('* * * * *', 'UTC')).toBe(true);
  });

  it('should match day-of-week correctly', () => {
    // 2024-06-15 is Saturday (day 6)
    vi.useFakeTimers({ now: new Date('2024-06-15T14:30:00Z') });
    // Only Saturdays
    expect(isInMaintenanceWindow('30 14 * * 6', 'UTC')).toBe(true);
    // Only Mondays
    expect(isInMaintenanceWindow('30 14 * * 1', 'UTC')).toBe(false);
  });

  it('should match range expressions', () => {
    // 2024-06-15 14:30 UTC, Saturday
    vi.useFakeTimers({ now: new Date('2024-06-15T14:30:00Z') });
    // hours 10-18
    expect(isInMaintenanceWindow('30 10-18 * * *', 'UTC')).toBe(true);
    // hours 0-5
    expect(isInMaintenanceWindow('30 0-5 * * *', 'UTC')).toBe(false);
  });

  it('should handle timezone parameter', () => {
    // 2024-06-15T14:30:00Z = 2024-06-15T07:30:00 US/Pacific (UTC-7 in June)
    vi.useFakeTimers({ now: new Date('2024-06-15T14:30:00Z') });
    // 7:30 Pacific time
    expect(isInMaintenanceWindow('30 7 * * *', 'US/Pacific')).toBe(true);
    // 14:30 should NOT match in Pacific
    expect(isInMaintenanceWindow('30 14 * * *', 'US/Pacific')).toBe(false);
  });

  it('should default timezone to UTC', () => {
    vi.useFakeTimers({ now: new Date('2024-06-15T14:30:00Z') });
    expect(isInMaintenanceWindow('30 14 * * *')).toBe(true);
  });

  it('should return false for invalid cron expression', () => {
    expect(isInMaintenanceWindow('not-a-cron')).toBe(false);
  });

  it('should return false for empty string', () => {
    expect(isInMaintenanceWindow('')).toBe(false);
  });

  it('should return false for undefined-like values', () => {
    expect(isInMaintenanceWindow(undefined as unknown as string)).toBe(false);
    expect(isInMaintenanceWindow(null as unknown as string)).toBe(false);
  });

  it('should match step expressions', () => {
    // 2024-06-15 14:30 UTC
    vi.useFakeTimers({ now: new Date('2024-06-15T14:30:00Z') });
    // Every 15 minutes (0, 15, 30, 45)
    expect(isInMaintenanceWindow('*/15 * * * *', 'UTC')).toBe(true);
    // Every 7 minutes (0, 7, 14, 21, 28, 35, 42, 49, 56) - 30 not in list
    expect(isInMaintenanceWindow('*/7 * * * *', 'UTC')).toBe(false);
  });

  it('should match month correctly', () => {
    // June 15
    vi.useFakeTimers({ now: new Date('2024-06-15T14:30:00Z') });
    // June only
    expect(isInMaintenanceWindow('30 14 * 6 *', 'UTC')).toBe(true);
    // January only
    expect(isInMaintenanceWindow('30 14 * 1 *', 'UTC')).toBe(false);
  });
});

describe('getNextMaintenanceWindow', () => {
  it('should return the next matching date in UTC by default', () => {
    const fromDate = new Date('2024-06-15T14:30:00Z');
    const next = getNextMaintenanceWindow('0 15 * * *', 'UTC', fromDate);
    expect(next?.toISOString()).toBe('2024-06-15T15:00:00.000Z');
  });

  it('should return undefined for invalid cron expression', () => {
    expect(getNextMaintenanceWindow('not-a-cron')).toBeUndefined();
  });

  it('should return undefined for invalid timezone', () => {
    const next = getNextMaintenanceWindow('0 15 * * *', 'Invalid/Timezone', new Date());
    expect(next).toBeUndefined();
  });
});

describe('coverage callbacks', () => {
  it('should execute cron callback functions passed to createTask', async () => {
    vi.resetModules();
    const createTask = vi.fn((_expr, callback) => {
      callback();
      return {
        timeMatcher: {
          match: () => true,
          getNextMatch: () => new Date('2024-06-16T00:00:00.000Z'),
        },
      };
    });

    vi.doMock('node-cron', () => ({
      default: {
        validate: () => true,
        createTask,
      },
    }));

    const maintenance = await import('./maintenance.js');
    expect(maintenance.isInMaintenanceWindow('* * * * *')).toBe(true);
    expect(
      maintenance.getNextMaintenanceWindow(
        '* * * * *',
        'UTC',
        new Date('2024-06-15T00:00:00.000Z'),
      ),
    ).toEqual(new Date('2024-06-16T00:00:00.000Z'));
  });

  it('should return undefined when getNextMatch does not return a Date instance', async () => {
    vi.resetModules();
    vi.doMock('node-cron', () => ({
      default: {
        validate: () => true,
        createTask: () => ({
          timeMatcher: {
            match: () => true,
            getNextMatch: () => 'not-a-date',
          },
        }),
      },
    }));

    const maintenance = await import('./maintenance.js');
    expect(
      maintenance.getNextMaintenanceWindow(
        '* * * * *',
        'UTC',
        new Date('2024-06-15T00:00:00.000Z'),
      ),
    ).toBeUndefined();
  });
});
