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
});
