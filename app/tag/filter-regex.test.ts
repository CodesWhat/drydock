import { compileFilterRegex } from './filter-regex.js';

describe('compileFilterRegex', () => {
  test('matches with find() semantics', () => {
    const regex = compileFilterRegex('^v\\d+', {});
    expect(regex?.test('v12-beta')).toBe(true);
    expect(regex?.test('latest')).toBe(false);
    expect(compileFilterRegex('beta', {})?.test('v1-beta-2')).toBe(true);
  });

  test('accepts a pattern of exactly 1024 characters', () => {
    const warn = vi.fn();
    expect(compileFilterRegex('a'.repeat(1024), { warn })).not.toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  test('rejects a 1025-character pattern with a warning', () => {
    const warn = vi.fn();
    expect(compileFilterRegex('a'.repeat(1025), { warn })).toBeNull();
    expect(warn).toHaveBeenCalledWith('Regex pattern exceeds maximum length of 1024 characters');
  });

  test('warns and returns null for an invalid pattern', () => {
    const warn = vi.fn();
    expect(compileFilterRegex('[invalid', { warn })).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Invalid regex pattern "[invalid"'));
  });

  test('works without a warn logger', () => {
    expect(compileFilterRegex('a'.repeat(1025), {})).toBeNull();
    expect(compileFilterRegex('[invalid', {})).toBeNull();
  });
});
