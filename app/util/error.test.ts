import { describe, expect, test, vi } from 'vitest';
import * as errorUtils from './error.js';

const { getErrorMessage, getErrorChainMessage } = errorUtils;

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

describe('getErrorChainMessage', () => {
  test('returns the message for a plain Error with no cause', () => {
    expect(getErrorChainMessage(new Error('boom'))).toBe('boom');
  });

  test('joins top-level message and cause message with the separator', () => {
    const cause = Object.assign(new Error('getaddrinfo ENOTFOUND host.tld'), { code: 'ENOTFOUND' });
    const error = Object.assign(new TypeError('fetch failed'), { cause });
    expect(getErrorChainMessage(error)).toBe(
      'fetch failed ← getaddrinfo ENOTFOUND host.tld [ENOTFOUND]',
    );
  });

  test('joins three-level cause chain with two separators', () => {
    const level3 = new Error('root cause');
    const level2 = Object.assign(new Error('middle'), { cause: level3 });
    const level1 = Object.assign(new Error('top'), { cause: level2 });
    expect(getErrorChainMessage(level1)).toBe('top ← middle ← root cause');
  });

  test('does not loop infinitely on a cyclic cause reference', () => {
    const cyclic = new Error('cyclic');
    (cyclic as any).cause = cyclic;
    expect(getErrorChainMessage(cyclic)).toBe('cyclic');
  });

  test('truncates at depth 5', () => {
    const errors = Array.from({ length: 7 }, (_, i) => new Error(`level ${i}`));
    for (let i = 0; i < errors.length - 1; i += 1) {
      (errors[i] as any).cause = errors[i + 1];
    }
    const result = getErrorChainMessage(errors[0]);
    const parts = result.split(' ← ');
    expect(parts.length).toBeLessThanOrEqual(5);
  });

  test('returns the default fallback for undefined input', () => {
    expect(getErrorChainMessage(undefined)).toBe('unknown error');
  });

  test('returns a custom fallback when provided and input yields no message', () => {
    expect(getErrorChainMessage(undefined, 'connection failed')).toBe('connection failed');
  });

  test('appends [code] only when the node has a non-empty string code property', () => {
    const withCode = Object.assign(new Error('dns error'), { code: 'ENOTFOUND' });
    const withoutCode = new Error('plain error');
    expect(getErrorChainMessage(withCode)).toBe('dns error [ENOTFOUND]');
    expect(getErrorChainMessage(withoutCode)).toBe('plain error');
  });
});
