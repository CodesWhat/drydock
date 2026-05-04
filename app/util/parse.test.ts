import { describe, expect, test } from 'vitest';
import { parseEnvNonNegativeInteger, toPositiveInteger } from './parse.js';

describe('toPositiveInteger', () => {
  test('returns parsed positive integer values', () => {
    expect(toPositiveInteger('42', 500)).toBe(42);
    expect(toPositiveInteger('0012', 500)).toBe(12);
  });

  test('returns fallback for non-positive or non-numeric values', () => {
    expect(toPositiveInteger(undefined, 500)).toBe(500);
    expect(toPositiveInteger('', 500)).toBe(500);
    expect(toPositiveInteger('0', 500)).toBe(500);
    expect(toPositiveInteger('-3', 500)).toBe(500);
    expect(toPositiveInteger('not-a-number', 500)).toBe(500);
    expect(toPositiveInteger('10ms', 500)).toBe(500);
  });
});

describe('parseEnvNonNegativeInteger', () => {
  test('parses shared env integer shape and preserves caller-owned zero semantics', () => {
    expect(parseEnvNonNegativeInteger(undefined, 'DD_TEST')).toBeUndefined();
    expect(parseEnvNonNegativeInteger('   ', 'DD_TEST')).toBeUndefined();
    expect(parseEnvNonNegativeInteger('00', 'DD_TEST')).toBe(0);
    expect(parseEnvNonNegativeInteger(' 42 ', 'DD_TEST')).toBe(42);
    expect(() => parseEnvNonNegativeInteger('-1', 'DD_TEST')).toThrow(
      'DD_TEST must be a non-negative integer (got "-1")',
    );
  });
});
