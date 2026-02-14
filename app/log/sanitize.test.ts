import { describe, expect, test } from 'vitest';
import { sanitizeLogParam } from './sanitize.js';

describe('sanitizeLogParam', () => {
  test('should remove control characters and ANSI escape sequences', () => {
    const value = 'hello\x1b[31m world\x1b[0m\nnext\tline';
    expect(sanitizeLogParam(value)).toBe('hello[31m world[0mnextline');
  });

  test('should truncate values longer than maxLength', () => {
    expect(sanitizeLogParam('abcdef', 3)).toBe('abc...');
  });

  test('should return an empty string for nullish values', () => {
    expect(sanitizeLogParam(null)).toBe('');
  });
});
