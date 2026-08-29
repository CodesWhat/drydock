import { describe, expect, test } from 'vitest';
import { sanitizeLogParam } from './sanitize.js';

describe('sanitizeLogParam', () => {
  test('should remove control characters and ANSI escape sequences', () => {
    const value = 'hello\x1b[31m world\x1b[0m\nnext\tline';
    expect(sanitizeLogParam(value)).toBe('hello worldnextline');
  });

  test('should remove non-color CSI sequences without leaving residue', () => {
    expect(sanitizeLogParam('a\x1b[2Jb\x1b[1;31;42mc\x1b[?25ld')).toBe('abcd');
  });

  test('should truncate values longer than maxLength', () => {
    expect(sanitizeLogParam('abcdef', 3)).toBe('abc...');
  });

  test('should return an empty string for nullish values', () => {
    expect(sanitizeLogParam(null)).toBe('');
  });
});
