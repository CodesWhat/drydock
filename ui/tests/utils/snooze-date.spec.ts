import { resolveSnoozeUntilFromInput } from '@/utils/snooze-date';

describe('resolveSnoozeUntilFromInput', () => {
  it.each(['2027-02-29', '2027-04-31', '2028-02-30', '2027-12-32'])(
    'rejects the calendar-invalid date %s',
    (input) => {
      expect(resolveSnoozeUntilFromInput(input)).toBeUndefined();
    },
  );

  it.each(['2028-02-29', '2027-04-30', '2027-12-31'])(
    'preserves local end of day for %s',
    (input) => {
      const result = new Date(resolveSnoozeUntilFromInput(input)!);
      const [year, month, day] = input.split('-').map(Number);
      expect([result.getFullYear(), result.getMonth() + 1, result.getDate()]).toEqual([
        year,
        month,
        day,
      ]);
      expect([result.getHours(), result.getMinutes(), result.getSeconds()]).toEqual([23, 59, 59]);
    },
  );

  it.each(['', 'not-a-date', '2027-1-01', '2027-13-01'])('rejects malformed date %s', (input) => {
    expect(resolveSnoozeUntilFromInput(input)).toBeUndefined();
  });
});
