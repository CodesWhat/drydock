import { describe, expect, test } from 'vitest';
import { toErrorMessage } from './error.js';

describe('toErrorMessage', () => {
  test('returns error.message for Error instances', () => {
    expect(toErrorMessage(new Error('boom'))).toBe('boom');
  });

  test('stringifies non-Error values', () => {
    expect(toErrorMessage('plain')).toBe('plain');
    expect(toErrorMessage(42)).toBe('42');
  });
});
