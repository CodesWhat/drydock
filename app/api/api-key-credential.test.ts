/**
 * Tests for reading a `ddk_` credential off a request.
 *
 * The parse is shared by the authenticator and the pre-authentication rate
 * limiter, so what counts as "presenting a key" is pinned here once.
 */
import { type ApiKeyCredentialCarrier, extractApiKeyCredential } from './api-key-credential.js';

const KEY_ID = 'a1b2c3d4e5f6';
const SECRET = 'A'.repeat(43);
const CREDENTIAL = `ddk_${KEY_ID}_${SECRET}`;

function request(authorization?: unknown): ApiKeyCredentialCarrier {
  return { headers: authorization === undefined ? {} : { authorization } };
}

describe('credential extraction', () => {
  test('returns the credential for a Bearer ddk_ header', () => {
    expect(extractApiKeyCredential(request('Bearer ddk_abc'))).toBe('ddk_abc');
  });

  test.each([
    ['a lowercase scheme', 'bearer ddk_abc'],
    ['a mixed-case scheme', 'BeArEr ddk_abc'],
    ['an uppercase scheme', 'BEARER ddk_abc'],
  ])('accepts %s, because RFC 7235 makes the scheme case-insensitive', (_label, header) => {
    // Matching case-sensitively would let `bearer ddk_…` fall through to
    // whatever sits behind this authenticator, and on an install with anonymous
    // access confirmed that fall-through grants the request.
    expect(extractApiKeyCredential(request(header))).toBe('ddk_abc');
  });

  test.each([
    ['no Authorization header', undefined],
    ['a Basic credential', 'Basic dXNlcjpwYXNz'],
    ['a non-ddk bearer', 'Bearer eyJhbGciOiJSUzI1NiJ9.payload.sig'],
    ['a bare scheme with no value', 'Bearer'],
    ['an empty header', ''],
    ['a scheme-less value', 'ddk_abc'],
    ['a prefix that only looks close', 'Bearer ddkx_abc'],
  ])('returns undefined for %s, leaving the rest of the chain untouched', (_label, header) => {
    expect(extractApiKeyCredential(request(header))).toBeUndefined();
  });

  test('reads the first value when the header arrives repeated', () => {
    expect(extractApiKeyCredential(request(['Bearer ddk_first', 'Bearer ddk_second']))).toBe(
      'ddk_first',
    );
  });

  test('returns undefined when the header is not a string', () => {
    expect(
      extractApiKeyCredential({ headers: { authorization: 7 } } as ApiKeyCredentialCarrier),
    ).toBeUndefined();
  });

  test('returns a full credential whole, underscores in the secret included', () => {
    // base64url includes `_`, so anything that split on the separator would
    // hand the limiter and the authenticator a truncated secret.
    const withUnderscores = `ddk_${KEY_ID}_${'_'.repeat(43)}`;

    expect(extractApiKeyCredential(request(`Bearer ${CREDENTIAL}`))).toBe(CREDENTIAL);
    expect(extractApiKeyCredential(request(`Bearer ${withUnderscores}`))).toBe(withUnderscores);
  });

  test('returns undefined when the request carries no headers at all', () => {
    expect(extractApiKeyCredential({} as ApiKeyCredentialCarrier)).toBeUndefined();
  });
});
