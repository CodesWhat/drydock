import { describe, expect, test, vi } from 'vitest';
import * as errorUtils from './error.js';

const { getErrorMessage } = errorUtils;

describe('getErrorMessage', () => {
  test('does not expose the removed toErrorMessage helper', () => {
    expect('toErrorMessage' in errorUtils).toBe(false);
  });

  test('returns a non-empty message from Error and plain object payloads', () => {
    expect(getErrorMessage(new Error('boom'))).toBe('boom');
    expect(getErrorMessage({ message: 'request failed' })).toBe('request failed');
  });

  test('returns a non-empty string directly', () => {
    expect(getErrorMessage('network timeout')).toBe('network timeout');
  });

  test('stringifies non-object thrown values', () => {
    expect(getErrorMessage(Symbol('create failed'))).toBe('Symbol(create failed)');
  });

  test('stringifies boolean, number, and bigint primitive inputs', () => {
    expect(getErrorMessage(false)).toBe('false');
    expect(getErrorMessage(503)).toBe('503');
    expect(getErrorMessage(9007199254740993n)).toBe('9007199254740993');
  });

  test('uses the fallback when primitive stringification produces an empty message', () => {
    const stringSpy = vi.spyOn(globalThis, 'String').mockReturnValueOnce('');

    try {
      expect(getErrorMessage(12, 'fallback error')).toBe('fallback error');
    } finally {
      stringSpy.mockRestore();
    }
  });

  test('falls back to unknown error by default for empty or missing messages', () => {
    expect(getErrorMessage(undefined)).toBe('unknown error');
    expect(getErrorMessage({ message: '' })).toBe('unknown error');
    expect(getErrorMessage({ message: '  ' })).toBe('unknown error');
  });

  test('supports custom fallback messages', () => {
    expect(getErrorMessage(undefined, 'Unexpected container processing error')).toBe(
      'Unexpected container processing error',
    );
  });
});
