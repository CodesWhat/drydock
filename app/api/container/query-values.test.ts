import { describe, expect, test } from 'vitest';
import { getFirstNonEmptyQueryValue } from './query-values.js';

describe('api/container/query-values', () => {
  test('returns a trimmed string value as-is', () => {
    expect(getFirstNonEmptyQueryValue('  hot  ')).toBe('hot');
  });

  test('returns undefined for a non-string, non-array value', () => {
    expect(getFirstNonEmptyQueryValue(undefined)).toBeUndefined();
    expect(getFirstNonEmptyQueryValue(42)).toBeUndefined();
  });

  test('returns undefined for an empty or all-whitespace string', () => {
    expect(getFirstNonEmptyQueryValue('')).toBeUndefined();
    expect(getFirstNonEmptyQueryValue('   ')).toBeUndefined();
  });

  test('returns the first string item when the query value is an array (repeated query param)', () => {
    // Express/qs turns a repeated query param (?maturity=hot&maturity=mature)
    // into an array; only the first value should win.
    expect(getFirstNonEmptyQueryValue(['hot', 'mature'])).toBe('hot');
  });

  test('skips leading non-string array items to find the first string', () => {
    expect(getFirstNonEmptyQueryValue([undefined, 42, 'mature'])).toBe('mature');
  });

  test('returns undefined when no array item is a string', () => {
    expect(getFirstNonEmptyQueryValue([undefined, 42, null])).toBeUndefined();
  });

  test('returns undefined for an empty array', () => {
    expect(getFirstNonEmptyQueryValue([])).toBeUndefined();
  });

  test('trims each array item before returning it', () => {
    expect(getFirstNonEmptyQueryValue(['  established  '])).toBe('established');
  });
});
