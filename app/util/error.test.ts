import { describe, expect, test } from 'vitest';
import { getErrorMessage, toErrorMessage } from './error.js';

describe('toErrorMessage', () => {
  test('returns error.message for Error instances', () => {
    expect(toErrorMessage(new Error('boom'))).toBe('boom');
  });

  test('stringifies non-Error values', () => {
    expect(toErrorMessage('plain')).toBe('plain');
    expect(toErrorMessage(42)).toBe('42');
  });
});

describe('getErrorMessage', () => {
  test('returns a non-empty message from Error and plain object payloads', () => {
    expect(getErrorMessage(new Error('boom'))).toBe('boom');
    expect(getErrorMessage({ message: 'request failed' })).toBe('request failed');
  });

  test('returns a non-empty string directly', () => {
    expect(getErrorMessage('network timeout')).toBe('network timeout');
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
