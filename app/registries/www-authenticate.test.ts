import { parseBearerChallenge } from './www-authenticate.js';

describe('parseBearerChallenge', () => {
  // --- Happy paths ---

  test('should parse full Bearer challenge (realm, service, scope) like cgr.dev', () => {
    const result = parseBearerChallenge(
      'Bearer realm="https://cgr.dev/token",service="cgr.dev",scope="repository:chainguard/static:pull"',
    );
    expect(result).toEqual({
      realm: 'https://cgr.dev/token',
      service: 'cgr.dev',
      scope: 'repository:chainguard/static:pull',
    });
  });

  test('should parse realm-only Bearer challenge', () => {
    const result = parseBearerChallenge('Bearer realm="https://auth.example.com/token"');
    expect(result).toEqual({ realm: 'https://auth.example.com/token' });
    expect(result?.service).toBeUndefined();
    expect(result?.scope).toBeUndefined();
  });

  test('should parse realm+service without scope', () => {
    const result = parseBearerChallenge(
      'Bearer realm="https://auth.example.com/token",service="registry.example.com"',
    );
    expect(result).toEqual({
      realm: 'https://auth.example.com/token',
      service: 'registry.example.com',
    });
    expect(result?.scope).toBeUndefined();
  });

  test('should parse scope="*" as used by Codeberg', () => {
    const result = parseBearerChallenge(
      'Bearer realm="https://codeberg.org/v2/token",service="codeberg.org",scope="*"',
    );
    expect(result).toEqual({
      realm: 'https://codeberg.org/v2/token',
      service: 'codeberg.org',
      scope: '*',
    });
  });

  test('should parse params in any order (scope first)', () => {
    const result = parseBearerChallenge(
      'Bearer scope="repo:pull",realm="https://auth.example.com/token",service="registry.example.com"',
    );
    expect(result).toEqual({
      realm: 'https://auth.example.com/token',
      service: 'registry.example.com',
      scope: 'repo:pull',
    });
  });

  test('should parse unquoted param values', () => {
    const result = parseBearerChallenge(
      'Bearer realm=https://auth.example.com/token,service=registry.example.com',
    );
    expect(result).toEqual({
      realm: 'https://auth.example.com/token',
      service: 'registry.example.com',
    });
  });

  test('should ignore extra/unknown params and still return known ones', () => {
    const result = parseBearerChallenge(
      'Bearer realm="https://auth.example.com/token",service="registry.example.com",error="invalid_token",charset="utf-8"',
    );
    expect(result).toEqual({
      realm: 'https://auth.example.com/token',
      service: 'registry.example.com',
    });
  });

  test('should handle leading/trailing whitespace in the header', () => {
    const result = parseBearerChallenge('  Bearer realm="https://auth.example.com/token"  ');
    expect(result).toEqual({ realm: 'https://auth.example.com/token' });
  });

  test('should parse Bearer challenge with extra internal whitespace around commas', () => {
    const result = parseBearerChallenge(
      'Bearer realm="https://auth.example.com/token" , service="registry.example.com"',
    );
    expect(result).toEqual({
      realm: 'https://auth.example.com/token',
      service: 'registry.example.com',
    });
  });

  test('should parse Bearer challenge when it follows Basic and preserve quoted commas', () => {
    const result = parseBearerChallenge(
      'Basic realm="registry, login", Bearer realm="https://auth.example.com/token",service="registry.example.com",scope="repository:library/nginx:pull"',
    );

    expect(result).toEqual({
      realm: 'https://auth.example.com/token',
      service: 'registry.example.com',
      scope: 'repository:library/nginx:pull',
    });
  });

  test('should be case-insensitive on the Bearer scheme token', () => {
    const lowerResult = parseBearerChallenge('bearer realm="https://auth.example.com/token"');
    expect(lowerResult).toEqual({ realm: 'https://auth.example.com/token' });

    const upperResult = parseBearerChallenge('BEARER realm="https://auth.example.com/token"');
    expect(upperResult).toEqual({ realm: 'https://auth.example.com/token' });
  });

  // --- Negative paths ---

  test('should return undefined when realm is missing', () => {
    const result = parseBearerChallenge('Bearer service="registry.example.com"');
    expect(result).toBeUndefined();
  });

  test('should return undefined for non-Bearer scheme (Basic)', () => {
    const result = parseBearerChallenge('Basic realm="example.com"');
    expect(result).toBeUndefined();
  });

  test('should return undefined for non-Bearer scheme (Digest)', () => {
    const result = parseBearerChallenge('Digest realm="example.com",nonce="xyz",algorithm=MD5');
    expect(result).toBeUndefined();
  });

  test('should return undefined for undefined input', () => {
    expect(parseBearerChallenge(undefined)).toBeUndefined();
  });

  test('should return undefined for empty string input', () => {
    expect(parseBearerChallenge('')).toBeUndefined();
  });

  test('should return undefined for whitespace-only input', () => {
    expect(parseBearerChallenge('   ')).toBeUndefined();
  });

  test('should return undefined for input with no space (no scheme separator)', () => {
    expect(parseBearerChallenge('BearerNospace')).toBeUndefined();
  });

  test('should return undefined when the Bearer scheme token is present but params are empty', () => {
    expect(parseBearerChallenge('Bearer ')).toBeUndefined();
  });

  test('should return undefined when input is not a string (number)', () => {
    // TypeScript won't allow this normally, but be defensive at runtime
    expect(parseBearerChallenge(42 as unknown as string)).toBeUndefined();
  });

  test('should return undefined when input is null', () => {
    expect(parseBearerChallenge(null as unknown as string)).toBeUndefined();
  });

  // --- Parser loop edge cases (line-64 branch coverage) ---

  test('should return undefined for a bare token with no "=" (i >= paramsPart.length branch)', () => {
    // "realm" has no '=' — the key-read loop consumes all of paramsPart without
    // finding '=', so i >= paramsPart.length is true and the loop breaks without
    // recording any params; realm is missing → undefined.
    expect(parseBearerChallenge('Bearer realm')).toBeUndefined();
  });

  test('should return undefined when key is empty before "=" (!key branch)', () => {
    // "=novalue" has an empty key before '=' — !key is true and the loop breaks.
    expect(parseBearerChallenge('Bearer =novalue')).toBeUndefined();
  });

  test('should still return realm when a later bare token (no "=") ends the loop', () => {
    // "realm=..." is parsed first; then "bogus" has no '=' so the loop breaks,
    // but realm was already captured.
    const result = parseBearerChallenge('Bearer realm="https://x/token",bogus');
    expect(result).toEqual({ realm: 'https://x/token' });
  });

  test('should handle trailing comma after last param (post-separator exhausts params)', () => {
    // After parsing realm, the comma is the only remaining char; the inner
    // whitespace/comma-skip loop exhausts paramsPart → i >= paramsPart.length
    // triggers the break on line 53.
    const result = parseBearerChallenge('Bearer realm="https://auth.example.com/token",');
    expect(result).toEqual({ realm: 'https://auth.example.com/token' });
  });

  test('should tolerate an unclosed quoted value and still capture the param', () => {
    // The closing-quote skip guard (if i < paramsPart.length) is false when
    // there is no closing quote; value is captured up to end-of-string.
    const result = parseBearerChallenge('Bearer realm="https://auth.example.com/token');
    expect(result).toEqual({ realm: 'https://auth.example.com/token' });
  });
});
