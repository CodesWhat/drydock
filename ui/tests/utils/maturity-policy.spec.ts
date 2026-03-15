import {
  DEFAULT_MATURITY_MIN_AGE_DAYS,
  daysToMs,
  MS_PER_DAY,
  maturityMinAgeDaysToMilliseconds,
  normalizeMaturityMode,
  parseMaturityMinAgeDays,
  resolveMaturityMinAgeDays,
} from '@/utils/maturity-policy';

describe('maturity-policy utils', () => {
  it('normalizes supported maturity modes', () => {
    expect(normalizeMaturityMode('all')).toBe('all');
    expect(normalizeMaturityMode('  MATURE  ')).toBe('mature');
    expect(normalizeMaturityMode('unsupported')).toBeUndefined();
    expect(normalizeMaturityMode(42)).toBeUndefined();
  });

  it('parses valid maturity min-age values', () => {
    expect(parseMaturityMinAgeDays(1)).toBe(1);
    expect(parseMaturityMinAgeDays('365')).toBe(365);
  });

  it('rejects invalid maturity min-age values', () => {
    expect(parseMaturityMinAgeDays(0)).toBeUndefined();
    expect(parseMaturityMinAgeDays(366)).toBeUndefined();
    expect(parseMaturityMinAgeDays(7.5)).toBeUndefined();
    expect(parseMaturityMinAgeDays('not-a-number')).toBeUndefined();
  });

  it('resolves configured maturity min-age when valid', () => {
    expect(resolveMaturityMinAgeDays(10, 20)).toBe(10);
  });

  it('falls back to provided fallback when configured value is invalid', () => {
    expect(resolveMaturityMinAgeDays('invalid', 14)).toBe(14);
  });

  it('falls back to default when provided fallback is invalid', () => {
    expect(resolveMaturityMinAgeDays(undefined, 0)).toBe(DEFAULT_MATURITY_MIN_AGE_DAYS);
  });

  it('converts days to milliseconds consistently', () => {
    expect(daysToMs(2)).toBe(2 * MS_PER_DAY);
    expect(maturityMinAgeDaysToMilliseconds(3)).toBe(3 * MS_PER_DAY);
  });
});
