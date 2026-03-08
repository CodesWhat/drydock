import { describe, expect, test } from 'vitest';
import { getFirstHeaderValue } from './header-value.js';

describe('getFirstHeaderValue', () => {
  test('returns undefined when header is not present', () => {
    expect(getFirstHeaderValue(undefined)).toBeUndefined();
  });

  test('returns the same value when header is a string', () => {
    expect(getFirstHeaderValue('application/json')).toBe('application/json');
  });

  test('returns the first value when header has multiple entries', () => {
    expect(getFirstHeaderValue(['first', 'second'])).toBe('first');
  });
});
