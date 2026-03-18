import { ClientSecretPost, Configuration } from 'openid-client';
import log from '../../../log/index.js';
import OidcStrategy from './OidcStrategy.js';

const oidcConfig = new Configuration(
  { issuer: 'https://idp.example.com' },
  'wud-client',
  'wud-secret',
  ClientSecretPost('wud-secret'),
);
const oidcStrategy = new OidcStrategy(
  {
    config: oidcConfig,
    scope: 'openid email profile',
    name: 'oidc',
  },
  () => {},
  log,
);

beforeEach(async () => {
  oidcStrategy.success = vi.fn();
  oidcStrategy.fail = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('authenticate should return user from session if so', async () => {
  oidcStrategy.authenticate({ isAuthenticated: () => true });
  expect(oidcStrategy.success).toHaveBeenCalled();
});

test('authenticate should debug and fail when no authorization header is provided', async () => {
  oidcStrategy.verify = vi.fn((token, cb) => cb(null, { token }));
  const debugSpy = vi.spyOn(oidcStrategy.log, 'debug').mockImplementation(() => {});
  const warnSpy = vi.spyOn(oidcStrategy.log, 'warn').mockImplementation(() => {});

  oidcStrategy.authenticate({ isAuthenticated: () => false, headers: {} });

  expect(oidcStrategy.verify).not.toHaveBeenCalled();
  expect(debugSpy).toHaveBeenCalledWith('No bearer token provided');
  expect(warnSpy).not.toHaveBeenCalled();
  expect(oidcStrategy.fail).toHaveBeenCalledWith(401);
});

test('authenticate should get & validate Bearer token', async () => {
  const verify = vi.spyOn(oidcStrategy, 'verify');
  oidcStrategy.authenticate({
    isAuthenticated: () => false,
    headers: {
      authorization: 'Bearer XXXXX',
    },
  });
  expect(verify).toHaveBeenCalledWith('XXXXX', expect.any(Function));
});

test('authenticate should fail when bearer token verify returns no user', async () => {
  const debugSpy = vi.spyOn(oidcStrategy.log, 'debug').mockImplementation(() => {});
  const warnSpy = vi.spyOn(oidcStrategy.log, 'warn').mockImplementation(() => {});
  oidcStrategy.verify = vi.fn((token, cb) => cb(null, null));
  oidcStrategy.authenticate({
    isAuthenticated: () => false,
    headers: {
      authorization: 'Bearer invalid-token',
    },
  });

  expect(oidcStrategy.verify).toHaveBeenCalledWith('invalid-token', expect.any(Function));
  expect(warnSpy).toHaveBeenCalledWith('Bearer token validation failed');
  expect(debugSpy).not.toHaveBeenCalledWith('Bearer token validated');
  expect(oidcStrategy.fail).toHaveBeenCalledWith(401);
});

test('authenticate should fail when bearer token verify returns error', async () => {
  const warnSpy = vi.spyOn(oidcStrategy.log, 'warn').mockImplementation(() => {});
  oidcStrategy.verify = vi.fn((token, cb) => cb(new Error('verification error'), null));
  oidcStrategy.authenticate({
    isAuthenticated: () => false,
    headers: {
      authorization: 'Bearer bad-token',
    },
  });

  expect(oidcStrategy.verify).toHaveBeenCalledWith('bad-token', expect.any(Function));
  expect(warnSpy).toHaveBeenCalledWith('Bearer token validation failed');
  expect(oidcStrategy.fail).toHaveBeenCalledWith(401);
});

test('authenticate should succeed when bearer token verify returns valid user', async () => {
  const debugSpy = vi.spyOn(oidcStrategy.log, 'debug').mockImplementation(() => {});
  const warnSpy = vi.spyOn(oidcStrategy.log, 'warn').mockImplementation(() => {});
  const user = { username: 'test@example.com' };
  oidcStrategy.verify = vi.fn((token, cb) => cb(null, user));
  oidcStrategy.authenticate({
    isAuthenticated: () => false,
    headers: {
      authorization: 'Bearer valid-token',
    },
  });

  expect(oidcStrategy.verify).toHaveBeenCalledWith('valid-token', expect.any(Function));
  expect(debugSpy).toHaveBeenCalledWith('Bearer token validated');
  expect(warnSpy).not.toHaveBeenCalled();
  expect(oidcStrategy.success).toHaveBeenCalledWith(user);
});

test('constructor should normalize missing access token to empty string in verify bridge', async () => {
  const verify = vi.fn();
  const strategy = new OidcStrategy(
    {
      config: oidcConfig,
      scope: 'openid email profile',
      name: 'oidc',
    },
    verify,
    log,
  );
  const internalVerify = (
    strategy as unknown as { _verify: (tokens: unknown, done: unknown) => void }
  )._verify;
  const done = vi.fn();

  internalVerify({ access_token: 'bridge-token' }, done);
  internalVerify({}, done);

  expect(verify).toHaveBeenNthCalledWith(1, 'bridge-token', done);
  expect(verify).toHaveBeenNthCalledWith(2, '', done);
});

test('authenticate should parse bearer token from authorization header array', async () => {
  oidcStrategy.verify = vi.fn((token, cb) => cb(null, { username: 'array-user' }));
  oidcStrategy.authenticate({
    isAuthenticated: () => false,
    headers: {
      authorization: ['Bearer array-token'],
    },
  });

  expect(oidcStrategy.verify).toHaveBeenCalledWith('array-token', expect.any(Function));
  expect(oidcStrategy.success).toHaveBeenCalledWith({ username: 'array-user' });
});

test('authenticate should fail when authorization header array is empty', async () => {
  const debugSpy = vi.spyOn(oidcStrategy.log, 'debug').mockImplementation(() => {});
  const warnSpy = vi.spyOn(oidcStrategy.log, 'warn').mockImplementation(() => {});
  oidcStrategy.verify = vi.fn((token, cb) => cb(null, { token }));
  oidcStrategy.authenticate({
    isAuthenticated: () => false,
    headers: {
      authorization: [],
    },
  });

  expect(oidcStrategy.verify).not.toHaveBeenCalled();
  expect(debugSpy).toHaveBeenCalledWith('No bearer token provided');
  expect(warnSpy).not.toHaveBeenCalled();
  expect(oidcStrategy.fail).toHaveBeenCalledWith(401);
});

test('authenticate should fail when bearer token contains trailing whitespace', async () => {
  const debugSpy = vi.spyOn(oidcStrategy.log, 'debug').mockImplementation(() => {});
  const warnSpy = vi.spyOn(oidcStrategy.log, 'warn').mockImplementation(() => {});
  oidcStrategy.verify = vi.fn((token, cb) => cb(null, { token }));
  oidcStrategy.authenticate({
    isAuthenticated: () => false,
    headers: {
      authorization: 'Bearer token-with-space ',
    },
  });

  expect(oidcStrategy.verify).not.toHaveBeenCalled();
  expect(debugSpy).toHaveBeenCalledWith('No bearer token provided');
  expect(warnSpy).not.toHaveBeenCalled();
  expect(oidcStrategy.fail).toHaveBeenCalledWith(401);
});

test('authenticate should fail when bearer token has extra authorization segments', async () => {
  const debugSpy = vi.spyOn(oidcStrategy.log, 'debug').mockImplementation(() => {});
  const warnSpy = vi.spyOn(oidcStrategy.log, 'warn').mockImplementation(() => {});
  oidcStrategy.verify = vi.fn((token, cb) => cb(null, { token }));
  oidcStrategy.authenticate({
    isAuthenticated: () => false,
    headers: {
      authorization: 'Bearer token extra',
    },
  });

  expect(oidcStrategy.verify).not.toHaveBeenCalled();
  expect(debugSpy).toHaveBeenCalledWith('No bearer token provided');
  expect(warnSpy).not.toHaveBeenCalled();
  expect(oidcStrategy.fail).toHaveBeenCalledWith(401);
});
