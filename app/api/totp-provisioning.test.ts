import { base32Encode, buildOtpauthUri } from './totp-provisioning.js';

describe('base32Encode', () => {
  test.each([
    ['', ''],
    ['f', 'MY'],
    ['fo', 'MZXQ'],
    ['foo', 'MZXW6'],
    ['foob', 'MZXW6YQ'],
    ['fooba', 'MZXW6YTB'],
    ['foobar', 'MZXW6YTBOI'],
  ])('encodes the RFC 4648 vector %j without padding', (input, expected) => {
    expect(base32Encode(Buffer.from(input, 'ascii'))).toBe(expected);
  });

  test('encodes a 20-byte seed as 32 characters from the base32 alphabet', () => {
    const encoded = base32Encode(Buffer.alloc(20, 0xff));
    expect(encoded).toBe('7'.repeat(32));
    expect(base32Encode(Buffer.alloc(20, 0))).toBe('A'.repeat(32));
  });
});

describe('buildOtpauthUri', () => {
  const secret = 'MZXW6YTBOI';

  test('carries issuer, algorithm, digits and period, and the secret', () => {
    const uri = new URL(
      buildOtpauthUri({ secret, username: 'scott', host: 'drydock.example.com' }),
    );
    expect(uri.protocol).toBe('otpauth:');
    expect(uri.host).toBe('totp');
    expect(uri.searchParams.get('secret')).toBe(secret);
    expect(uri.searchParams.get('issuer')).toBe('Drydock');
    expect(uri.searchParams.get('algorithm')).toBe('SHA1');
    expect(uri.searchParams.get('digits')).toBe('6');
    expect(uri.searchParams.get('period')).toBe('30');
    expect(decodeURIComponent(uri.pathname)).toBe('/Drydock:scott@drydock.example.com');
  });

  test('percent-encodes a username and host that would otherwise break the URI', () => {
    const uri = buildOtpauthUri({
      secret,
      username: 'a b/c?d#e:f&g%h',
      host: 'host name',
    });
    expect(uri).not.toMatch(/\s/);
    const parsed = new URL(uri);
    expect(parsed.hash).toBe('');
    expect(parsed.searchParams.get('secret')).toBe(secret);
    expect(decodeURIComponent(parsed.pathname)).toBe('/Drydock:a b/c?d#e:f&g%h@host name');
    expect(parsed.pathname.slice(1)).not.toContain('/');
  });
});
