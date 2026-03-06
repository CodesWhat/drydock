import { describe, expect, test } from 'vitest';
import { toPositiveInteger } from './parse.js';

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
