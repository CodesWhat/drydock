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

test('authenticate should return user from session if so', async () => {
  oidcStrategy.authenticate({ isAuthenticated: () => true });
  expect(oidcStrategy.success).toHaveBeenCalled();
});

test('authenticate should call super.authenticate when no existing session', async () => {
  const fail = vi.spyOn(oidcStrategy, 'fail');
  oidcStrategy.authenticate({ isAuthenticated: () => false, headers: {} });
  expect(fail).toHaveBeenCalled();
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
  oidcStrategy.verify = vi.fn((token, cb) => cb(null, null));
  oidcStrategy.authenticate({
    isAuthenticated: () => false,
    headers: {
      authorization: 'Bearer invalid-token',
    },
  });
  expect(oidcStrategy.fail).toHaveBeenCalledWith(401);
});

test('authenticate should fail when bearer token verify returns error', async () => {
  oidcStrategy.verify = vi.fn((token, cb) => cb(new Error('verification error'), null));
  oidcStrategy.authenticate({
    isAuthenticated: () => false,
    headers: {
      authorization: 'Bearer bad-token',
    },
  });
  expect(oidcStrategy.fail).toHaveBeenCalledWith(401);
});

test('authenticate should succeed when bearer token verify returns valid user', async () => {
  const user = { username: 'test@example.com' };
  oidcStrategy.verify = vi.fn((token, cb) => cb(null, user));
  oidcStrategy.authenticate({
    isAuthenticated: () => false,
    headers: {
      authorization: 'Bearer valid-token',
    },
  });
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
  const fail = vi.spyOn(oidcStrategy, 'fail');
  oidcStrategy.authenticate({
    isAuthenticated: () => false,
    headers: {
      authorization: [],
    },
  });

  expect(fail).toHaveBeenCalledWith(401);
});

test('authenticate should fail when bearer token contains trailing whitespace', async () => {
  const fail = vi.spyOn(oidcStrategy, 'fail');
  const verify = vi.fn();
  oidcStrategy.verify = verify;

  oidcStrategy.authenticate({
    isAuthenticated: () => false,
    headers: {
      authorization: 'Bearer token-with-space ',
    },
  });

  expect(verify).not.toHaveBeenCalled();
  expect(fail).toHaveBeenCalledWith(401);
});

test('authenticate should fail when bearer token has extra authorization segments', async () => {
  const fail = vi.spyOn(oidcStrategy, 'fail');
  const verify = vi.fn();
  oidcStrategy.verify = verify;

  oidcStrategy.authenticate({
    isAuthenticated: () => false,
    headers: {
      authorization: 'Bearer token extra',
    },
  });

  expect(verify).not.toHaveBeenCalled();
  expect(fail).toHaveBeenCalledWith(401);
});
