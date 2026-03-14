import { describe, expect, test } from 'vitest';
import {
  DEFAULT_MATURITY_MIN_AGE_DAYS,
  daysToMs,
  MATURITY_MIN_AGE_DAYS_MAX,
  MATURITY_MIN_AGE_DAYS_MIN,
  MS_PER_DAY,
  normalizeMaturityMode,
  parseMaturityMinAgeDays,
  resolveMaturityMinAgeDays,
} from './maturity-policy.js';

describe('model/maturity-policy', () => {
  test('exports canonical maturity bounds and defaults', () => {
    expect(DEFAULT_MATURITY_MIN_AGE_DAYS).toBe(7);
    expect(MATURITY_MIN_AGE_DAYS_MIN).toBe(1);
    expect(MATURITY_MIN_AGE_DAYS_MAX).toBe(365);
  });

  test('exports day-millisecond helpers', () => {
    expect(MS_PER_DAY).toBe(86_400_000);
    expect(daysToMs(1)).toBe(86_400_000);
    expect(daysToMs(7)).toBe(604_800_000);
  });

  test.each([
    [1, 1],
    [7, 7],
    [365, 365],
    ['21', 21],
    [0, undefined],
    [366, undefined],
    [3.5, undefined],
    [Number.NaN, undefined],
    [Number.POSITIVE_INFINITY, undefined],
    [undefined, undefined],
  ])('parses maturity min age days (%s)', (value, expected) => {
    expect(parseMaturityMinAgeDays(value)).toBe(expected);
  });

  test('resolves invalid values to a valid fallback default', () => {
    expect(resolveMaturityMinAgeDays(undefined)).toBe(DEFAULT_MATURITY_MIN_AGE_DAYS);
    expect(resolveMaturityMinAgeDays(366)).toBe(DEFAULT_MATURITY_MIN_AGE_DAYS);
    expect(resolveMaturityMinAgeDays(0, 21)).toBe(21);
    expect(resolveMaturityMinAgeDays(0, 999)).toBe(DEFAULT_MATURITY_MIN_AGE_DAYS);
  });

  test.each([
    ['all', 'all'],
    ['mature', 'mature'],
    ['  ALL ', 'all'],
    [' Mature ', 'mature'],
    ['fresh', undefined],
    [undefined, undefined],
  ])('normalizes maturity modes (%s)', (value, expected) => {
    expect(normalizeMaturityMode(value)).toBe(expected);
  });
});
