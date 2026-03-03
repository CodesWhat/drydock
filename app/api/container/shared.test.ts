import { describe, expect, test } from 'vitest';
import {
  getErrorMessage,
  getErrorStatusCode,
  redactContainerRuntimeEnv,
  redactContainersRuntimeEnv,
} from './shared.js';

describe('api/container/shared', () => {
  describe('getErrorMessage', () => {
    test('returns a non-empty string error directly', () => {
      expect(getErrorMessage('network timeout')).toBe('network timeout');
    });

    test('returns message from plain object errors', () => {
      expect(getErrorMessage({ message: 'request failed' })).toBe('request failed');
    });

    test('falls back to unknown error when value has no usable message', () => {
      expect(getErrorMessage({ message: '   ' })).toBe('unknown error');
    });

    test('falls back to unknown error when object message is an empty string', () => {
      expect(getErrorMessage({ message: '' })).toBe('unknown error');
    });
  });

  describe('getErrorStatusCode', () => {
    test('returns response status when present', () => {
      expect(getErrorStatusCode({ response: { status: 429 } })).toBe(429);
    });

    test('returns undefined when response status is not numeric', () => {
      expect(getErrorStatusCode({ response: { status: '429' } })).toBeUndefined();
    });
  });

  describe('redactContainerRuntimeEnv', () => {
    test('returns primitive container values unchanged', () => {
      expect(redactContainerRuntimeEnv(undefined)).toBeUndefined();
      expect(redactContainerRuntimeEnv('not-an-object')).toBe('not-an-object');
    });

    test('keeps primitive details unchanged', () => {
      const container = {
        id: 'c0',
        details: 'raw-details',
      };

      expect(redactContainerRuntimeEnv(container)).toEqual(container);
    });

    test('keeps details unchanged when env is not an array', () => {
      const container = {
        id: 'c1',
        details: {
          env: 'NOT_AN_ARRAY',
          ports: ['8080:8080'],
        },
      };

      expect(redactContainerRuntimeEnv(container)).toEqual(container);
    });

    test('redacts env entries and drops malformed env entries', () => {
      const container = {
        id: 'c2',
        details: {
          env: [{ key: 'TOKEN', value: 'secret' }, null, { key: 123, value: 'bad' }],
        },
      };

      expect(redactContainerRuntimeEnv(container)).toEqual({
        id: 'c2',
        details: {
          env: [{ key: 'TOKEN', value: '[REDACTED]' }],
        },
      });
    });
  });

  describe('redactContainersRuntimeEnv', () => {
    test('returns non-array input unchanged', () => {
      expect(redactContainersRuntimeEnv(undefined)).toBeUndefined();
      expect(redactContainersRuntimeEnv('not-an-array')).toBe('not-an-array');
    });
  });
});
