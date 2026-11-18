import {
  getMinutesOfDay,
  isValidTimezone,
  isWithinQuietHours,
  parseQuietHoursSchedule,
} from './quiet-hours.js';

describe('parseQuietHoursSchedule', () => {
  test('parses one range and several ranges', () => {
    expect(parseQuietHoursSchedule('22:00-07:00')).toEqual([
      { startMinutes: 1320, endMinutes: 420 },
    ]);
    expect(parseQuietHoursSchedule('9:30-10:00, 12:00-13:00,')).toEqual([
      { startMinutes: 570, endMinutes: 600 },
      { startMinutes: 720, endMinutes: 780 },
    ]);
  });

  test('accepts 24:00 as an end and an empty schedule', () => {
    expect(parseQuietHoursSchedule('18:00-24:00')).toEqual([
      { startMinutes: 1080, endMinutes: 1440 },
    ]);
    expect(parseQuietHoursSchedule('')).toEqual([]);
  });

  test.each([
    'nonsense',
    '25:00-07:00',
    '22:60-07:00',
    '24:00-07:00',
    '22:00-24:30',
    '08:00-08:00',
  ])('rejects %s', (schedule) => {
    expect(() => parseQuietHoursSchedule(schedule)).toThrow(/Invalid quiet hours range/);
  });
});

describe('isValidTimezone', () => {
  test('accepts IANA zones and rejects unknown ones', () => {
    expect(isValidTimezone('Europe/Berlin')).toBe(true);
    expect(isValidTimezone('Mars/Olympus')).toBe(false);
  });
});

describe('isWithinQuietHours', () => {
  const overnight = parseQuietHoursSchedule('22:00-07:00');

  test('is never quiet with no ranges', () => {
    expect(isWithinQuietHours([], 'UTC', new Date('2026-01-01T12:00:00Z'))).toBe(false);
  });

  test('treats the start as inclusive and the end as exclusive across midnight', () => {
    expect(isWithinQuietHours(overnight, 'UTC', new Date('2026-01-01T21:59:00Z'))).toBe(false);
    expect(isWithinQuietHours(overnight, 'UTC', new Date('2026-01-01T22:00:00Z'))).toBe(true);
    expect(isWithinQuietHours(overnight, 'UTC', new Date('2026-01-02T00:00:00Z'))).toBe(true);
    expect(isWithinQuietHours(overnight, 'UTC', new Date('2026-01-02T06:59:00Z'))).toBe(true);
    expect(isWithinQuietHours(overnight, 'UTC', new Date('2026-01-02T07:00:00Z'))).toBe(false);
  });

  test('handles a same-day range', () => {
    const lunch = parseQuietHoursSchedule('12:00-13:00');
    expect(isWithinQuietHours(lunch, 'UTC', new Date('2026-01-01T11:59:00Z'))).toBe(false);
    expect(isWithinQuietHours(lunch, 'UTC', new Date('2026-01-01T12:00:00Z'))).toBe(true);
    expect(isWithinQuietHours(lunch, 'UTC', new Date('2026-01-01T13:00:00Z'))).toBe(false);
  });

  test('evaluates in the configured timezone, including across a daylight saving change', () => {
    // Berlin is +01:00 in winter, so 07:00 local is 06:00 UTC.
    expect(isWithinQuietHours(overnight, 'Europe/Berlin', new Date('2026-01-15T05:59:00Z'))).toBe(
      true,
    );
    expect(isWithinQuietHours(overnight, 'Europe/Berlin', new Date('2026-01-15T06:00:00Z'))).toBe(
      false,
    );
    // In summer Berlin is +02:00, so the same wall-clock boundary is an hour earlier in UTC.
    expect(isWithinQuietHours(overnight, 'Europe/Berlin', new Date('2026-07-15T04:59:00Z'))).toBe(
      true,
    );
    expect(isWithinQuietHours(overnight, 'Europe/Berlin', new Date('2026-07-15T05:00:00Z'))).toBe(
      false,
    );
    expect(
      isWithinQuietHours(overnight, 'America/New_York', new Date('2026-01-15T02:59:00Z')),
    ).toBe(false);
    expect(
      isWithinQuietHours(overnight, 'America/New_York', new Date('2026-01-15T03:00:00Z')),
    ).toBe(true);
  });

  test('reads midnight as minute zero', () => {
    expect(getMinutesOfDay(new Date('2026-01-01T00:00:00Z'), 'UTC')).toBe(0);
  });
});
