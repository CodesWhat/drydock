import { describe, expect, test } from 'vitest';
import { getErrorMessage } from '../../util/error.js';
import * as sharedModule from './shared.js';
import {
  getErrorStatusCode,
  isSensitiveKey,
  redactContainerRuntimeEnv,
  redactContainersRuntimeEnv,
} from './shared.js';

describe('api/container/shared', () => {
  describe('module exports', () => {
    test('does not re-export getErrorMessage', () => {
      expect('getErrorMessage' in sharedModule).toBe(false);
    });
  });

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

  describe('isSensitiveKey', () => {
    test('detects PASSWORD keys', () => {
      expect(isSensitiveKey('DB_PASSWORD')).toBe(true);
      expect(isSensitiveKey('password')).toBe(true);
    });

    test('detects TOKEN keys', () => {
      expect(isSensitiveKey('API_TOKEN')).toBe(true);
      expect(isSensitiveKey('ACCESS_TOKEN')).toBe(true);
    });

    test('detects SECRET keys', () => {
      expect(isSensitiveKey('APP_SECRET')).toBe(true);
      expect(isSensitiveKey('client_secret')).toBe(true);
    });

    test('detects API_KEY and APIKEY keys', () => {
      expect(isSensitiveKey('MY_API_KEY')).toBe(true);
      expect(isSensitiveKey('APIKEY')).toBe(true);
    });

    test('detects AUTH keys', () => {
      expect(isSensitiveKey('BASIC_AUTH')).toBe(true);
      expect(isSensitiveKey('AUTH_HEADER')).toBe(true);
    });

    test('detects PRIVATE_KEY keys', () => {
      expect(isSensitiveKey('SSL_PRIVATE_KEY')).toBe(true);
    });

    test('detects CREDENTIAL keys', () => {
      expect(isSensitiveKey('GCP_CREDENTIAL')).toBe(true);
    });

    test('detects ACCESS_KEY keys', () => {
      expect(isSensitiveKey('AWS_ACCESS_KEY')).toBe(true);
    });

    test('detects PASSWD keys', () => {
      expect(isSensitiveKey('MYSQL_PASSWD')).toBe(true);
    });

    test('returns false for non-sensitive keys', () => {
      expect(isSensitiveKey('PATH')).toBe(false);
      expect(isSensitiveKey('NODE_ENV')).toBe(false);
      expect(isSensitiveKey('HOME')).toBe(false);
      expect(isSensitiveKey('PORT')).toBe(false);
      expect(isSensitiveKey('HOSTNAME')).toBe(false);
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

    test('redacts sensitive env values and preserves non-sensitive values', () => {
      const container = {
        id: 'c2',
        details: {
          env: [
            { key: 'TOKEN', value: 'secret' },
            { key: 'PATH', value: '/usr/local/bin' },
          ],
        },
      };

      expect(redactContainerRuntimeEnv(container)).toEqual({
        id: 'c2',
        details: {
          env: [
            { key: 'TOKEN', value: '[REDACTED]', sensitive: true },
            { key: 'PATH', value: '/usr/local/bin', sensitive: false },
          ],
        },
      });
    });

    test('drops malformed env entries', () => {
      const container = {
        id: 'c3',
        details: {
          env: [{ key: 'TOKEN', value: 'secret' }, null, { key: 123, value: 'bad' }],
        },
      };

      expect(redactContainerRuntimeEnv(container)).toEqual({
        id: 'c3',
        details: {
          env: [{ key: 'TOKEN', value: '[REDACTED]', sensitive: true }],
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

  describe('redactContainerRuntimeEnv — non-enumerable resultChanged preservation', () => {
    test('preserves a non-enumerable resultChanged function through redaction when details has env', () => {
      const resultChanged = vi.fn().mockReturnValue(false);
      const container = {
        id: 'c-rc-1',
        details: {
          env: [{ key: 'TOKEN', value: 'secret' }],
        },
      };
      Object.defineProperty(container, 'resultChanged', {
        value: resultChanged,
        enumerable: false,
        writable: true,
        configurable: true,
      });

      const redacted = redactContainerRuntimeEnv(container);

      // resultChanged must survive the spread and still be callable
      expect(typeof (redacted as { resultChanged?: unknown }).resultChanged).toBe('function');
      expect(() => (redacted as { resultChanged: () => unknown }).resultChanged()).not.toThrow();

      // The descriptor must remain non-enumerable so spread and structuredClone still skip it
      const descriptor = Object.getOwnPropertyDescriptor(redacted, 'resultChanged');
      expect(descriptor?.enumerable).toBe(false);

      // Sensitive env values must still be redacted
      expect((redacted as typeof container).details.env).toEqual([
        { key: 'TOKEN', value: '[REDACTED]', sensitive: true },
      ]);
    });

    test('does not attach resultChanged when source container lacks it', () => {
      const container = {
        id: 'c-rc-2',
        details: {
          env: [{ key: 'PATH', value: '/usr/bin' }],
        },
      };

      const redacted = redactContainerRuntimeEnv(container);

      expect(Object.getOwnPropertyDescriptor(redacted, 'resultChanged')).toBeUndefined();
    });

    test('preserves resultChanged even when details has no env array', () => {
      const resultChanged = vi.fn();
      const container = { id: 'c-rc-3', details: { ports: ['80:80'] } };
      Object.defineProperty(container, 'resultChanged', {
        value: resultChanged,
        enumerable: false,
        writable: true,
        configurable: true,
      });

      // details is present but has no env array — classifyContainerRuntimeDetails returns it
      // unchanged but classifyContainerRuntimeEnv still spreads into a new object
      const result = redactContainerRuntimeEnv(container);
      expect((result as typeof container).id).toBe('c-rc-3');
      expect(typeof (result as { resultChanged?: unknown }).resultChanged).toBe('function');
      const descriptor = Object.getOwnPropertyDescriptor(result, 'resultChanged');
      expect(descriptor?.enumerable).toBe(false);
    });
  });
});
