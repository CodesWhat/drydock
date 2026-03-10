import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { ClientSecretPost, Configuration } from 'openid-client';
import * as configuration from '../../../configuration/index.js';
import Oidc from './Oidc.js';

const app = express();

const configurationValid = {
  clientid: '123465798',
  clientsecret: 'secret',
  discovery: 'https://idp/.well-known/openid-configuration',
  redirect: false,
  timeout: 5000,
};

async function createTemporaryCaFile(
  contents = '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----\n',
) {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'oidc-ca-'));
  const caPath = path.join(tempDirectory, 'ca.pem');
  await writeFile(caPath, contents);
  return {
    caPath,
    cleanup: async () => rm(tempDirectory, { recursive: true, force: true }),
  };
}

// --- Factory helpers for repeated test fixtures ---

function createRes(overrides = {}) {
  return {
    json: vi.fn(),
    status: vi.fn().mockReturnThis(),
    send: vi.fn(),
    redirect: vi.fn(),
    ...overrides,
  };
}

function createReq(overrides = {}) {
  return {
    protocol: 'https',
    hostname: 'dd.example.com',
    login: vi.fn(),
    ...overrides,
  };
}

function createSessionWithPending(pendingEntries: Record<string, any>) {
  return {
    oidc: {
      default: {
        pending: pendingEntries,
      },
    },
  };
}

function createPendingCheck(codeVerifier = 'code-verifier') {
  return { codeVerifier, createdAt: Date.now() };
}

function createCallbackReq(
  originalUrl: string,
  session: any,
  loginBehavior?: (user, done) => void,
) {
  return createReq({
    originalUrl,
    session,
    login: vi.fn(loginBehavior || ((user, done) => done())),
  });
}

/** Set up a successful grant + userInfo mock on the openidClientMock */
function mockSuccessfulGrant(mock: any) {
  mock.authorizationCodeGrant = vi.fn().mockResolvedValue({ access_token: 'token' });
  mock.fetchUserInfo = vi.fn().mockResolvedValue({ email: 'user@example.com' });
}

/** Assert a 401 JSON error response */
function expect401Json(res: any, error = 'Authentication failed') {
  expect(res.status).toHaveBeenCalledWith(401);
  expect(res.json).toHaveBeenCalledWith({ error });
}

/** Assert a 401 JSON error response with specific message */
function expect401JsonMessage(res: any, message: string) {
  expect(res.status).toHaveBeenCalledWith(401);
  expect(res.json).toHaveBeenCalledWith({ error: message });
}

/** Perform a redirect flow and return the session with pending state */
async function performRedirect(oidcInstance: any, mock: any, session?: any) {
  const sess = session || { save: vi.fn((cb) => cb()) };
  const res = createRes();
  await oidcInstance.redirect(createReq({ session: sess }), res);
  return { session: sess, res };
}

let oidc;
let openidClientMock;

beforeEach(() => {
  vi.resetAllMocks();
  oidc = new Oidc();
  oidc.configuration = configurationValid;
  openidClientMock = {
    randomPKCECodeVerifier: vi.fn().mockReturnValue('code-verifier'),
    calculatePKCECodeChallenge: vi.fn().mockResolvedValue('code-challenge'),
    buildAuthorizationUrl: vi.fn().mockReturnValue(new URL('https://idp/auth')),
    authorizationCodeGrant: vi.fn(),
    fetchUserInfo: vi.fn(),
    skipSubjectCheck: Symbol('skip-subject-check'),
    ClientSecretPost: vi.fn(),
    customFetch: Symbol('customFetch'),
    discovery: vi.fn(),
    buildEndSessionUrl: vi.fn(),
  };
  oidc.openidClient = openidClientMock;
  oidc.client = new Configuration(
    {
      issuer: 'https://idp.example.com',
      authorization_endpoint: 'https://idp/auth',
    },
    'dd-client',
    'dd-secret',
    ClientSecretPost('dd-secret'),
  );
  oidc.name = '';
  oidc.log = {
    debug: vi.fn(),
    warn: vi.fn(),
  };
});

test('validateConfiguration should return validated configuration when valid', async () => {
  const previousPublicUrl = configuration.ddEnvVars.DD_PUBLIC_URL;
  configuration.ddEnvVars.DD_PUBLIC_URL = 'https://dd.example.com';
  try {
    const validatedConfiguration = oidc.validateConfiguration(configurationValid);
    expect(validatedConfiguration).toStrictEqual({
      ...configurationValid,
      insecure: false,
    });
  } finally {
    if (previousPublicUrl === undefined) {
      delete configuration.ddEnvVars.DD_PUBLIC_URL;
    } else {
      configuration.ddEnvVars.DD_PUBLIC_URL = previousPublicUrl;
    }
  }
});

test('validateConfiguration should throw error when invalid', async () => {
  const configuration = {};
  expect(() => {
    oidc.validateConfiguration(configuration);
  }).toThrowError('"discovery" is required');
});

test('validateConfiguration should require DD_PUBLIC_URL when OIDC is configured', async () => {
  const previousPublicUrl = configuration.ddEnvVars.DD_PUBLIC_URL;
  delete configuration.ddEnvVars.DD_PUBLIC_URL;
  try {
    expect(() => {
      oidc.validateConfiguration(configurationValid);
    }).toThrowError('DD_PUBLIC_URL must be set when OIDC authentication is configured');
  } finally {
    if (previousPublicUrl === undefined) {
      delete configuration.ddEnvVars.DD_PUBLIC_URL;
    } else {
      configuration.ddEnvVars.DD_PUBLIC_URL = previousPublicUrl;
    }
  }
});

test('validateConfiguration should allow optional logouturl override', async () => {
  const previousPublicUrl = configuration.ddEnvVars.DD_PUBLIC_URL;
  configuration.ddEnvVars.DD_PUBLIC_URL = 'https://dd.example.com';
  try {
    const configWithLogoutUrl = {
      ...configurationValid,
      logouturl: 'https://idp.example.com/logout',
    };
    const validatedConfiguration = oidc.validateConfiguration(configWithLogoutUrl);
    expect(validatedConfiguration).toStrictEqual({
      ...configWithLogoutUrl,
      insecure: false,
    });
  } finally {
    if (previousPublicUrl === undefined) {
      delete configuration.ddEnvVars.DD_PUBLIC_URL;
    } else {
      configuration.ddEnvVars.DD_PUBLIC_URL = previousPublicUrl;
    }
  }
});

test('validateConfiguration should reject non-http logouturl schemes', async () => {
  const previousPublicUrl = configuration.ddEnvVars.DD_PUBLIC_URL;
  configuration.ddEnvVars.DD_PUBLIC_URL = 'https://dd.example.com';
  try {
    expect(() => {
      oidc.validateConfiguration({
        ...configurationValid,
        logouturl: 'mailto:security@example.com',
      });
    }).toThrowError();
  } finally {
    if (previousPublicUrl === undefined) {
      delete configuration.ddEnvVars.DD_PUBLIC_URL;
    } else {
      configuration.ddEnvVars.DD_PUBLIC_URL = previousPublicUrl;
    }
  }
});

test('validateConfiguration should allow cafile and insecure TLS options', async () => {
  const previousPublicUrl = configuration.ddEnvVars.DD_PUBLIC_URL;
  configuration.ddEnvVars.DD_PUBLIC_URL = 'https://dd.example.com';
  try {
    const validatedConfiguration = oidc.validateConfiguration({
      ...configurationValid,
      cafile: '/certs/private-ca.pem',
      insecure: true,
    });
    expect(validatedConfiguration).toStrictEqual({
      ...configurationValid,
      cafile: '/certs/private-ca.pem',
      insecure: true,
    });
  } finally {
    if (previousPublicUrl === undefined) {
      delete configuration.ddEnvVars.DD_PUBLIC_URL;
    } else {
      configuration.ddEnvVars.DD_PUBLIC_URL = previousPublicUrl;
    }
  }
});

test('getStrategy should return an Authentication strategy', async () => {
  const strategy = oidc.getStrategy(app);
  expect(strategy.name).toEqual('oidc');
});

test('getStrategy should throw when express app instance is missing', async () => {
  expect(() => oidc.getStrategy()).toThrowError('OIDC strategy requires an express app instance');
});

test('getStrategy should wire redirect/callback routes to oidc handlers', async () => {
  const appMock = {
    use: vi.fn(),
    get: vi.fn(),
  };
  const redirectSpy = vi.spyOn(oidc, 'redirect').mockResolvedValue(undefined);
  const callbackSpy = vi.spyOn(oidc, 'callback').mockResolvedValue(undefined);

  oidc.getStrategy(appMock);

  const redirectHandler = appMock.get.mock.calls.find(([path]) => path.endsWith('/redirect'))[1];
  const callbackHandler = appMock.get.mock.calls.find(([path]) => path.endsWith('/cb'))[1];

  const req = createReq({ session: { save: vi.fn((cb) => cb()) } });
  const res = createRes();
  redirectHandler(req, res);
  callbackHandler(req, res);

  expect(redirectSpy).toHaveBeenCalledWith(req, res);
  expect(callbackSpy).toHaveBeenCalledWith(req, res);
});

test('getStrategy should delegate strategy verify callback to oidc.verify', async () => {
  const appMock = {
    use: vi.fn(),
    get: vi.fn(),
  };
  const verifySpy = vi.spyOn(oidc, 'verify').mockResolvedValue(undefined);
  const strategy = oidc.getStrategy(appMock);
  const done = vi.fn();

  strategy.verify('access-token', done);

  expect(verifySpy).toHaveBeenCalledWith('access-token', done);
});

test('getStrategy should enforce OIDC route rate limiting in express integration', async () => {
  const integrationApp = express();
  oidc.name = 'default';

  const redirectSpy = vi.spyOn(oidc, 'redirect').mockImplementation(async (_req, res) => {
    res.status(204).send();
  });
  vi.spyOn(oidc, 'callback').mockImplementation(async (_req, res) => {
    res.status(204).send();
  });

  oidc.getStrategy(integrationApp);

  const server = await new Promise<any>((resolve) => {
    const startedServer = integrationApp.listen(0, () => resolve(startedServer));
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve(undefined)));
    });
    throw new Error('Unable to resolve test server address');
  }

  try {
    const baseUrl = `http://127.0.0.1:${address.port}`;
    let lastStatus = 0;
    for (let requestIndex = 0; requestIndex <= 50; requestIndex += 1) {
      const response = await fetch(`${baseUrl}/auth/oidc/default/redirect`);
      lastStatus = response.status;
      await response.arrayBuffer();
    }

    expect(lastStatus).toBe(429);
    expect(redirectSpy).toHaveBeenCalledTimes(50);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve(undefined)));
    });
  }
});

test('maskConfiguration should mask configuration secrets', async () => {
  expect(oidc.maskConfiguration()).toEqual({
    clientid: '[REDACTED]',
    clientsecret: '[REDACTED]',
    discovery: 'https://idp/.well-known/openid-configuration',
    redirect: false,
    timeout: 5000,
  });
});

test('maskConfiguration should include configured logouturl', async () => {
  oidc.configuration = {
    ...configurationValid,
    logouturl: 'https://idp.example.com/logout',
  };

  expect(oidc.maskConfiguration()).toEqual({
    clientid: '[REDACTED]',
    clientsecret: '[REDACTED]',
    discovery: 'https://idp/.well-known/openid-configuration',
    redirect: false,
    logouturl: 'https://idp.example.com/logout',
    timeout: 5000,
  });
});

test('maskConfiguration should mask configured cafile', async () => {
  oidc.configuration = {
    ...configurationValid,
    cafile: '/etc/ssl/private/oidc-ca.pem',
    insecure: true,
  };

  expect(oidc.maskConfiguration()).toEqual({
    clientid: '[REDACTED]',
    clientsecret: '[REDACTED]',
    discovery: 'https://idp/.well-known/openid-configuration',
    redirect: false,
    cafile: '[REDACTED]',
    insecure: true,
    timeout: 5000,
  });
});

test('getStrategyDescription should return strategy description', async () => {
  oidc.logoutUrl = 'https://idp/logout';
  expect(oidc.getStrategyDescription()).toEqual({
    type: 'oidc',
    name: oidc.name,
    redirect: false,
    logoutUrl: 'https://idp/logout',
  });
});

test('getAllowedAuthorizationRedirects should tolerate malformed urls and normalize root endpoint path', () => {
  oidc.configuration = {
    ...configurationValid,
    discovery: 'not-a-valid-url',
  };
  oidc.client = {
    serverMetadata: () => ({
      authorization_endpoint: 'https://idp.example.com/',
      issuer: 'not-a-valid-issuer-url',
    }),
  } as any;

  const redirects = oidc.getAllowedAuthorizationRedirects();

  expect(redirects.strictEndpoints.has('https://idp.example.com/')).toBe(true);
  expect(redirects.allowedOrigins.has('https://idp.example.com')).toBe(true);
});

test('getAllowedAuthorizationRedirects should return empty allowlists when metadata client is unavailable', () => {
  oidc.configuration = {
    ...configurationValid,
    discovery: 'not-a-valid-url',
  };
  oidc.client = undefined as any;

  const redirects = oidc.getAllowedAuthorizationRedirects();

  expect(redirects.strictEndpoints.size).toBe(0);
  expect(redirects.allowedOrigins.size).toBe(0);
});

test('isAllowedAuthorizationRedirect should reject non-http protocols', () => {
  const allowed = oidc.isAllowedAuthorizationRedirect(new URL('javascript:alert(1)'));
  expect(allowed).toBe(false);
});

test('verify should return user on valid token', async () => {
  openidClientMock.fetchUserInfo = vi.fn().mockResolvedValue({ email: 'test@example.com' });

  const done = vi.fn();
  await oidc.verify('valid-token', done);

  expect(done).toHaveBeenCalledWith(null, { username: 'test@example.com' });
});

test('verify should return false on invalid token', async () => {
  openidClientMock.fetchUserInfo = vi.fn().mockRejectedValue(new Error('Invalid token'));
  oidc.log = { warn: vi.fn() };

  const done = vi.fn();
  await oidc.verify('invalid-token', done);

  expect(done).toHaveBeenCalledWith(null, false);
});

test.each([
  ['email present', { email: 'user@example.com' }, { username: 'user@example.com' }],
  ['email missing', {}, { username: 'unknown' }],
])('getUserFromAccessToken should return correct user when %s', async (_label, mockUserInfo, expected) => {
  openidClientMock.fetchUserInfo = vi.fn().mockResolvedValue(mockUserInfo);

  const user = await oidc.getUserFromAccessToken('token');
  expect(user).toEqual(expected);
});

test('redirect should persist oidc checks in session before responding', async () => {
  const save = vi.fn((cb) => cb());
  const req = createReq({ session: { save } });
  const res = createRes();

  await oidc.redirect(req, res);

  expect(req.session.oidc.default).toBeDefined();
  expect(req.session.oidc.default.pending).toBeDefined();
  expect(Object.keys(req.session.oidc.default.pending)).toHaveLength(1);
  expect(
    req.session.oidc.default.pending[Object.keys(req.session.oidc.default.pending)[0]].codeVerifier,
  ).toBeDefined();
  expect(save).toHaveBeenCalledTimes(1);
  expect(res.json).toHaveBeenCalledWith({ url: 'https://idp/auth' });
  expect(res.status).not.toHaveBeenCalled();
});

test('redirect should preserve pending checks from concurrent requests on the same session', async () => {
  openidClientMock.randomPKCECodeVerifier = vi
    .fn()
    .mockReturnValueOnce('code-verifier-1')
    .mockReturnValueOnce('code-verifier-2');

  const persistedOidcState: any = {};
  const createSession = () => {
    const session: any = {
      oidc: JSON.parse(JSON.stringify(persistedOidcState.oidc || {})),
    };
    session.reload = vi.fn((cb) => {
      setTimeout(() => {
        session.oidc = JSON.parse(JSON.stringify(persistedOidcState.oidc || {}));
        cb();
      }, 0);
    });
    session.save = vi.fn((cb) => {
      setTimeout(() => {
        persistedOidcState.oidc = JSON.parse(JSON.stringify(session.oidc || {}));
        cb();
      }, 0);
    });
    return session;
  };

  const req1: any = createReq({ sessionID: 'shared-session-id', session: createSession() });
  const req2: any = createReq({ sessionID: 'shared-session-id', session: createSession() });
  const res1 = createRes();
  const res2 = createRes();

  await Promise.all([oidc.redirect(req1, res1), oidc.redirect(req2, res2)]);

  expect(Object.keys(persistedOidcState.oidc.default.pending)).toHaveLength(2);
  expect(res1.status).not.toHaveBeenCalled();
  expect(res2.status).not.toHaveBeenCalled();
});

test('redirect should reject unexpected authorization redirect host', async () => {
  openidClientMock.buildAuthorizationUrl = vi
    .fn()
    .mockReturnValue(new URL('https://evil.example.com/auth'));
  const req = createReq({ session: { save: vi.fn((cb) => cb()) } });
  const res = createRes();

  await oidc.redirect(req, res);

  expect(res.status).toHaveBeenCalledWith(500);
  expect(res.json).toHaveBeenCalledWith({ error: 'Unable to initialize OIDC session' });
});

test('redirect should reject non-http authorization redirect urls', async () => {
  openidClientMock.buildAuthorizationUrl = vi.fn().mockReturnValue(new URL('javascript:alert(1)'));
  const req = createReq({ session: { save: vi.fn((cb) => cb()) } });
  const res = createRes();

  await oidc.redirect(req, res);

  expect(res.status).toHaveBeenCalledWith(500);
  expect(res.json).toHaveBeenCalledWith({ error: 'Unable to initialize OIDC session' });
});

test('redirect should allow discovery-origin redirects when authorization endpoint metadata is missing', async () => {
  oidc.client = new Configuration(
    {
      issuer: 'https://issuer.example.com',
    },
    'dd-client',
    'dd-secret',
    ClientSecretPost('dd-secret'),
  );
  openidClientMock.buildAuthorizationUrl = vi.fn().mockReturnValue(new URL('https://idp/auth'));
  const req = createReq({ session: { save: vi.fn((cb) => cb()) } });
  const res = createRes();

  await oidc.redirect(req, res);

  expect(res.json).toHaveBeenCalledWith({ url: 'https://idp/auth' });
  expect(res.status).not.toHaveBeenCalled();
});

test('callback should fail with explicit message when callback state is missing', async () => {
  const session = createSessionWithPending({
    state1: createPendingCheck(),
  });
  const req = createCallbackReq('/auth/oidc/default/cb?code=abc', session);
  const res = createRes();

  await oidc.callback(req, res);

  expect(openidClientMock.authorizationCodeGrant).not.toHaveBeenCalled();
  expect401JsonMessage(res, 'OIDC callback is missing state. Please retry authentication.');
});

test('callback should return explicit error when oidc checks are missing', async () => {
  openidClientMock.authorizationCodeGrant = vi.fn();

  const req = createCallbackReq(undefined, {});
  const res = createRes();

  await oidc.callback(req, res);

  expect(openidClientMock.authorizationCodeGrant).not.toHaveBeenCalled();
  expect401JsonMessage(res, 'OIDC session is missing or expired. Please retry authentication.');
});

test('callback should authenticate using matching state when multiple auth redirects are pending', async () => {
  openidClientMock.randomPKCECodeVerifier = vi
    .fn()
    .mockReturnValueOnce('code-verifier-1')
    .mockReturnValueOnce('code-verifier-2');
  mockSuccessfulGrant(openidClientMock);

  const session = { save: vi.fn((cb) => cb()) };
  const resRedirect = createRes();

  await oidc.redirect(createReq({ session }), resRedirect);
  await oidc.redirect(createReq({ session }), resRedirect);

  const stateByCodeVerifier = Object.fromEntries(
    Object.entries(session.oidc.default.pending).map(([state, check]: any) => [
      check.codeVerifier,
      state,
    ]),
  );
  const firstState = stateByCodeVerifier['code-verifier-1'];
  const secondState = stateByCodeVerifier['code-verifier-2'];

  const req = createCallbackReq(`/auth/oidc/default/cb?code=abc&state=${firstState}`, session);
  const res = createRes();

  await oidc.callback(req, res);

  expect(openidClientMock.authorizationCodeGrant).toHaveBeenCalledWith(
    oidc.client,
    expect.any(URL),
    {
      pkceCodeVerifier: 'code-verifier-1',
      expectedState: firstState,
    },
  );
  expect(req.session.oidc.default.pending[firstState]).toBeUndefined();
  expect(req.session.oidc.default.pending[secondState]).toBeDefined();
  expect(res.redirect).toHaveBeenCalledWith('https://dd.example.com');
});

test('callback should support legacy single-check session shape', async () => {
  mockSuccessfulGrant(openidClientMock);

  const req = createCallbackReq('/auth/oidc/default/cb?code=abc&state=legacy-state', {
    oidc: {
      default: {
        state: 'legacy-state',
        codeVerifier: 'legacy-code-verifier',
      },
    },
  });
  const res = createRes();

  await oidc.callback(req, res);

  expect(openidClientMock.authorizationCodeGrant).toHaveBeenCalledWith(
    oidc.client,
    expect.any(URL),
    {
      pkceCodeVerifier: 'legacy-code-verifier',
      expectedState: 'legacy-state',
    },
  );
  expect(req.session.oidc.default).toBeUndefined();
  expect(res.redirect).toHaveBeenCalledWith('https://dd.example.com');
});

test('callback should return explicit error when callback state does not match session checks', async () => {
  const session = createSessionWithPending({
    knownState: createPendingCheck(),
  });
  const req = createCallbackReq('/auth/oidc/default/cb?code=abc&state=unknown-state', session);
  const res = createRes();

  await oidc.callback(req, res);

  expect(openidClientMock.authorizationCodeGrant).not.toHaveBeenCalled();
  expect401JsonMessage(res, 'OIDC session state mismatch or expired. Please retry authentication.');
});

test('callback should reject when pending check guard reports a missing entry', async () => {
  const session = createSessionWithPending({
    knownState: createPendingCheck(),
  });
  const req = createCallbackReq('/auth/oidc/default/cb?code=abc&state=unknown-state', session);
  const res = createRes();
  const originalHasOwn = Object.hasOwn;
  const hasOwnSpy = vi
    .spyOn(Object, 'hasOwn')
    .mockImplementation((value: any, key: PropertyKey) => {
      if (key === 'unknown-state') {
        return true;
      }
      return originalHasOwn(value, key);
    });

  try {
    await oidc.callback(req, res);
  } finally {
    hasOwnSpy.mockRestore();
  }

  expect(openidClientMock.authorizationCodeGrant).not.toHaveBeenCalled();
  expect401JsonMessage(res, 'OIDC session state mismatch or expired. Please retry authentication.');
});

test('callback should reject malformed pending checks from session storage', async () => {
  const session = {
    oidc: {
      default: {
        pending: {
          'bad state': createPendingCheck('invalid-entry'),
          validstate: {
            state: 'different-state',
            codeVerifier: 'code-verifier',
            createdAt: Date.now(),
          },
        },
      },
    },
  };
  const req = createCallbackReq('/auth/oidc/default/cb?code=abc&state=validstate', session);
  const res = createRes();

  await oidc.callback(req, res);

  expect(openidClientMock.authorizationCodeGrant).not.toHaveBeenCalled();
  expect401JsonMessage(res, 'OIDC session state mismatch or expired. Please retry authentication.');
});

test('callback should reject state tokens shorter than 8 characters', async () => {
  const session = createSessionWithPending({
    a: createPendingCheck(),
  });
  const req = createCallbackReq('/auth/oidc/default/cb?code=abc&state=a', session);
  const res = createRes();

  await oidc.callback(req, res);

  expect(openidClientMock.authorizationCodeGrant).not.toHaveBeenCalled();
  expect401JsonMessage(res, 'OIDC callback is missing state. Please retry authentication.');
});

test('callback should reject pending checks older than 5 minutes', async () => {
  const session = createSessionWithPending({
    'valid-state': {
      state: 'valid-state',
      codeVerifier: 'expired-code-verifier',
      createdAt: Date.now() - (5 * 60 * 1000 + 1),
    },
  });
  const req = createCallbackReq('/auth/oidc/default/cb?code=abc&state=valid-state', session);
  const res = createRes();

  await oidc.callback(req, res);

  expect(openidClientMock.authorizationCodeGrant).not.toHaveBeenCalled();
  expect401JsonMessage(res, 'OIDC session state mismatch or expired. Please retry authentication.');
});

test('callback should accept pending checks without numeric createdAt', async () => {
  mockSuccessfulGrant(openidClientMock);

  const session = {
    save: vi.fn((cb) => cb()),
    oidc: {
      default: {
        pending: {
          'valid-state': {
            codeVerifier: 'code-verifier-without-created-at',
          },
        },
      },
    },
  };
  const req = createCallbackReq('/auth/oidc/default/cb?code=abc&state=valid-state', session);
  const res = createRes();

  await oidc.callback(req, res);

  expect(openidClientMock.authorizationCodeGrant).toHaveBeenCalledWith(
    oidc.client,
    expect.any(URL),
    {
      pkceCodeVerifier: 'code-verifier-without-created-at',
      expectedState: 'valid-state',
    },
  );
  expect(res.redirect).toHaveBeenCalledWith('https://dd.example.com');
});

test('redirect should not wait forever when previous session lock never settles', async () => {
  vi.useFakeTimers();
  const originalMapGet = Map.prototype.get;
  let injectedNeverSettlingLock = false;
  const neverSettlingLock = new Promise<void>(() => undefined);
  const mapGetSpy = vi.spyOn(Map.prototype, 'get').mockImplementation(function (key) {
    if (!injectedNeverSettlingLock && key === 'never-settling-session-lock') {
      injectedNeverSettlingLock = true;
      return neverSettlingLock;
    }
    return originalMapGet.call(this, key);
  });

  try {
    const req = createReq({
      sessionID: 'never-settling-session-lock',
      session: {
        reload: vi.fn((cb) => cb()),
        save: vi.fn((cb) => cb()),
      },
    });
    const res = createRes();
    const redirectPromise = oidc.redirect(req, res);
    let settled = false;
    redirectPromise.finally(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(60 * 1000);
    await Promise.resolve();

    expect(settled).toBe(true);
    await redirectPromise;
    expect(res.json).toHaveBeenCalledWith({ url: 'https://idp/auth' });
    expect(res.status).not.toHaveBeenCalled();
  } finally {
    mapGetSpy.mockRestore();
    vi.useRealTimers();
  }
});

test('redirect should recover when a stale rejected lock promise exists', async () => {
  const originalMapGet = Map.prototype.get;
  let injectedRejectedLock = false;
  const mapGetSpy = vi.spyOn(Map.prototype, 'get').mockImplementation(function (key) {
    if (!injectedRejectedLock && key === 'stale-session-lock') {
      injectedRejectedLock = true;
      return Promise.reject(new Error('stale lock'));
    }
    return originalMapGet.call(this, key);
  });

  try {
    const req = createReq({
      sessionID: 'stale-session-lock',
      session: {
        reload: vi.fn((cb) => cb()),
        save: vi.fn((cb) => cb()),
      },
    });
    const res = createRes();

    await oidc.redirect(req, res);

    expect(res.json).toHaveBeenCalledWith({ url: 'https://idp/auth' });
    expect(res.status).not.toHaveBeenCalled();
  } finally {
    mapGetSpy.mockRestore();
  }
});

test('callback should proceed when session object disappears before cleanup', async () => {
  openidClientMock.authorizationCodeGrant = vi.fn().mockResolvedValue({ access_token: 'token' });
  openidClientMock.fetchUserInfo = vi.fn().mockResolvedValue({ email: 'user@example.com' });

  const session = createSessionWithPending({
    'valid-state': createPendingCheck(),
  });
  const req = createCallbackReq('/auth/oidc/default/cb?code=abc&state=valid-state', session);
  openidClientMock.authorizationCodeGrant.mockImplementation(async () => {
    req.session = undefined;
    return { access_token: 'token' };
  });
  const res = createRes();

  await oidc.callback(req, res);

  expect(req.session).toBeUndefined();
  expect(res.redirect).toHaveBeenCalledWith('https://dd.example.com');
});

test('callback should proceed when session key is removed before cleanup', async () => {
  openidClientMock.authorizationCodeGrant = vi.fn().mockResolvedValue({ access_token: 'token' });
  openidClientMock.fetchUserInfo = vi.fn().mockResolvedValue({ email: 'user@example.com' });

  const session = {
    save: vi.fn((cb) => cb()),
    oidc: {
      default: {
        pending: {
          'valid-state': createPendingCheck(),
        },
      },
    },
  };
  const req = createCallbackReq('/auth/oidc/default/cb?code=abc&state=valid-state', session);
  openidClientMock.authorizationCodeGrant.mockImplementation(async () => {
    delete req.session.oidc.default;
    return { access_token: 'token' };
  });
  const res = createRes();

  await oidc.callback(req, res);

  expect(req.session.oidc.default).toBeUndefined();
  expect(res.redirect).toHaveBeenCalledWith('https://dd.example.com');
});

test('callback should preserve other oidc strategy checks when current strategy key disappears', async () => {
  openidClientMock.authorizationCodeGrant = vi.fn().mockResolvedValue({ access_token: 'token' });
  openidClientMock.fetchUserInfo = vi.fn().mockResolvedValue({ email: 'user@example.com' });

  const session = {
    save: vi.fn((cb) => cb()),
    oidc: {
      default: {
        pending: {
          'valid-state': createPendingCheck(),
        },
      },
      other: {
        pending: {
          'other-state': createPendingCheck('other-code-verifier'),
        },
      },
    },
  };
  const req = createCallbackReq('/auth/oidc/default/cb?code=abc&state=valid-state', session);
  openidClientMock.authorizationCodeGrant.mockImplementation(async () => {
    delete req.session.oidc.default;
    return { access_token: 'token' };
  });
  const res = createRes();

  await oidc.callback(req, res);

  expect(req.session.oidc.default).toBeUndefined();
  expect(req.session.oidc.other).toBeDefined();
  expect(res.redirect).toHaveBeenCalledWith('https://dd.example.com');
});

test('callback should fall back to slash redirect when public url is empty', async () => {
  mockSuccessfulGrant(openidClientMock);

  const getPublicUrlSpy = vi
    .spyOn(configuration, 'getPublicUrl')
    .mockReturnValueOnce('https://dd.example.com')
    .mockReturnValueOnce('');

  try {
    const session = createSessionWithPending({
      'valid-state': createPendingCheck(),
    });
    const req = createCallbackReq('/auth/oidc/default/cb?code=abc&state=valid-state', session);
    const res = createRes();

    await oidc.callback(req, res);

    expect(res.redirect).toHaveBeenCalledWith('/');
  } finally {
    getPublicUrlSpy.mockRestore();
  }
});

test('callback should return 401 when login fails with error', async () => {
  mockSuccessfulGrant(openidClientMock);

  const { session } = await performRedirect(oidc, openidClientMock);

  const state = Object.keys(session.oidc.default.pending)[0];
  const req = createCallbackReq(
    `/auth/oidc/default/cb?code=abc&state=${state}`,
    session,
    (user, done) => done(new Error('login failed')),
  );
  const res = createRes();

  await oidc.callback(req, res);

  expect401Json(res);
});

test('callback should evict oldest sessions when concurrent session cap is reached', async () => {
  mockSuccessfulGrant(openidClientMock);

  const getServerConfigurationSpy = vi.spyOn(configuration, 'getServerConfiguration');
  getServerConfigurationSpy.mockReturnValue({
    session: {
      maxconcurrentsessions: 2,
    },
  } as ReturnType<typeof configuration.getServerConfiguration>);

  try {
    const session = createSessionWithPending({
      'valid-state': createPendingCheck(),
    });
    const req = createCallbackReq('/auth/oidc/default/cb?code=abc&state=valid-state', session);
    req.sessionID = 'current-session';
    req.sessionStore = {
      all: vi.fn((done) =>
        done(null, {
          'session-oldest': {
            passport: {
              user: JSON.stringify({ username: 'user@example.com' }),
            },
            cookie: {
              expires: '2026-01-01T00:00:00.000Z',
            },
          },
          'session-newer': {
            passport: {
              user: JSON.stringify({ username: 'user@example.com' }),
            },
            cookie: {
              expires: '2026-01-02T00:00:00.000Z',
            },
          },
          'other-user-session': {
            passport: {
              user: JSON.stringify({ username: 'other@example.com' }),
            },
            cookie: {
              expires: '2026-01-03T00:00:00.000Z',
            },
          },
        }),
      ),
      destroy: vi.fn((_sid, done) => done()),
    };
    const res = createRes();

    await oidc.callback(req, res);

    expect(req.sessionStore.destroy).toHaveBeenCalledTimes(1);
    expect(req.sessionStore.destroy).toHaveBeenCalledWith('session-oldest', expect.any(Function));
    expect(req.login).toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith('https://dd.example.com');
  } finally {
    getServerConfigurationSpy.mockRestore();
  }
});

test('callback should set long-lived cookie when rememberMe is true', async () => {
  mockSuccessfulGrant(openidClientMock);

  const session = createSessionWithPending({
    'valid-state': createPendingCheck(),
  });
  session.cookie = {};
  session.rememberMe = true;

  const req = createCallbackReq('/auth/oidc/default/cb?code=abc&state=valid-state', session);
  const res = createRes();

  await oidc.callback(req, res);

  expect(req.session.cookie.maxAge).toBe(3600 * 1000 * 24 * 30);
  expect(res.redirect).toHaveBeenCalledWith('https://dd.example.com');
});

test('callback should regenerate the session before completing login', async () => {
  mockSuccessfulGrant(openidClientMock);

  const regenerate = vi.fn((done) => done());
  const session = createSessionWithPending({
    'valid-state': createPendingCheck(),
  });
  session.regenerate = regenerate;

  const req = createCallbackReq('/auth/oidc/default/cb?code=abc&state=valid-state', session);
  const res = createRes();

  await oidc.callback(req, res);

  expect(regenerate).toHaveBeenCalledTimes(1);
  expect(req.login).toHaveBeenCalled();
  expect(res.redirect).toHaveBeenCalledWith('https://dd.example.com');
});

test('callback should return 401 when session regeneration fails', async () => {
  mockSuccessfulGrant(openidClientMock);

  const session = createSessionWithPending({
    'valid-state': createPendingCheck(),
  });
  session.regenerate = vi.fn((done) => done(new Error('session regenerate failed')));

  const req = createCallbackReq('/auth/oidc/default/cb?code=abc&state=valid-state', session);
  const res = createRes();

  await oidc.callback(req, res);

  expect(session.regenerate).toHaveBeenCalledTimes(1);
  expect401Json(res);
});

test('callback should convert cookie to session cookie when rememberMe is false', async () => {
  mockSuccessfulGrant(openidClientMock);

  const session = createSessionWithPending({
    'valid-state': createPendingCheck(),
  });
  session.cookie = { maxAge: 12345, expires: new Date() };
  session.rememberMe = false;

  const req = createCallbackReq('/auth/oidc/default/cb?code=abc&state=valid-state', session);
  const res = createRes();

  await oidc.callback(req, res);

  expect(req.session.cookie.expires).toBe(false);
  expect(req.session.cookie.maxAge).toBeNull();
  expect(res.redirect).toHaveBeenCalledWith('https://dd.example.com');
});

test('callback should return 401 when authorizationCodeGrant throws', async () => {
  openidClientMock.authorizationCodeGrant = vi.fn().mockRejectedValue(new Error('grant failed'));

  const session = createSessionWithPending({
    'valid-state': createPendingCheck(),
  });
  const req = createCallbackReq('/auth/oidc/default/cb?code=abc&state=valid-state', session);
  const res = createRes();

  await oidc.callback(req, res);

  expect401Json(res);
});

test('callback should return 401 when authorizationCodeGrant rejects with non-Error', async () => {
  openidClientMock.authorizationCodeGrant = vi.fn().mockRejectedValue(null);

  const session = createSessionWithPending({
    'valid-state': createPendingCheck(),
  });
  const req = createCallbackReq('/auth/oidc/default/cb?code=abc&state=valid-state', session);
  const res = createRes();

  await oidc.callback(req, res);

  expect401Json(res);
  expect(oidc.log.warn).toHaveBeenCalledWith(
    expect.stringContaining('Error when logging the user [unknown error]'),
  );
});

test.each([
  ['session is unavailable', {}],
  ['session save fails', { session: { save: vi.fn((cb) => cb(new Error('save failed'))) } }],
])('redirect should respond with 500 when %s', async (_label, reqOverrides) => {
  const req = createReq(reqOverrides);
  const res = createRes();

  await oidc.redirect(req, res);

  expect(res.status).toHaveBeenCalledWith(500);
  expect(res.json).toHaveBeenCalledWith({ error: 'Unable to initialize OIDC session' });
});

test('redirect should respond with 500 when session save throws non-Error', async () => {
  const req = createReq({
    session: {
      save: vi.fn(() => {
        throw null;
      }),
    },
  });
  const res = createRes();

  await oidc.redirect(req, res);

  expect(res.status).toHaveBeenCalledWith(500);
  expect(res.json).toHaveBeenCalledWith({ error: 'Unable to initialize OIDC session' });
  expect(oidc.log.warn).toHaveBeenCalledWith(
    expect.stringContaining('Unable to persist OIDC session checks (unknown error)'),
  );
});

test('redirect should recover from session reload error by regenerating', async () => {
  const regenerate = vi.fn((cb) => cb());
  const save = vi.fn((cb) => cb());
  const req = createReq({
    session: {
      reload: vi.fn((cb) => cb(new Error('corrupt session'))),
      regenerate,
      save,
    },
  });
  const res = createRes();

  await oidc.redirect(req, res);

  expect(regenerate).toHaveBeenCalledTimes(1);
  expect(res.json).toHaveBeenCalledWith({ url: 'https://idp/auth' });
  expect(res.status).not.toHaveBeenCalled();
});

test('redirect should recover from session reload error even without regenerate', async () => {
  const save = vi.fn((cb) => cb());
  const req = createReq({
    session: {
      reload: vi.fn((cb) => cb(new Error('corrupt session'))),
      save,
    },
  });
  const res = createRes();

  await oidc.redirect(req, res);

  expect(res.json).toHaveBeenCalledWith({ url: 'https://idp/auth' });
  expect(res.status).not.toHaveBeenCalled();
});

test('callback should return 401 when access_token is missing', async () => {
  openidClientMock.authorizationCodeGrant = vi.fn().mockResolvedValue({});

  const session = createSessionWithPending({
    'valid-state': createPendingCheck(),
  });
  const req = createCallbackReq('/auth/oidc/default/cb?code=abc&state=valid-state', session);
  const res = createRes();

  await oidc.callback(req, res);

  expect401Json(res);
});

test('initAuthentication should discover and configure client', async () => {
  const mockClient = {};
  openidClientMock.discovery = vi.fn().mockResolvedValue(mockClient);
  openidClientMock.buildEndSessionUrl = vi.fn().mockReturnValue(new URL('https://idp/logout'));
  openidClientMock.allowInsecureRequests = Symbol('allowInsecureRequests');

  await oidc.initAuthentication();

  const callArgs = openidClientMock.discovery.mock.calls[0];
  expect(callArgs[4].execute).toEqual([]);
  expect(callArgs[4][openidClientMock.customFetch]).toBeUndefined();
  expect(oidc.logoutUrl).toBe('https://idp/logout');
});

test('initAuthentication should pass allowInsecureRequests for HTTP discovery URLs', async () => {
  oidc.configuration = {
    ...configurationValid,
    discovery: 'http://dex:5556/dex/.well-known/openid-configuration',
  };
  const mockClient = {};
  openidClientMock.discovery = vi.fn().mockResolvedValue(mockClient);
  openidClientMock.buildEndSessionUrl = vi.fn().mockReturnValue(new URL('https://idp/logout'));
  const insecureSymbol = Symbol('allowInsecureRequests');
  openidClientMock.allowInsecureRequests = insecureSymbol;

  await oidc.initAuthentication();

  const callArgs = openidClientMock.discovery.mock.calls[0];
  expect(callArgs[4].execute).toEqual([insecureSymbol]);
});

test('initAuthentication should log deprecation warning for HTTP discovery URL', async () => {
  oidc.configuration = {
    ...configurationValid,
    discovery: 'http://dex:5556/dex/.well-known/openid-configuration',
  };
  openidClientMock.discovery = vi.fn().mockResolvedValue({});
  openidClientMock.buildEndSessionUrl = vi.fn().mockReturnValue(new URL('https://idp/logout'));

  await oidc.initAuthentication();

  expect(oidc.log.warn).toHaveBeenCalledWith(
    'HTTP OIDC discovery URL is deprecated and will be removed in v1.6.0. Update your Identity Provider to serve discovery over HTTPS.',
  );
});

test('initAuthentication should handle missing end session url', async () => {
  const mockClient = {};
  openidClientMock.discovery = vi.fn().mockResolvedValue(mockClient);
  openidClientMock.buildEndSessionUrl = vi.fn().mockImplementation(() => {
    throw new Error('not supported');
  });

  await oidc.initAuthentication();

  expect(openidClientMock.discovery).toHaveBeenCalled();
  expect(oidc.log.warn).toHaveBeenCalledWith(
    expect.stringContaining('End session url is not supported'),
  );
});

test('initAuthentication should handle non-Error end session url failure', async () => {
  const mockClient = {};
  openidClientMock.discovery = vi.fn().mockResolvedValue(mockClient);
  openidClientMock.buildEndSessionUrl = vi.fn().mockImplementation(() => {
    throw null;
  });

  await oidc.initAuthentication();

  expect(openidClientMock.discovery).toHaveBeenCalled();
  expect(oidc.log.warn).toHaveBeenCalledWith(
    expect.stringContaining('End session url is not supported (unknown error)'),
  );
});

test('initAuthentication should configure custom fetch when cafile is set', async () => {
  const { caPath, cleanup } = await createTemporaryCaFile();
  const fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(null, { status: 200 }) as Response);
  oidc.configuration = {
    ...configurationValid,
    cafile: caPath,
  };
  const mockClient = {};
  openidClientMock.discovery = vi.fn().mockResolvedValue(mockClient);
  openidClientMock.buildEndSessionUrl = vi.fn().mockReturnValue(new URL('https://idp/logout'));

  try {
    await oidc.initAuthentication();

    const callArgs = openidClientMock.discovery.mock.calls[0];
    const customFetch = callArgs[4][openidClientMock.customFetch];
    expect(typeof customFetch).toBe('function');

    await customFetch('https://idp.example.com/.well-known/openid-configuration', {
      method: 'GET',
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://idp.example.com/.well-known/openid-configuration',
      expect.objectContaining({ dispatcher: expect.anything() }),
    );
  } finally {
    fetchSpy.mockRestore();
    await cleanup();
  }
});

test('initAuthentication should configure custom fetch and warn when insecure TLS is enabled', async () => {
  const fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(null, { status: 200 }) as Response);
  oidc.configuration = {
    ...configurationValid,
    insecure: true,
  };
  const mockClient = {};
  openidClientMock.discovery = vi.fn().mockResolvedValue(mockClient);
  openidClientMock.buildEndSessionUrl = vi.fn().mockReturnValue(new URL('https://idp/logout'));

  try {
    await oidc.initAuthentication();

    expect(oidc.log.warn).toHaveBeenCalledWith(
      'TLS certificate verification disabled for OIDC - do not use in production',
    );

    const callArgs = openidClientMock.discovery.mock.calls[0];
    const customFetch = callArgs[4][openidClientMock.customFetch];
    expect(typeof customFetch).toBe('function');

    await customFetch('https://idp.example.com/.well-known/openid-configuration', {
      method: 'GET',
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://idp.example.com/.well-known/openid-configuration',
      expect.objectContaining({ dispatcher: expect.anything() }),
    );
  } finally {
    fetchSpy.mockRestore();
  }
});

test('initAuthentication should use configured logouturl when end session url is unsupported', async () => {
  oidc.configuration = {
    ...configurationValid,
    logouturl: 'https://idp.example.com/logout',
  };
  const mockClient = {};
  openidClientMock.discovery = vi.fn().mockResolvedValue(mockClient);
  openidClientMock.buildEndSessionUrl = vi.fn().mockImplementation(() => {
    throw new Error('not supported');
  });

  await oidc.initAuthentication();

  expect(oidc.logoutUrl).toBe('https://idp.example.com/logout');
});

test('getSessionKey should return name when set', () => {
  oidc.name = 'my-oidc';
  expect(oidc.getSessionKey()).toBe('my-oidc');
});

test('callback should use req.url as fallback when originalUrl is missing', async () => {
  mockSuccessfulGrant(openidClientMock);

  const { session } = await performRedirect(oidc, openidClientMock);

  const state = Object.keys(session.oidc.default.pending)[0];
  const req = createReq({
    url: `/auth/oidc/default/cb?code=abc&state=${state}`,
    session,
    login: vi.fn((user, done) => done()),
  });
  const res = createRes();

  await oidc.callback(req, res);
  expect(res.redirect).toHaveBeenCalledWith('https://dd.example.com');
});

test('redirect should return 500 when session regenerate also fails after reload error', async () => {
  const regenerate = vi.fn((cb) => cb(new Error('regenerate failed')));
  const save = vi.fn((cb) => cb());
  const req = createReq({
    session: {
      reload: vi.fn((cb) => cb(new Error('corrupt session'))),
      regenerate,
      save,
    },
  });
  const res = createRes();

  await oidc.redirect(req, res);

  expect(regenerate).toHaveBeenCalledTimes(1);
  expect(res.status).toHaveBeenCalledWith(500);
  expect(res.json).toHaveBeenCalledWith({ error: 'Unable to initialize OIDC session' });
});

test('redirect should skip session lock when sessionID is empty', async () => {
  const save = vi.fn((cb) => cb());
  const req = createReq({ sessionID: '', session: { save } });
  const res = createRes();

  await oidc.redirect(req, res);

  expect(res.json).toHaveBeenCalledWith({ url: 'https://idp/auth' });
});

test('stale lock cleanup timer should delete session lock when operation outlives TTL', async () => {
  vi.useFakeTimers();
  const originalMapGet = Map.prototype.get;
  let injectedNeverSettlingLock = false;
  const neverSettlingLock = new Promise<void>(() => undefined);
  const mapGetSpy = vi.spyOn(Map.prototype, 'get').mockImplementation(function (key) {
    if (!injectedNeverSettlingLock && key === 'stale-ttl-session') {
      injectedNeverSettlingLock = true;
      return neverSettlingLock;
    }
    return originalMapGet.call(this, key);
  });

  // Track whether the lock map entry is deleted during the stale TTL window.
  const mapDeleteSpy = vi.spyOn(Map.prototype, 'delete');

  // Make session.reload never call back so the operation hangs indefinitely.
  // This keeps us inside `await operation()` past the 60s stale lock TTL.
  let resolveReload: ((error?: unknown) => void) | undefined;
  const req = createReq({
    sessionID: 'stale-ttl-session',
    session: {
      reload: vi.fn((cb) => {
        resolveReload = cb;
      }),
      save: vi.fn((cb) => cb()),
    },
  });
  const res = createRes();

  const redirectPromise = oidc.redirect(req, res);

  // Advance past the 10s wait timeout so the operation starts (but hangs on reload).
  await vi.advanceTimersByTimeAsync(10_000);

  // Clear the delete spy call history so we only track deletes from the stale timer.
  mapDeleteSpy.mockClear();

  // Advance to 60s total — the stale lock cleanup timer fires (lines 160-161).
  await vi.advanceTimersByTimeAsync(50_000);

  // The stale lock timer should have called oidcSessionLocks.delete('stale-ttl-session').
  expect(mapDeleteSpy).toHaveBeenCalledWith('stale-ttl-session');

  // Now let the reload callback resolve so the operation completes and the test finishes.
  resolveReload?.();
  await vi.advanceTimersByTimeAsync(0);
  await redirectPromise;

  expect(res.json).toHaveBeenCalledWith({ url: 'https://idp/auth' });

  mapGetSpy.mockRestore();
  mapDeleteSpy.mockRestore();
  vi.useRealTimers();
});
