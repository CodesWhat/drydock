import { describe, expect, test } from 'vitest';
import { parseEnvNonNegativeInteger, parseLogQueryInteger, toPositiveInteger } from './parse.js';

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

describe('parseLogQueryInteger', () => {
  test.each([undefined, null])('preserves an absent query value: %s', (value) => {
    expect(parseLogQueryInteger(value)).toBeUndefined();
  });

  test.each([
    ['0', 0],
    ['-0', -0],
    ['42', 42],
    ['-5', -5],
    ['0012', 12],
    ['-0012', -12],
    ['9007199254740991', Number.MAX_SAFE_INTEGER],
    ['-9007199254740991', Number.MIN_SAFE_INTEGER],
  ])('parses the complete safe integer %j', (value, expected) => {
    expect(parseLogQueryInteger(value)).toBe(expected);
  });

  test.each(
    [
      '',
      ' ',
      ' 5',
      '5 ',
      '+5',
      '5.0',
      '1e3',
      '0x10',
      '25logs',
      '1000ms',
      '-',
      '5\n',
      '5\r',
      '5\r\n',
      '5\u2028',
      '5\u2029',
      '5\n6',
      '9007199254740992',
      '-9007199254740992',
      5,
      0,
      false,
      true,
      [],
      ['5'],
      { value: '5' },
    ].map((value) => [value]),
  )('rejects invalid or unsafe query value %j', (value) => {
    expect(parseLogQueryInteger(value)).toBeNull();
  });
});
