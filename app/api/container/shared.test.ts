import { describe, expect, test } from 'vitest';
import {
  getErrorMessage,
  getErrorStatusCode,
  isSensitiveKey,
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

    test('classifies env entries with sensitive flag and preserves values', () => {
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
            { key: 'TOKEN', value: 'secret', sensitive: true },
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
          env: [{ key: 'TOKEN', value: 'secret', sensitive: true }],
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
