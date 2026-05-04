import { vi } from 'vitest';
import { scrubAuthorizationHeaderValues } from './auth-redaction.js';

describe('scrubAuthorizationHeaderValues', () => {
  test('redacts bearer authorization header values in diagnostic strings', () => {
    const result = scrubAuthorizationHeaderValues(
      'request failed: Authorization: Bearer secret-token, status=401',
    );

    expect(result).toBe('request failed: Authorization: Bearer [REDACTED], status=401');
    expect(result).not.toContain('secret-token');
  });

  test('redacts basic authorization header values in JSON-style diagnostic strings', () => {
    const result = scrubAuthorizationHeaderValues(
      '{"headers":{"authorization":"Basic dXNlcjpwYXNz"}}',
    );

    expect(result).toBe('{"headers":{"authorization":"Basic [REDACTED]"}}');
    expect(result).not.toContain('dXNlcjpwYXNz');
  });

  test('redacts authorization values without preserving unknown schemes', () => {
    const result = scrubAuthorizationHeaderValues('Authorization: ApiKey secret-token');

    expect(result).toBe('Authorization: [REDACTED]');
    expect(result).not.toContain('ApiKey');
    expect(result).not.toContain('secret-token');
  });

  test('redacts authorization values when leading whitespace detection has no match', () => {
    const originalMatch = String.prototype.match;
    const matchSpy = vi.spyOn(String.prototype, 'match').mockImplementation(function (
      this: string,
      pattern: string | RegExp,
    ) {
      if (pattern instanceof RegExp && pattern.source === '^\\s*') {
        return null;
      }
      return originalMatch.call(this, pattern as RegExp);
    });

    try {
      expect(scrubAuthorizationHeaderValues('Authorization: token')).toBe(
        'Authorization: [REDACTED]',
      );
    } finally {
      matchSpy.mockRestore();
    }
  });

  test('redacts registry auth header values in diagnostic strings', () => {
    const result = scrubAuthorizationHeaderValues(
      'registry failed: X-Registry-Auth=super-secret; status=401',
    );

    expect(result).toBe('registry failed: X-Registry-Auth=[REDACTED]; status=401');
    expect(result).not.toContain('super-secret');
  });

  test('redacts token and api key credential fields', () => {
    const result = scrubAuthorizationHeaderValues(
      'registry-token=registry-secret api-key=api-secret apikey=compact-secret token=plain-secret',
    );

    expect(result).toBe(
      'registry-token=[REDACTED] api-key=[REDACTED] apikey=[REDACTED] token=[REDACTED]',
    );
    expect(result).not.toContain('registry-secret');
    expect(result).not.toContain('api-secret');
    expect(result).not.toContain('compact-secret');
    expect(result).not.toContain('plain-secret');
  });

  test('redacts oauth token fields', () => {
    const result = scrubAuthorizationHeaderValues(
      'access_token=access-secret refresh_token=refresh-secret id_token=id-secret',
    );

    expect(result).toBe('access_token=[REDACTED] refresh_token=[REDACTED] id_token=[REDACTED]');
    expect(result).not.toContain('access-secret');
    expect(result).not.toContain('refresh-secret');
    expect(result).not.toContain('id-secret');
  });
});
