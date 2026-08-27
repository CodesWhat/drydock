import { describe, expect, test } from 'vitest';
import { getErrorMessage } from '../../util/error.js';
import * as sharedModule from './shared.js';
import {
  getErrorStatusCode,
  isSensitiveKey,
  redactContainerRuntimeEnv,
  redactContainersRuntimeEnv,
  resolveContainerImageFullName,
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

    test('detects bare PASS segment (SMTP and DB credential keys)', () => {
      // 'PASS' is added with segment-exact matching to close the same credential-leak
      // class that debug/redact.ts already closes with its 'pass' token.
      expect(isSensitiveKey('SMTP_PASS')).toBe(true);
      expect(isSensitiveKey('DB_PASS')).toBe(true);
      expect(isSensitiveKey('REDIS_PASS')).toBe(true);
    });

    test('does not falsely redact keys that contain PASS as an internal substring', () => {
      // 'COMPASS' and 'BYPASS' contain the letter sequence P-A-S-S but are not
      // credential keys. Segment matching (split on '_') prevents these false positives
      // that plain .includes('PASS') would produce.
      expect(isSensitiveKey('COMPASS')).toBe(false);
      expect(isSensitiveKey('BYPASS')).toBe(false);
      expect(isSensitiveKey('COMPASS_DIRECTION')).toBe(false);
      expect(isSensitiveKey('BYPASS_RATE')).toBe(false);
    });

    test('detects PAT only as an exact key segment', () => {
      expect(isSensitiveKey('GITHUB_PAT')).toBe(true);
      expect(isSensitiveKey('PAT')).toBe(true);
      expect(isSensitiveKey('PATTERN')).toBe(false);
      expect(isSensitiveKey('DISPATCH')).toBe(false);
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

    test('redacts credential-bearing URLs regardless of key while preserving public URLs', () => {
      const credentialUrl = 'postgres://service-user:db-secret@database.internal/app';
      const usernameOnlyUrl = 'https://service-user@example.com/private';
      const publicUrl = 'https://example.com/public';
      const container = {
        id: 'c-url',
        details: {
          env: [
            { key: 'DATABASE_URL', value: credentialUrl },
            { key: 'SERVICE_URL', value: usernameOnlyUrl },
            { key: 'PUBLIC_URL', value: publicUrl },
            { key: 'OPTIONAL_URL', value: undefined },
          ],
        },
      };

      const redacted = redactContainerRuntimeEnv(container);
      const serialized = JSON.stringify(redacted);

      expect(redacted).toEqual({
        id: 'c-url',
        details: {
          env: [
            { key: 'DATABASE_URL', value: '[REDACTED]', sensitive: true },
            { key: 'SERVICE_URL', value: '[REDACTED]', sensitive: true },
            { key: 'PUBLIC_URL', value: publicUrl, sensitive: false },
            { key: 'OPTIONAL_URL', value: undefined, sensitive: false },
          ],
        },
      });
      expect(serialized).not.toContain(credentialUrl);
      expect(serialized).not.toContain(usernameOnlyUrl);
      expect(serialized).toContain(publicUrl);
    });

    test('redacts a scheme-relative URL carrying credentials under a non-sensitive key', () => {
      // A bare `new URL()` with no base throws on a scheme-relative value like
      // "//user:pass@host", so without a base the credentials would slip through
      // under a key such as SERVICE_URL that doesn't match isSensitiveKey either.
      const schemeRelativeUrl = '//user:password@example.com/private';
      const container = {
        id: 'c-scheme-relative',
        details: {
          env: [{ key: 'SERVICE_URL', value: schemeRelativeUrl }],
        },
      };

      expect(redactContainerRuntimeEnv(container)).toEqual({
        id: 'c-scheme-relative',
        details: {
          env: [{ key: 'SERVICE_URL', value: '[REDACTED]', sensitive: true }],
        },
      });
    });

    test('treats a value that fails to parse even against the dummy base as non-sensitive', () => {
      // An invalid bracketed IPv6 authority still throws from new URL() even with
      // a base supplied, so this keeps the hasUrlCredentials catch branch covered
      // now that ordinary non-URL strings (e.g. plain paths) no longer throw.
      const container = {
        id: 'c-malformed-url',
        details: {
          env: [{ key: 'ENDPOINT_URL', value: 'http://[::1' }],
        },
      };

      expect(redactContainerRuntimeEnv(container)).toEqual({
        id: 'c-malformed-url',
        details: {
          env: [{ key: 'ENDPOINT_URL', value: 'http://[::1', sensitive: false }],
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

    test('removes PAT and URL credentials from ordinary list payloads', () => {
      const pat = 'github-pat-value';
      const credentialUrl = 'https://user:password@example.com/private';
      const publicUrl = 'https://example.com/public';
      const containers = [
        {
          id: 'c-list',
          details: {
            env: [
              { key: 'GITHUB_PAT', value: pat },
              { key: 'PATTERN', value: 'weekly' },
              { key: 'SERVICE_URL', value: credentialUrl },
              { key: 'PUBLIC_URL', value: publicUrl },
            ],
          },
        },
      ];

      const redacted = redactContainersRuntimeEnv(containers);
      const serialized = JSON.stringify(redacted);

      expect(serialized).not.toContain(pat);
      expect(serialized).not.toContain(credentialUrl);
      expect(serialized).toContain('weekly');
      expect(serialized).toContain(publicUrl);
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

  describe('resolveContainerImageFullName', () => {
    function makeContainer(
      registryName: string,
      registryUrl: string,
      imageName: string,
      tagValue: string,
    ) {
      return {
        image: {
          registry: { name: registryName, url: registryUrl },
          name: imageName,
          tag: { value: tagValue },
        },
      } as never;
    }

    test('normalizes a Docker Hub v2 API base URL in the fallback branch (issue #374 regression guard)', () => {
      const container = makeContainer(
        'hub',
        'https://registry-1.docker.io/v2',
        'dgtlmoon/sockpuppetbrowser',
        '0.0.3',
      );
      const result = resolveContainerImageFullName(container, {});
      expect(result).toBe('registry-1.docker.io/dgtlmoon/sockpuppetbrowser:0.0.3');
      expect(result.startsWith('https://')).toBe(false);
      expect(result).not.toContain('/v2/');
    });

    test('normalizes a ghcr.io v2 API base URL in the fallback branch', () => {
      const container = makeContainer(
        'ghcr',
        'https://ghcr.io/v2',
        'codeswhat/drydock',
        '1.5.0-rc.22',
      );
      const result = resolveContainerImageFullName(container, {});
      expect(result).toBe('ghcr.io/codeswhat/drydock:1.5.0-rc.22');
    });

    test('leaves a plain registry host unchanged in the fallback branch', () => {
      const container = makeContainer('hub', 'fallback-registry', 'test/app', '1.2.3');
      const result = resolveContainerImageFullName(container, {});
      expect(result).toBe('fallback-registry/test/app:1.2.3');
    });

    test('uses an @ separator when the tag override is a digest', () => {
      const container = makeContainer('ghcr', 'https://ghcr.io/v2', 'codeswhat/drydock', '1.0.0');
      const result = resolveContainerImageFullName(container, {}, 'sha256:abc123');
      expect(result).toBe('ghcr.io/codeswhat/drydock@sha256:abc123');
    });

    test("delegates to the registry component's getImageFullName when available", () => {
      const container = makeContainer(
        'hub',
        'https://registry-1.docker.io/v2',
        'library/nginx',
        '1.25',
      );
      const registryState = {
        hub: {
          getImageFullName: (image: { name: string }, tag: string) =>
            `resolved:${image.name}:${tag}`,
        },
      };
      const result = resolveContainerImageFullName(container, registryState as never);
      expect(result).toBe('resolved:library/nginx:1.25');
    });

    test('uses @ separator when tag.value is itself a digest and no tagOverride is given', () => {
      // Exercises the tag.includes(':') ternary via the tagOverride || tag.value path
      // when the stored tag value IS a digest.
      const container = makeContainer(
        'ghcr',
        'https://ghcr.io/v2',
        'codeswhat/drydock',
        'sha256:deadbeef',
      );
      const result = resolveContainerImageFullName(container, {});
      expect(result).toBe('ghcr.io/codeswhat/drydock@sha256:deadbeef');
    });

    test('preserves /v2 in the image name — does not strip it from concatenated string', () => {
      // Regression guard for the unanchored .replace(/\/v2/, '') bug: if applied
      // to the full concatenated string the /v2 in the image name would be removed.
      const container = makeContainer('myreg', 'plain-registry.io', 'library/v2/tool', '1.0');
      const result = resolveContainerImageFullName(container, {});
      expect(result).toBe('plain-registry.io/library/v2/tool:1.0');
    });
  });
});
