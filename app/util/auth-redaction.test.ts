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
});
