import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { verifyBearerBinding } from './bearer-binding.js';

const ISSUER = 'https://idp.example.com';
const CLIENT_ID = 'dd-client';

let privateKey: CryptoKey;
let getKey: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  getKey = createLocalJWKSet({ keys: [jwk] });
});

async function sign(
  claims: Record<string, unknown>,
  options: { issuer?: string; exp?: string | number } = {},
) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(options.issuer ?? ISSUER)
    .setSubject('user-1')
    .setIssuedAt()
    .setExpirationTime(options.exp ?? '5m')
    .sign(privateKey);
}

const base = { issuer: ISSUER, clientId: CLIENT_ID, audiences: [] as string[] };

describe('verifyBearerBinding with a JWT access token', () => {
  test('accepts a token whose aud contains the client id', async () => {
    const token = await sign({ aud: [CLIENT_ID, 'other'] });
    await expect(verifyBearerBinding(token, { ...base, getKey })).resolves.toEqual({
      subject: 'user-1',
    });
  });

  test('accepts a string aud equal to the client id', async () => {
    const token = await sign({ aud: CLIENT_ID });
    await expect(verifyBearerBinding(token, { ...base, getKey })).resolves.toEqual({
      subject: 'user-1',
    });
  });

  test('accepts a token whose azp is the client id (Keycloak)', async () => {
    const token = await sign({ aud: 'account', azp: CLIENT_ID });
    await expect(verifyBearerBinding(token, { ...base, getKey })).resolves.toEqual({
      subject: 'user-1',
    });
  });

  test('accepts a token whose client_id is the client id', async () => {
    const token = await sign({ client_id: CLIENT_ID });
    await expect(verifyBearerBinding(token, { ...base, getKey })).resolves.toEqual({
      subject: 'user-1',
    });
  });

  test('accepts a configured extra audience', async () => {
    const token = await sign({ aud: 'api://drydock' });
    await expect(
      verifyBearerBinding(token, { ...base, audiences: ['api://drydock'], getKey }),
    ).resolves.toEqual({ subject: 'user-1' });
  });

  test('rejects a token minted for a foreign client of the same IdP', async () => {
    const token = await sign({ aud: 'other-client', azp: 'other-client' });
    await expect(verifyBearerBinding(token, { ...base, getKey })).rejects.toThrow(
      'not issued for this client',
    );
  });

  test('rejects a token without any audience or client claim', async () => {
    const token = await sign({});
    await expect(verifyBearerBinding(token, { ...base, getKey })).rejects.toThrow(
      'not issued for this client',
    );
  });

  test('ignores non-string audience entries', async () => {
    const token = await sign({ aud: [42, null] });
    await expect(verifyBearerBinding(token, { ...base, getKey })).rejects.toThrow(
      'not issued for this client',
    );
  });

  test('rejects a wrong issuer', async () => {
    const token = await sign({ aud: CLIENT_ID }, { issuer: 'https://evil.example.com' });
    await expect(verifyBearerBinding(token, { ...base, getKey })).rejects.toThrow();
  });

  test('rejects an expired token', async () => {
    const token = await sign({ aud: CLIENT_ID }, { exp: Math.floor(Date.now() / 1000) - 3600 });
    await expect(verifyBearerBinding(token, { ...base, getKey })).rejects.toThrow();
  });

  test('tolerates small clock skew on exp', async () => {
    const token = await sign({ aud: CLIENT_ID }, { exp: Math.floor(Date.now() / 1000) - 5 });
    await expect(verifyBearerBinding(token, { ...base, getKey })).resolves.toBeDefined();
  });

  test('rejects a token signed by an unknown key', async () => {
    const other = await generateKeyPair('RS256');
    const token = await new SignJWT({ aud: CLIENT_ID })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(ISSUER)
      .setExpirationTime('5m')
      .sign(other.privateKey);
    await expect(verifyBearerBinding(token, { ...base, getKey })).rejects.toThrow();
  });

  test('does not fall back to introspection when JWT verification fails', async () => {
    const introspect = vi.fn().mockResolvedValue({ active: true, client_id: CLIENT_ID });
    const token = await sign({ aud: 'other-client' });
    await expect(verifyBearerBinding(token, { ...base, getKey, introspect })).rejects.toThrow();
    expect(introspect).not.toHaveBeenCalled();
  });

  test('returns no subject when the token has none', async () => {
    const token = await new SignJWT({ aud: CLIENT_ID })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(ISSUER)
      .setExpirationTime('5m')
      .sign(privateKey);
    await expect(verifyBearerBinding(token, { ...base, getKey })).resolves.toEqual({
      subject: undefined,
    });
  });

  test('uses introspection for a JWT when the IdP has no jwks_uri', async () => {
    const introspect = vi.fn().mockResolvedValue({ active: true, client_id: CLIENT_ID });
    const token = await sign({ aud: CLIENT_ID });
    await expect(verifyBearerBinding(token, { ...base, introspect })).resolves.toEqual({
      subject: undefined,
    });
  });
});

describe('verifyBearerBinding with an opaque access token', () => {
  const now = 1_800_000_000;
  const context = (introspect: (token: string) => Promise<Record<string, unknown>>) => ({
    ...base,
    getKey,
    introspect,
    nowSeconds: () => now,
  });

  test('accepts an active token issued to this client', async () => {
    const introspect = vi
      .fn()
      .mockResolvedValue({ active: true, client_id: CLIENT_ID, sub: 'svc', exp: now + 60 });
    await expect(verifyBearerBinding('opaque-token', context(introspect))).resolves.toEqual({
      subject: 'svc',
    });
    expect(introspect).toHaveBeenCalledWith('opaque-token');
  });

  test('accepts an active token whose aud names an extra audience', async () => {
    const introspect = vi.fn().mockResolvedValue({ active: true, aud: ['api://drydock'] });
    await expect(
      verifyBearerBinding('opaque-token', {
        ...context(introspect),
        audiences: ['api://drydock'],
      }),
    ).resolves.toEqual({ subject: undefined });
  });

  test('treats a three-segment non-JWT string as opaque', async () => {
    const introspect = vi.fn().mockResolvedValue({ active: true, client_id: CLIENT_ID });
    await expect(verifyBearerBinding('a.b.c', context(introspect))).resolves.toBeDefined();
    expect(introspect).toHaveBeenCalled();
  });

  test('rejects an inactive token', async () => {
    const introspect = vi.fn().mockResolvedValue({ active: false });
    await expect(verifyBearerBinding('opaque-token', context(introspect))).rejects.toThrow(
      'not active',
    );
  });

  test('rejects a token issued to another client', async () => {
    const introspect = vi.fn().mockResolvedValue({ active: true, client_id: 'other-client' });
    await expect(verifyBearerBinding('opaque-token', context(introspect))).rejects.toThrow(
      'not issued for this client',
    );
  });

  test('rejects a mismatched issuer', async () => {
    const introspect = vi
      .fn()
      .mockResolvedValue({ active: true, client_id: CLIENT_ID, iss: 'https://evil.example.com' });
    await expect(verifyBearerBinding('opaque-token', context(introspect))).rejects.toThrow(
      'issuer does not match',
    );
  });

  test('accepts a matching issuer', async () => {
    const introspect = vi
      .fn()
      .mockResolvedValue({ active: true, client_id: CLIENT_ID, iss: ISSUER });
    await expect(verifyBearerBinding('opaque-token', context(introspect))).resolves.toBeDefined();
  });

  test('rejects an expired token', async () => {
    const introspect = vi
      .fn()
      .mockResolvedValue({ active: true, client_id: CLIENT_ID, exp: now - 3600 });
    await expect(verifyBearerBinding('opaque-token', context(introspect))).rejects.toThrow(
      'expired',
    );
  });

  test('rejects a token that is not valid yet', async () => {
    const introspect = vi
      .fn()
      .mockResolvedValue({ active: true, client_id: CLIENT_ID, nbf: now + 3600 });
    await expect(verifyBearerBinding('opaque-token', context(introspect))).rejects.toThrow(
      'not yet valid',
    );
  });

  test('propagates an introspection failure', async () => {
    const introspect = vi.fn().mockRejectedValue(new Error('introspection down'));
    await expect(verifyBearerBinding('opaque-token', context(introspect))).rejects.toThrow(
      'introspection down',
    );
  });

  test('uses the real clock when none is injected', async () => {
    const introspect = vi.fn().mockResolvedValue({
      active: true,
      client_id: CLIENT_ID,
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    await expect(
      verifyBearerBinding('opaque-token', { ...base, introspect }),
    ).resolves.toBeDefined();
  });
});

test('fails closed when the IdP offers neither JWKS nor introspection', async () => {
  await expect(verifyBearerBinding('opaque-token', base)).rejects.toThrow('cannot be verified');
});

test('fails closed for an opaque token when only JWKS is available', async () => {
  await expect(verifyBearerBinding('opaque-token', { ...base, getKey })).rejects.toThrow(
    'cannot be verified',
  );
});
