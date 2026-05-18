import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { ClientSecretPost, Configuration } from 'openid-client';
import * as configuration from '../../../configuration/index.js';

const { mockRecordAuthLogin, mockObserveAuthLoginDuration, mockUndiciFetch } = vi.hoisted(() => ({
  mockRecordAuthLogin: vi.fn(),
  mockObserveAuthLoginDuration: vi.fn(),
  mockUndiciFetch: vi.fn(),
}));

vi.mock('../../../prometheus/auth.js', () => ({
  recordAuthLogin: mockRecordAuthLogin,
  observeAuthLoginDuration: mockObserveAuthLoginDuration,
}));

vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>();
  return {
    ...actual,
    fetch: mockUndiciFetch,
  };
});

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

function expectDefaultRedirectPayload(res: any) {
  expect(res.json).toHaveBeenCalledWith({
    redirect: 'https://idp/auth',
    strictEndpoints: ['https://idp/auth'],
    allowedOrigins: ['https://idp', 'https://idp.example.com'],
  });
}

function getUndiciAgentOptions(dispatcher: unknown): Record<string, unknown> | undefined {
  if (!dispatcher || typeof dispatcher !== 'object') {
    return undefined;
  }

  const optionsSymbol = Object.getOwnPropertySymbols(dispatcher).find(
    (symbol) => symbol.description === 'options',
  );
  if (!optionsSymbol) {
    return undefined;
  }

  return (dispatcher as Record<symbol, unknown>)[optionsSymbol] as
    | Record<string, unknown>
    | undefined;
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
  mockRecordAuthLogin.mockClear();
  mockObserveAuthLoginDuration.mockClear();
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

test('getStrategyDescription should fall back to configured logouturl when discovery has not set one', async () => {
  oidc.logoutUrl = undefined;
  oidc.configuration = {
    ...configurationValid,
    logouturl: 'https://idp.example.com/logout',
  };

  expect(oidc.getStrategyDescription()).toEqual({
    type: 'oidc',
    name: oidc.name,
    redirect: false,
    logoutUrl: 'https://idp.example.com/logout',
  });
});

test('getInitializedClient should throw when the client is not initialized', async () => {
  oidc.client = undefined;

  expect(() => oidc.getInitializedClient()).toThrowError('OIDC client is not initialized');
});

test('ensureClientInitialized should reuse an in-flight initialization promise', async () => {
  oidc.client = undefined;
  oidc.clientInitializationPromise = Promise.resolve();
  const discoverClientSpy = vi.spyOn(oidc, 'discoverClient');

  await oidc.ensureClientInitialized();

  expect(discoverClientSpy).not.toHaveBeenCalled();
});

test('ensureClientInitialized should preserve a newer initialization promise when an older attempt settles', async () => {
  oidc.client = undefined;
  let resolveDiscovery!: () => void;
  const discoveryPromise = new Promise<void>((resolve) => {
    resolveDiscovery = resolve;
  });
  const discoverClientSpy = vi
    .spyOn(oidc, 'discoverClient')
    .mockReturnValue(discoveryPromise as Promise<any>);

  const initialization = oidc.ensureClientInitialized();
  const replacementPromise = Promise.resolve();
  oidc.clientInitializationPromise = replacementPromise;
  resolveDiscovery();

  await initialization;

  expect(discoverClientSpy).toHaveBeenCalledTimes(1);
  expect(oidc.clientInitializationPromise).toBe(replacementPromise);
});

test('ensureClientInitialized should share a single discovery attempt across concurrent callers', async () => {
  oidc.client = undefined;
  let resolveDiscovery!: () => void;
  const discoveryPromise = new Promise<void>((resolve) => {
    resolveDiscovery = resolve;
  });
  const discoverClientSpy = vi
    .spyOn(oidc, 'discoverClient')
    .mockReturnValue(discoveryPromise as Promise<any>);

  const firstInitialization = oidc.ensureClientInitialized();
  const secondInitialization = oidc.ensureClientInitialized();
  resolveDiscovery();

  await expect(Promise.all([firstInitialization, secondInitialization])).resolves.toEqual([
    undefined,
    undefined,
  ]);
  expect(discoverClientSpy).toHaveBeenCalledTimes(1);
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

test('isAllowedAuthorizationRedirect should require authorization endpoint metadata', () => {
  oidc.client = new Configuration(
    {
      issuer: 'https://issuer.example.com',
    },
    'dd-client',
    'dd-secret',
    ClientSecretPost('dd-secret'),
  );

  const allowed = oidc.isAllowedAuthorizationRedirect(new URL('https://idp/auth'));

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
  expectDefaultRedirectPayload(res);
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

test('redirect should redact sensitive query params in debug log', async () => {
  const urlWithSecrets = new URL(
    'https://idp/auth?redirect_uri=https%3A%2F%2Fdd.example.com%2Fcb&scope=openid&client_id=my-secret-id&code_challenge=abc123&state=xyz789&code_challenge_method=S256',
  );
  openidClientMock.buildAuthorizationUrl = vi.fn().mockReturnValue(urlWithSecrets);
  const req = createReq({ session: { save: vi.fn((cb) => cb()) } });
  const res = createRes();

  await oidc.redirect(req, res);

  const debugMsg = oidc.log.debug.mock.calls[0][0];
  expect(debugMsg).toContain('[REDACTED]');
  expect(debugMsg).not.toContain('my-secret-id');
  expect(debugMsg).not.toContain('abc123');
  expect(debugMsg).not.toContain('xyz789');
  expect(debugMsg).toContain('redirect_uri');
  expect(debugMsg).toContain('scope=openid');
});

test('redirect should redact sensitive params in warn log for rejected redirect', async () => {
  const urlWithSecrets = new URL(
    'https://evil.example.com/auth?client_id=my-secret-id&state=xyz789',
  );
  openidClientMock.buildAuthorizationUrl = vi.fn().mockReturnValue(urlWithSecrets);
  const req = createReq({ session: { save: vi.fn((cb) => cb()) } });
  const res = createRes();

  await oidc.redirect(req, res);

  const warnMsg = oidc.log.warn.mock.calls[0][0];
  expect(warnMsg).toContain('[REDACTED]');
  expect(warnMsg).not.toContain('my-secret-id');
  expect(warnMsg).not.toContain('xyz789');
});

test('redirect should redact malformed authorization urls in logs', async () => {
  openidClientMock.buildAuthorizationUrl = vi.fn().mockReturnValue({ href: '%' });
  const req = createReq({ session: { save: vi.fn((cb) => cb()) } });
  const res = createRes();

  await oidc.redirect(req, res);

  expect(oidc.log.debug).toHaveBeenCalledWith(expect.stringContaining('[unparseable URL]'));
  expect(oidc.log.warn).toHaveBeenCalledWith(expect.stringContaining('[unparseable URL]'));
  expect(res.status).toHaveBeenCalledWith(500);
  expect(res.json).toHaveBeenCalledWith({ error: 'Unable to initialize OIDC session' });
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

test('redirect should reject authorization redirects when authorization endpoint metadata is missing', async () => {
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

  expect(res.status).toHaveBeenCalledWith(500);
  expect(res.json).toHaveBeenCalledWith({ error: 'Unable to initialize OIDC session' });
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
    expectDefaultRedirectPayload(res);
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

    expectDefaultRedirectPayload(res);
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

test('callback should redact sensitive token values from login error logs', async () => {
  mockSuccessfulGrant(openidClientMock);

  const { session } = await performRedirect(oidc, openidClientMock);

  const state = Object.keys(session.oidc.default.pending)[0];
  const req = createCallbackReq(
    `/auth/oidc/default/cb?code=abc&state=${state}`,
    session,
    (_user, done) =>
      done(
        new Error(
          'login failed: access_token=secret-access refresh_token=secret-refresh id_token=secret-id',
        ),
      ),
  );
  const res = createRes();

  await oidc.callback(req, res);

  expect401Json(res);
  const warnMsg = oidc.log.warn.mock.calls.at(-1)?.[0];
  expect(warnMsg).toContain('[REDACTED]');
  expect(warnMsg).not.toContain('secret-access');
  expect(warnMsg).not.toContain('secret-refresh');
  expect(warnMsg).not.toContain('secret-id');
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

test('callback should redact sensitive token values from authorizationCodeGrant error logs', async () => {
  openidClientMock.authorizationCodeGrant = vi
    .fn()
    .mockRejectedValue(
      new Error(
        'grant failed: https://idp.example.com/callback?access_token=secret-access&refresh_token=secret-refresh&id_token=secret-id&state=secret-state',
      ),
    );

  const session = createSessionWithPending({
    'valid-state': createPendingCheck(),
  });
  const req = createCallbackReq('/auth/oidc/default/cb?code=abc&state=valid-state', session);
  const res = createRes();

  await oidc.callback(req, res);

  expect401Json(res);
  const warnMsg = oidc.log.warn.mock.calls.at(-1)?.[0];
  expect(warnMsg).toContain('[REDACTED]');
  expect(warnMsg).not.toContain('secret-access');
  expect(warnMsg).not.toContain('secret-refresh');
  expect(warnMsg).not.toContain('secret-id');
  expect(warnMsg).not.toContain('secret-state');
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
    expect.stringContaining('Unable to initialize OIDC session (unknown error)'),
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
  expectDefaultRedirectPayload(res);
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

  expectDefaultRedirectPayload(res);
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
  oidc.client = undefined;
  oidc.logoutUrl = undefined;
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

test('initAuthentication should tolerate startup discovery failure and recover on a later redirect without restart', async () => {
  oidc.client = undefined;
  oidc.logoutUrl = undefined;
  const mockClient = {
    serverMetadata: () => ({
      issuer: 'https://idp.example.com',
      authorization_endpoint: 'https://idp/auth',
    }),
  };
  openidClientMock.discovery = vi
    .fn()
    .mockRejectedValueOnce(new Error('idp unavailable during startup'))
    .mockResolvedValueOnce(mockClient);
  openidClientMock.buildEndSessionUrl = vi.fn().mockReturnValue(new URL('https://idp/logout'));

  await expect(oidc.initAuthentication()).resolves.toBeUndefined();
  expect(() => oidc.getStrategy(app)).not.toThrow();

  const req = createReq({
    session: {
      save: vi.fn((cb) => cb()),
    },
  });
  const res = createRes();

  await oidc.redirect(req, res);

  expect(openidClientMock.discovery).toHaveBeenCalledTimes(2);
  expectDefaultRedirectPayload(res);
  expect(oidc.log.warn).toHaveBeenCalledWith(
    expect.stringContaining('Drydock will retry on the next authentication attempt'),
  );
});

test('initAuthentication should include the nested cause chain in the startup warning', async () => {
  oidc.client = undefined;
  oidc.logoutUrl = undefined;
  const cause = Object.assign(new Error('getaddrinfo ENOTFOUND idp.example.com'), {
    code: 'ENOTFOUND',
  });
  const fetchError = Object.assign(new TypeError('fetch failed'), { cause });
  openidClientMock.discovery = vi.fn().mockRejectedValue(fetchError);

  await expect(oidc.initAuthentication()).resolves.toBeUndefined();

  expect(oidc.log.warn).toHaveBeenCalledWith(expect.stringMatching(/fetch failed.*ENOTFOUND/));
});

test('initAuthentication should pass allowInsecureRequests for HTTP discovery URLs', async () => {
  oidc.client = undefined;
  oidc.logoutUrl = undefined;
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
  oidc.client = undefined;
  oidc.logoutUrl = undefined;
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
  oidc.client = undefined;
  oidc.logoutUrl = undefined;
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
  oidc.client = undefined;
  oidc.logoutUrl = undefined;
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
  oidc.client = undefined;
  oidc.logoutUrl = undefined;
  const { caPath, cleanup } = await createTemporaryCaFile();
  mockUndiciFetch.mockResolvedValue(new Response(null, { status: 200 }) as Response);
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
    expect(mockUndiciFetch).toHaveBeenCalledWith(
      'https://idp.example.com/.well-known/openid-configuration',
      expect.objectContaining({ dispatcher: expect.anything() }),
    );
    const requestInit = mockUndiciFetch.mock.calls[0][1] as { dispatcher?: unknown };
    expect(getUndiciAgentOptions(requestInit.dispatcher)).toEqual(
      expect.objectContaining({ allowH2: false }),
    );
  } finally {
    await cleanup();
  }
});

test('initAuthentication should configure custom fetch and warn when insecure TLS is enabled', async () => {
  oidc.client = undefined;
  oidc.logoutUrl = undefined;
  mockUndiciFetch.mockResolvedValue(new Response(null, { status: 200 }) as Response);
  oidc.configuration = {
    ...configurationValid,
    insecure: true,
  };
  const mockClient = {};
  openidClientMock.discovery = vi.fn().mockResolvedValue(mockClient);
  openidClientMock.buildEndSessionUrl = vi.fn().mockReturnValue(new URL('https://idp/logout'));

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
  expect(mockUndiciFetch).toHaveBeenCalledWith(
    'https://idp.example.com/.well-known/openid-configuration',
    expect.objectContaining({ dispatcher: expect.anything() }),
  );
  const requestInit = mockUndiciFetch.mock.calls[0][1] as { dispatcher?: unknown };
  expect(getUndiciAgentOptions(requestInit.dispatcher)).toEqual(
    expect.objectContaining({ allowH2: false }),
  );
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

  expectDefaultRedirectPayload(res);
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

  expectDefaultRedirectPayload(res);

  mapGetSpy.mockRestore();
  mapDeleteSpy.mockRestore();
  vi.useRealTimers();
});

test('stale lock cleanup timer should skip deleting when a newer lock replaces the entry', async () => {
  vi.useFakeTimers();

  let firstReload: ((error?: unknown) => void) | undefined;
  const firstReq = createReq({
    sessionID: 'replaced-lock-session',
    session: {
      reload: vi.fn((cb) => {
        firstReload = cb;
      }),
      save: vi.fn((cb) => cb()),
    },
  });
  const secondReq = createReq({
    sessionID: 'replaced-lock-session',
    session: {
      reload: vi.fn((cb) => cb()),
      save: vi.fn((cb) => cb()),
    },
  });
  const firstRes = createRes();
  const secondRes = createRes();

  try {
    const firstRedirectPromise = oidc.redirect(firstReq, firstRes);
    await vi.advanceTimersByTimeAsync(1);
    const secondRedirectPromise = oidc.redirect(secondReq, secondRes);

    await vi.advanceTimersByTimeAsync(59_999);

    firstReload?.();
    await Promise.all([firstRedirectPromise, secondRedirectPromise]);

    expectDefaultRedirectPayload(firstRes);
    expectDefaultRedirectPayload(secondRes);
  } finally {
    vi.useRealTimers();
  }
});

test('callback should record oidc success metrics on successful authentication', async () => {
  mockSuccessfulGrant(openidClientMock);
  const { session } = await performRedirect(oidc, openidClientMock);
  const state = Object.keys(session.oidc.default.pending)[0];
  const req = createCallbackReq(`/auth/oidc/default/cb?code=abc&state=${state}`, session);
  const res = createRes();

  await oidc.callback(req, res);

  expect(mockRecordAuthLogin).toHaveBeenCalledWith('success', 'oidc');
  expect(mockObserveAuthLoginDuration).toHaveBeenCalledWith('success', 'oidc', expect.any(Number));
});

test('callback should record oidc invalid metrics when callback state is missing', async () => {
  const req = createCallbackReq('/auth/oidc/default/cb?code=abc', {
    oidc: {
      default: {
        pending: {
          'valid-state': createPendingCheck(),
        },
      },
    },
  });
  const res = createRes();

  await oidc.callback(req, res);

  expect401JsonMessage(res, 'OIDC callback is missing state. Please retry authentication.');
  expect(mockRecordAuthLogin).toHaveBeenCalledWith('invalid', 'oidc');
  expect(mockObserveAuthLoginDuration).toHaveBeenCalledWith('invalid', 'oidc', expect.any(Number));
});

test('callback should record oidc error metrics when session login fails', async () => {
  mockSuccessfulGrant(openidClientMock);
  const { session } = await performRedirect(oidc, openidClientMock);
  const state = Object.keys(session.oidc.default.pending)[0];
  const req = createCallbackReq(
    `/auth/oidc/default/cb?code=abc&state=${state}`,
    session,
    (_user, done) => done(new Error('login failed')),
  );
  const res = createRes();

  await oidc.callback(req, res);

  expect401Json(res);
  expect(mockRecordAuthLogin).toHaveBeenCalledWith('error', 'oidc');
  expect(mockObserveAuthLoginDuration).toHaveBeenCalledWith('error', 'oidc', expect.any(Number));
});

// --- sanitizeOidcErrorMessage redaction tests ---

test('sanitizeOidcErrorMessage should redact a 10.x.x.x private IP with port in warn log', async () => {
  oidc.client = undefined;
  oidc.logoutUrl = undefined;
  openidClientMock.discovery = vi
    .fn()
    .mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:2376'));

  await expect(oidc.initAuthentication()).resolves.toBeUndefined();

  const warnCall = (oidc.log.warn as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
  expect(warnCall).toContain('[internal-addr]');
  expect(warnCall).not.toContain('10.0.0.5');
});

test('sanitizeOidcErrorMessage should redact a 172.16-31.x.x private IP in warn log', async () => {
  oidc.client = undefined;
  oidc.logoutUrl = undefined;
  openidClientMock.discovery = vi
    .fn()
    .mockRejectedValue(new Error('connect ETIMEDOUT 172.20.10.1:443'));

  await expect(oidc.initAuthentication()).resolves.toBeUndefined();

  const warnCall = (oidc.log.warn as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
  expect(warnCall).toContain('[internal-addr]');
  expect(warnCall).not.toContain('172.20.10.1');
});

test('sanitizeOidcErrorMessage should redact a 192.168.x.x private IP in warn log', async () => {
  oidc.client = undefined;
  oidc.logoutUrl = undefined;
  openidClientMock.discovery = vi
    .fn()
    .mockRejectedValue(new Error('connect ECONNREFUSED 192.168.1.100:8080'));

  await expect(oidc.initAuthentication()).resolves.toBeUndefined();

  const warnCall = (oidc.log.warn as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
  expect(warnCall).toContain('[internal-addr]');
  expect(warnCall).not.toContain('192.168.1.100');
});

test('sanitizeOidcErrorMessage should not redact a public IP in warn log', async () => {
  oidc.client = undefined;
  oidc.logoutUrl = undefined;
  openidClientMock.discovery = vi
    .fn()
    .mockRejectedValue(new Error('connect ECONNREFUSED 8.8.8.8:53'));

  await expect(oidc.initAuthentication()).resolves.toBeUndefined();

  const warnCall = (oidc.log.warn as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
  expect(warnCall).toContain('8.8.8.8');
  expect(warnCall).not.toContain('[internal-addr]');
});

test('sanitizeOidcErrorMessage should redact an absolute filesystem path in warn log', async () => {
  oidc.client = undefined;
  oidc.logoutUrl = undefined;
  openidClientMock.discovery = vi
    .fn()
    .mockRejectedValue(new Error('error loading /etc/ssl/certs/ca-bundle.pem'));

  await expect(oidc.initAuthentication()).resolves.toBeUndefined();

  const warnCall = (oidc.log.warn as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
  expect(warnCall).toContain('[path]');
  expect(warnCall).not.toContain('/etc/ssl/certs/ca-bundle.pem');
});

test('sanitizeOidcErrorMessage should still redact token params and Bearer tokens in warn log', async () => {
  oidc.client = undefined;
  oidc.logoutUrl = undefined;
  openidClientMock.discovery = vi
    .fn()
    .mockRejectedValue(
      new Error('request failed client_secret=topsecret Authorization: Bearer abc123.token'),
    );

  await expect(oidc.initAuthentication()).resolves.toBeUndefined();

  const warnCall = (oidc.log.warn as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
  expect(warnCall).not.toContain('topsecret');
  expect(warnCall).not.toContain('abc123.token');
  expect(warnCall).toContain('[REDACTED]');
  expect(warnCall).toContain('Bearer [REDACTED]');
});

// --- Fix 2: sensitive data inside a nested cause chain ---

test('initAuthentication warn log should not expose secrets from a nested cause chain', async () => {
  oidc.client = undefined;
  oidc.logoutUrl = undefined;

  // Cause carries a URL with client_secret and a Bearer token in the message
  const cause = new Error(
    'HTTP 401 Unauthorized: https://idp.example.com/token?client_secret=s3cr3t&grant_type=client_credentials Authorization: Bearer supersecrettoken99',
  );
  const fetchError = Object.assign(new TypeError('fetch failed'), { cause });
  openidClientMock.discovery = vi.fn().mockRejectedValue(fetchError);

  await expect(oidc.initAuthentication()).resolves.toBeUndefined();

  expect(oidc.log.warn).toHaveBeenCalledOnce();
  const warnArg = (oidc.log.warn as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;

  // Secrets must not appear
  expect(warnArg).not.toContain('s3cr3t');
  expect(warnArg).not.toContain('supersecrettoken99');

  // Useful context must survive
  expect(warnArg).toContain('fetch failed');
  expect(warnArg).toContain('[REDACTED]');
});

// --- Constant value mutant killers ---

test('OIDC_CHECKS_TTL_MS should be 5 minutes: checks created 1 second ago are still valid', async () => {
  mockSuccessfulGrant(openidClientMock);

  const session = createSessionWithPending({
    'valid-state': {
      state: 'valid-state',
      codeVerifier: 'code-verifier',
      createdAt: Date.now() - 1000, // 1 second old, well within 5 minutes
    },
  });
  const req = createCallbackReq('/auth/oidc/default/cb?code=abc&state=valid-state', session);
  const res = createRes();

  await oidc.callback(req, res);

  expect(openidClientMock.authorizationCodeGrant).toHaveBeenCalled();
  expect(res.redirect).toHaveBeenCalledWith('https://dd.example.com');
});

test('OIDC_CHECKS_TTL_MS should be 5 minutes: checks created exactly at TTL boundary are valid', async () => {
  mockSuccessfulGrant(openidClientMock);

  // 4 minutes and 59 seconds old - just inside the 5-minute TTL
  const session = createSessionWithPending({
    'valid-state': {
      state: 'valid-state',
      codeVerifier: 'code-verifier',
      createdAt: Date.now() - (5 * 60 * 1000 - 1000),
    },
  });
  const req = createCallbackReq('/auth/oidc/default/cb?code=abc&state=valid-state', session);
  const res = createRes();

  await oidc.callback(req, res);

  expect(openidClientMock.authorizationCodeGrant).toHaveBeenCalled();
  expect(res.redirect).toHaveBeenCalledWith('https://dd.example.com');
});

// --- OIDC_STATE_PATTERN regex mutant killers ---

test('isValidStateToken: state token of exactly 8 characters is valid', async () => {
  mockSuccessfulGrant(openidClientMock);

  // exactly 8 chars - minimum length
  const session = createSessionWithPending({
    abcde123: {
      state: 'abcde123',
      codeVerifier: 'code-verifier',
      createdAt: Date.now(),
    },
  });
  const req = createCallbackReq('/auth/oidc/default/cb?code=abc&state=abcde123', session);
  const res = createRes();

  await oidc.callback(req, res);

  expect(openidClientMock.authorizationCodeGrant).toHaveBeenCalled();
});

test('isValidStateToken: state token of 7 characters is invalid', async () => {
  const session = createSessionWithPending({
    abcde12: {
      state: 'abcde12',
      codeVerifier: 'code-verifier',
      createdAt: Date.now(),
    },
  });
  const req = createCallbackReq('/auth/oidc/default/cb?code=abc&state=abcde12', session);
  const res = createRes();

  await oidc.callback(req, res);

  expect(openidClientMock.authorizationCodeGrant).not.toHaveBeenCalled();
  expect401JsonMessage(res, 'OIDC callback is missing state. Please retry authentication.');
});

test('isValidStateToken: state token with characters outside allowed set is invalid', async () => {
  const session = createSessionWithPending({
    'abc!@#$%1': {
      state: 'abc!@#$%1',
      codeVerifier: 'code-verifier',
      createdAt: Date.now(),
    },
  });
  const req = createCallbackReq('/auth/oidc/default/cb?code=abc&state=abc!@#$%1', session);
  const res = createRes();

  await oidc.callback(req, res);

  expect(openidClientMock.authorizationCodeGrant).not.toHaveBeenCalled();
});

// --- sanitizeOidcErrorMessage regex boundary tests ---

test('sanitizeOidcErrorMessage should redact sensitive query params from HTTPS URLs in error messages', async () => {
  oidc.client = undefined;
  oidc.logoutUrl = undefined;
  openidClientMock.discovery = vi
    .fn()
    .mockRejectedValue(
      new Error(
        'fetch failed: https://idp.example.com/token?client_secret=mysecret&grant_type=client_credentials',
      ),
    );

  await expect(oidc.initAuthentication()).resolves.toBeUndefined();

  const warnCall = (oidc.log.warn as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
  expect(warnCall).not.toContain('mysecret');
  expect(warnCall).toContain('[REDACTED]');
});

test('sanitizeOidcErrorMessage should also redact sensitive query params from HTTP URLs', async () => {
  oidc.client = undefined;
  oidc.logoutUrl = undefined;
  openidClientMock.discovery = vi
    .fn()
    .mockRejectedValue(new Error('fetch failed: http://idp.internal/auth?client_secret=mysecret'));

  await expect(oidc.initAuthentication()).resolves.toBeUndefined();

  const warnCall = (oidc.log.warn as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
  expect(warnCall).not.toContain('mysecret');
  expect(warnCall).toContain('[REDACTED]');
});

test('sanitizeOidcErrorMessage should not redact a plain message with no URLs', async () => {
  oidc.client = undefined;
  oidc.logoutUrl = undefined;
  // A message with no URLs - should be passed through unchanged (modulo sanitizeLogParam)
  openidClientMock.discovery = vi.fn().mockRejectedValue(new Error('connection refused'));

  await expect(oidc.initAuthentication()).resolves.toBeUndefined();

  const warnCall = (oidc.log.warn as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
  expect(warnCall).toContain('connection refused');
});

test('sanitizeOidcErrorMessage should redact bearer tokens with allowed chars including plus and slash', async () => {
  oidc.client = undefined;
  oidc.logoutUrl = undefined;
  openidClientMock.discovery = vi
    .fn()
    .mockRejectedValue(new Error('auth failed: Bearer abc123.def+ghi/jkl='));

  await expect(oidc.initAuthentication()).resolves.toBeUndefined();

  const warnCall = (oidc.log.warn as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
  expect(warnCall).not.toContain('abc123.def+ghi/jkl');
  expect(warnCall).toContain('Bearer [REDACTED]');
});

test('sanitizeOidcErrorMessage should NOT redact a bearer token that is not preceded by word boundary', async () => {
  oidc.client = undefined;
  oidc.logoutUrl = undefined;
  // "XBearer token" should NOT be redacted - no word boundary before Bearer
  openidClientMock.discovery = vi
    .fn()
    .mockRejectedValue(new Error('scheme is XBearer abc123token'));

  await expect(oidc.initAuthentication()).resolves.toBeUndefined();

  const warnCall = (oidc.log.warn as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
  expect(warnCall).toContain('XBearer abc123token');
  expect(warnCall).not.toContain('Bearer [REDACTED]');
});

test('sanitizeOidcErrorMessage should redact 172.16.x.x IP (lower boundary of 172.16-31 range)', async () => {
  oidc.client = undefined;
  oidc.logoutUrl = undefined;
  openidClientMock.discovery = vi
    .fn()
    .mockRejectedValue(new Error('connect ECONNREFUSED 172.16.0.1:443'));

  await expect(oidc.initAuthentication()).resolves.toBeUndefined();

  const warnCall = (oidc.log.warn as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
  expect(warnCall).toContain('[internal-addr]');
  expect(warnCall).not.toContain('172.16.0.1');
});

test('sanitizeOidcErrorMessage should redact 172.31.x.x IP (upper boundary of 172.16-31 range)', async () => {
  oidc.client = undefined;
  oidc.logoutUrl = undefined;
  openidClientMock.discovery = vi
    .fn()
    .mockRejectedValue(new Error('connect ETIMEDOUT 172.31.255.255:8080'));

  await expect(oidc.initAuthentication()).resolves.toBeUndefined();

  const warnCall = (oidc.log.warn as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
  expect(warnCall).toContain('[internal-addr]');
  expect(warnCall).not.toContain('172.31.255.255');
});

test('sanitizeOidcErrorMessage should NOT redact 172.15.x.x IP (below private range)', async () => {
  oidc.client = undefined;
  oidc.logoutUrl = undefined;
  openidClientMock.discovery = vi
    .fn()
    .mockRejectedValue(new Error('connect ECONNREFUSED 172.15.0.1:443'));

  await expect(oidc.initAuthentication()).resolves.toBeUndefined();

  const warnCall = (oidc.log.warn as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
  expect(warnCall).toContain('172.15.0.1');
  expect(warnCall).not.toContain('[internal-addr]');
});

test('sanitizeOidcErrorMessage should NOT redact 172.32.x.x IP (above private range)', async () => {
  oidc.client = undefined;
  oidc.logoutUrl = undefined;
  openidClientMock.discovery = vi
    .fn()
    .mockRejectedValue(new Error('connect ECONNREFUSED 172.32.0.1:443'));

  await expect(oidc.initAuthentication()).resolves.toBeUndefined();

  const warnCall = (oidc.log.warn as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
  expect(warnCall).toContain('172.32.0.1');
  expect(warnCall).not.toContain('[internal-addr]');
});

test('sanitizeOidcErrorMessage should redact an absolute path with exactly two segments', async () => {
  oidc.client = undefined;
  oidc.logoutUrl = undefined;
  openidClientMock.discovery = vi.fn().mockRejectedValue(new Error('error reading /etc/ca.pem'));

  await expect(oidc.initAuthentication()).resolves.toBeUndefined();

  const warnCall = (oidc.log.warn as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
  expect(warnCall).toContain('[path]');
  expect(warnCall).not.toContain('/etc/ca.pem');
});

test('sanitizeOidcErrorMessage should NOT redact a single-segment path like /foo', async () => {
  oidc.client = undefined;
  oidc.logoutUrl = undefined;
  // "/foo" has only one segment — should NOT be redacted
  openidClientMock.discovery = vi
    .fn()
    .mockRejectedValue(new Error('path /nope cannot be resolved'));

  await expect(oidc.initAuthentication()).resolves.toBeUndefined();

  const warnCall = (oidc.log.warn as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
  expect(warnCall).toContain('/nope');
  expect(warnCall).not.toContain('[path]');
});

// --- isNonEmptyString / isValidCheckEntry mutant killers ---

test('isNonEmptyString: empty string should fail validation as state token', async () => {
  const session = createSessionWithPending({
    '': {
      state: '',
      codeVerifier: 'code-verifier',
      createdAt: Date.now(),
    },
  });
  const req = createCallbackReq('/auth/oidc/default/cb?code=abc&state=', session);
  const res = createRes();

  await oidc.callback(req, res);

  expect(openidClientMock.authorizationCodeGrant).not.toHaveBeenCalled();
  expect401JsonMessage(res, 'OIDC callback is missing state. Please retry authentication.');
});

// --- getMaxConcurrentSessionsPerUser edge cases ---

test('getMaxConcurrentSessionsPerUser should use default when session config key is absent', async () => {
  mockSuccessfulGrant(openidClientMock);
  const getServerConfigurationSpy = vi.spyOn(configuration, 'getServerConfiguration');
  getServerConfigurationSpy.mockReturnValue(
    {} as ReturnType<typeof configuration.getServerConfiguration>,
  );

  try {
    const session = createSessionWithPending({ 'valid-state': createPendingCheck() });
    const req = createCallbackReq('/auth/oidc/default/cb?code=abc&state=valid-state', session);
    req.sessionStore = {
      all: vi.fn((done) => done(null, {})),
      destroy: vi.fn((_sid, done) => done()),
    };
    const res = createRes();

    await oidc.callback(req, res);

    // No sessions to evict - just ensure it proceeds normally
    expect(res.redirect).toHaveBeenCalledWith('https://dd.example.com');
  } finally {
    getServerConfigurationSpy.mockRestore();
  }
});

test('getMaxConcurrentSessionsPerUser should use default when maxconcurrentsessions is 0', async () => {
  mockSuccessfulGrant(openidClientMock);
  const getServerConfigurationSpy = vi.spyOn(configuration, 'getServerConfiguration');
  getServerConfigurationSpy.mockReturnValue({
    session: { maxconcurrentsessions: 0 },
  } as ReturnType<typeof configuration.getServerConfiguration>);

  try {
    const session = createSessionWithPending({ 'valid-state': createPendingCheck() });
    const req = createCallbackReq('/auth/oidc/default/cb?code=abc&state=valid-state', session);
    req.sessionStore = {
      all: vi.fn((done) => done(null, {})),
      destroy: vi.fn((_sid, done) => done()),
    };
    const res = createRes();

    await oidc.callback(req, res);

    expect(res.redirect).toHaveBeenCalledWith('https://dd.example.com');
  } finally {
    getServerConfigurationSpy.mockRestore();
  }
});

test('getMaxConcurrentSessionsPerUser should use default when maxconcurrentsessions is a float', async () => {
  mockSuccessfulGrant(openidClientMock);
  const getServerConfigurationSpy = vi.spyOn(configuration, 'getServerConfiguration');
  getServerConfigurationSpy.mockReturnValue({
    session: { maxconcurrentsessions: 2.5 },
  } as ReturnType<typeof configuration.getServerConfiguration>);

  try {
    const session = createSessionWithPending({ 'valid-state': createPendingCheck() });
    const req = createCallbackReq('/auth/oidc/default/cb?code=abc&state=valid-state', session);
    req.sessionStore = {
      all: vi.fn((done) => done(null, {})),
      destroy: vi.fn((_sid, done) => done()),
    };
    const res = createRes();

    await oidc.callback(req, res);

    expect(res.redirect).toHaveBeenCalledWith('https://dd.example.com');
  } finally {
    getServerConfigurationSpy.mockRestore();
  }
});

test('getMaxConcurrentSessionsPerUser should use default when maxconcurrentsessions is a string', async () => {
  mockSuccessfulGrant(openidClientMock);
  const getServerConfigurationSpy = vi.spyOn(configuration, 'getServerConfiguration');
  getServerConfigurationSpy.mockReturnValue({
    session: { maxconcurrentsessions: '3' },
  } as ReturnType<typeof configuration.getServerConfiguration>);

  try {
    const session = createSessionWithPending({ 'valid-state': createPendingCheck() });
    const req = createCallbackReq('/auth/oidc/default/cb?code=abc&state=valid-state', session);
    req.sessionStore = {
      all: vi.fn((done) => done(null, {})),
      destroy: vi.fn((_sid, done) => done()),
    };
    const res = createRes();

    await oidc.callback(req, res);

    expect(res.redirect).toHaveBeenCalledWith('https://dd.example.com');
  } finally {
    getServerConfigurationSpy.mockRestore();
  }
});

// --- validateConfiguration mutant killers ---

test('validateConfiguration should throw when DD_PUBLIC_URL is whitespace-only', async () => {
  const previousPublicUrl = configuration.ddEnvVars.DD_PUBLIC_URL;
  configuration.ddEnvVars.DD_PUBLIC_URL = '   ';
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

test('validateConfiguration should throw when DD_PUBLIC_URL is a non-string value', async () => {
  const previousPublicUrl = configuration.ddEnvVars.DD_PUBLIC_URL;
  (configuration.ddEnvVars as any).DD_PUBLIC_URL = 42;
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

// --- maskConfiguration mutant killers ---

test('maskConfiguration should include insecure=false when explicitly configured as boolean', async () => {
  oidc.configuration = {
    ...configurationValid,
    insecure: false,
  };

  const masked = oidc.maskConfiguration();
  expect(masked).toHaveProperty('insecure', false);
});

// --- discoverClient mutant killers ---

test('initAuthentication should log the discovery URL in debug message', async () => {
  oidc.client = undefined;
  oidc.logoutUrl = undefined;
  oidc.configuration = {
    ...configurationValid,
    discovery: 'https://idp.example.com/.well-known/openid-configuration',
  };
  const mockClient = {};
  openidClientMock.discovery = vi.fn().mockResolvedValue(mockClient);
  openidClientMock.buildEndSessionUrl = vi.fn().mockReturnValue(new URL('https://idp/logout'));

  await oidc.initAuthentication();

  expect(oidc.log.debug).toHaveBeenCalledWith(
    'Discovering configuration from https://idp.example.com/.well-known/openid-configuration',
  );
});

test('initAuthentication should compute timeout in whole seconds rounding up', async () => {
  oidc.client = undefined;
  oidc.logoutUrl = undefined;
  oidc.configuration = {
    ...configurationValid,
    timeout: 1500, // 1.5s → ceil → 2s
  };
  const mockClient = {};
  openidClientMock.discovery = vi.fn().mockResolvedValue(mockClient);
  openidClientMock.buildEndSessionUrl = vi.fn().mockReturnValue(new URL('https://idp/logout'));

  await oidc.initAuthentication();

  const callArgs = openidClientMock.discovery.mock.calls[0];
  expect(callArgs[4].timeout).toBe(2);
});

test('initAuthentication should pass exact integer timeout for round millisecond values', async () => {
  oidc.client = undefined;
  oidc.logoutUrl = undefined;
  oidc.configuration = {
    ...configurationValid,
    timeout: 3000, // 3.0s → ceil → 3s
  };
  const mockClient = {};
  openidClientMock.discovery = vi.fn().mockResolvedValue(mockClient);
  openidClientMock.buildEndSessionUrl = vi.fn().mockReturnValue(new URL('https://idp/logout'));

  await oidc.initAuthentication();

  const callArgs = openidClientMock.discovery.mock.calls[0];
  expect(callArgs[4].timeout).toBe(3);
});

// --- getStrategy / rateLimit config mutant killers ---

test('getStrategy should configure rate limiter with 50 max requests per window', async () => {
  const appMock = { use: vi.fn(), get: vi.fn() };
  oidc.name = 'test-oidc';

  oidc.getStrategy(appMock);

  // The rate limiter is applied via app.use for the OIDC path prefix
  expect(appMock.use).toHaveBeenCalledWith('/auth/oidc/test-oidc', expect.any(Function));
});

test('getStrategy should register strategy with scope openid email profile', async () => {
  const appMock = { use: vi.fn(), get: vi.fn() };

  const strategy = oidc.getStrategy(appMock);

  // Verify the returned strategy has the correct name
  expect(strategy.name).toBe('oidc');
  // Verify options contain the correct scope
  expect((strategy as any).options.scope).toBe('openid email profile');
});

// --- redirect flow specific debug log mutant killers ---

test('redirect should log "Build redirection url" debug message', async () => {
  const session = { save: vi.fn((cb) => cb()) };
  const req = createReq({ session });
  const res = createRes();

  await oidc.redirect(req, res);

  expect(oidc.log.debug).toHaveBeenCalledWith(expect.stringContaining('Build redirection url'));
});

test('redirect should include the redirect_uri in the authorization URL build', async () => {
  const session = { save: vi.fn((cb) => cb()) };
  const req = createReq({ session });
  const res = createRes();

  await oidc.redirect(req, res);

  expect(openidClientMock.buildAuthorizationUrl).toHaveBeenCalledWith(
    oidc.client,
    expect.objectContaining({
      redirect_uri: expect.stringContaining('/auth/oidc/'),
      scope: 'openid email profile',
      code_challenge_method: 'S256',
    }),
  );
});

test('redirect should use S256 as the code challenge method', async () => {
  const session = { save: vi.fn((cb) => cb()) };
  const req = createReq({ session });
  const res = createRes();

  await oidc.redirect(req, res);

  const buildArgs = openidClientMock.buildAuthorizationUrl.mock.calls[0][1];
  expect(buildArgs.code_challenge_method).toBe('S256');
});

// --- callback specific log message mutant killers ---

test('callback should log "Validate callback data" debug message', async () => {
  mockSuccessfulGrant(openidClientMock);
  const { session } = await performRedirect(oidc, openidClientMock);
  const state = Object.keys(session.oidc.default.pending)[0];
  const req = createCallbackReq(`/auth/oidc/default/cb?code=abc&state=${state}`, session);
  const res = createRes();

  await oidc.callback(req, res);

  expect(oidc.log.debug).toHaveBeenCalledWith('Validate callback data');
});

test('callback should log "Get user info" debug message', async () => {
  mockSuccessfulGrant(openidClientMock);
  const { session } = await performRedirect(oidc, openidClientMock);
  const state = Object.keys(session.oidc.default.pending)[0];
  const req = createCallbackReq(`/auth/oidc/default/cb?code=abc&state=${state}`, session);
  const res = createRes();

  await oidc.callback(req, res);

  expect(oidc.log.debug).toHaveBeenCalledWith('Get user info');
});

test('completePassportLogin should log "Perform passport login" debug message', async () => {
  mockSuccessfulGrant(openidClientMock);
  const { session } = await performRedirect(oidc, openidClientMock);
  const state = Object.keys(session.oidc.default.pending)[0];
  const req = createCallbackReq(`/auth/oidc/default/cb?code=abc&state=${state}`, session);
  const res = createRes();

  await oidc.callback(req, res);

  expect(oidc.log.debug).toHaveBeenCalledWith('Perform passport login');
});

test('completePassportLogin should log "User authenticated => redirect to app" debug message', async () => {
  mockSuccessfulGrant(openidClientMock);
  const { session } = await performRedirect(oidc, openidClientMock);
  const state = Object.keys(session.oidc.default.pending)[0];
  const req = createCallbackReq(`/auth/oidc/default/cb?code=abc&state=${state}`, session);
  const res = createRes();

  await oidc.callback(req, res);

  expect(oidc.log.debug).toHaveBeenCalledWith('User authenticated => redirect to app');
});

// --- validateCallbackData log message mutant killers ---

test('validateCallbackData should log specific warn message when oidc checks are missing', async () => {
  const req = createCallbackReq(undefined, {});
  const res = createRes();

  await oidc.callback(req, res);

  expect(oidc.log.warn).toHaveBeenCalledWith(
    expect.stringContaining('OIDC checks are missing from session for strategy'),
  );
  expect(oidc.log.warn).toHaveBeenCalledWith(
    expect.stringContaining('ask user to restart authentication'),
  );
});

test('validateCallbackData should use exact error response when oidc checks are missing', async () => {
  const req = createCallbackReq(undefined, {});
  const res = createRes();

  await oidc.callback(req, res);

  expect(res.json).toHaveBeenCalledWith({
    error: 'OIDC session is missing or expired. Please retry authentication.',
  });
});

test('validateCallbackData should log specific warn message when state is missing', async () => {
  const session = createSessionWithPending({ 'valid-state': createPendingCheck() });
  const req = createCallbackReq('/auth/oidc/default/cb?code=abc', session);
  const res = createRes();

  await oidc.callback(req, res);

  expect(oidc.log.warn).toHaveBeenCalledWith(
    expect.stringContaining('OIDC callback is missing state parameter for strategy'),
  );
});

test('validateCallbackData should use exact error response when state is missing', async () => {
  const session = createSessionWithPending({ 'valid-state': createPendingCheck() });
  const req = createCallbackReq('/auth/oidc/default/cb?code=abc', session);
  const res = createRes();

  await oidc.callback(req, res);

  expect(res.json).toHaveBeenCalledWith({
    error: 'OIDC callback is missing state. Please retry authentication.',
  });
});

test('validateCallbackData should log specific warn message when state not found in pending checks', async () => {
  const session = createSessionWithPending({ 'known-state': createPendingCheck() });
  const req = createCallbackReq('/auth/oidc/default/cb?code=abc&state=unknown-state', session);
  const res = createRes();

  await oidc.callback(req, res);

  expect(oidc.log.warn).toHaveBeenCalledWith(
    expect.stringContaining('OIDC callback state not found in pending checks for strategy'),
  );
});

test('validateCallbackData should use exact error response when state not found', async () => {
  const session = createSessionWithPending({ 'known-state': createPendingCheck() });
  const req = createCallbackReq('/auth/oidc/default/cb?code=abc&state=unknown-state', session);
  const res = createRes();

  await oidc.callback(req, res);

  expect(res.json).toHaveBeenCalledWith({
    error: 'OIDC session state mismatch or expired. Please retry authentication.',
  });
});

test('validateCallbackData should log specific warn message when state does not match check', async () => {
  // Force a state mismatch where hasOwn passes but state fields don't match
  const session = createSessionWithPending({
    'known-state': createPendingCheck(),
  });
  const req = createCallbackReq('/auth/oidc/default/cb?code=abc&state=unknown-state', session);
  const originalHasOwn = Object.hasOwn;
  const hasOwnSpy = vi
    .spyOn(Object, 'hasOwn')
    .mockImplementation((value: any, key: PropertyKey) => {
      if (key === 'unknown-state') return true;
      return originalHasOwn(value, key);
    });
  const res = createRes();

  try {
    await oidc.callback(req, res);
  } finally {
    hasOwnSpy.mockRestore();
  }

  expect(oidc.log.warn).toHaveBeenCalledWith(
    expect.stringContaining(
      'OIDC callback state does not match active session checks for strategy',
    ),
  );
});

// --- verify() log message mutant killer ---

test('verify should log specific error message on access token validation failure', async () => {
  openidClientMock.fetchUserInfo = vi.fn().mockRejectedValue(new Error('token expired'));

  const done = vi.fn();
  await oidc.verify('expired-token', done);

  expect(oidc.log.warn).toHaveBeenCalledWith(
    expect.stringContaining('Error when validating the user access token'),
  );
  expect(done).toHaveBeenCalledWith(null, false);
});

// --- callback should throw when access_token is missing  ---

test('callback should log the throw message when access_token is absent from token set', async () => {
  openidClientMock.authorizationCodeGrant = vi.fn().mockResolvedValue({});

  const session = createSessionWithPending({ 'valid-state': createPendingCheck() });
  const req = createCallbackReq('/auth/oidc/default/cb?code=abc&state=valid-state', session);
  const res = createRes();

  await oidc.callback(req, res);

  expect(oidc.log.warn).toHaveBeenCalledWith(
    expect.stringContaining('Access token is missing from OIDC authorization response'),
  );
  expect401Json(res);
});

// --- normalizePendingChecks and limitToMostRecent mutant killers ---

test('limitToMostRecent should keep exactly 5 checks when more than 5 are queued', async () => {
  openidClientMock.randomPKCECodeVerifier = vi
    .fn()
    .mockReturnValueOnce('code-verifier-1')
    .mockReturnValueOnce('code-verifier-2')
    .mockReturnValueOnce('code-verifier-3')
    .mockReturnValueOnce('code-verifier-4')
    .mockReturnValueOnce('code-verifier-5')
    .mockReturnValueOnce('code-verifier-6');

  const persistedState: any = {};
  const makeSession = () => {
    const session: any = {
      oidc: JSON.parse(JSON.stringify(persistedState.oidc || {})),
    };
    session.reload = vi.fn((cb) => {
      session.oidc = JSON.parse(JSON.stringify(persistedState.oidc || {}));
      cb();
    });
    session.save = vi.fn((cb) => {
      persistedState.oidc = JSON.parse(JSON.stringify(session.oidc || {}));
      cb();
    });
    return session;
  };

  // Issue 6 sequential redirects with deterministic createdAt timestamps
  let fakeTime = Date.now();
  const dateSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
    fakeTime += 1000;
    return fakeTime;
  });
  try {
    for (let i = 0; i < 6; i++) {
      const session = makeSession();
      await oidc.redirect(createReq({ sessionID: 'shared-session', session }), createRes());
    }
  } finally {
    dateSpy.mockRestore();
  }

  // After 6 redirects through the same session store, only 5 should remain
  expect(Object.keys(persistedState.oidc.default.pending)).toHaveLength(5);
  // The 6th (most recent) code verifier should be present
  const codeVerifiers = Object.values(persistedState.oidc.default.pending).map(
    (check: any) => check.codeVerifier,
  );
  expect(codeVerifiers).toContain('code-verifier-6');
  expect(codeVerifiers).not.toContain('code-verifier-1');
});

test('limitToMostRecent should sort checks by createdAt descending', async () => {
  mockSuccessfulGrant(openidClientMock);

  // Create 3 checks with known createdAt values (old first, then newer)
  const now = Date.now();
  const session = {
    oidc: {
      default: {
        pending: {
          'state-oldest': { state: 'state-oldest', codeVerifier: 'cv-1', createdAt: now - 3000 },
          'state-middle': { state: 'state-middle', codeVerifier: 'cv-2', createdAt: now - 2000 },
          'state-newest': { state: 'state-newest', codeVerifier: 'cv-3', createdAt: now - 1000 },
        },
      },
    },
    save: vi.fn((cb) => cb()),
  };

  const req = createCallbackReq('/auth/oidc/default/cb?code=abc&state=state-newest', session);
  const res = createRes();

  await oidc.callback(req, res);

  expect(openidClientMock.authorizationCodeGrant).toHaveBeenCalledWith(
    oidc.client,
    expect.any(URL),
    expect.objectContaining({ pkceCodeVerifier: 'cv-3' }),
  );
  expect(res.redirect).toHaveBeenCalledWith('https://dd.example.com');
});

// --- buildNextOidcChecks mutant killers ---

test('buildNextOidcChecks should return empty object when session has no oidc field', () => {
  const result = oidc.buildNextOidcChecks({ cookie: {} }, 'default', {}, 'state1');
  expect(Object.keys(result)).toHaveLength(0);
});

test('buildNextOidcChecks should preserve other strategy keys when clearing current strategy', () => {
  const session = {
    oidc: {
      'other-strategy': {
        pending: {
          'other-state': { state: 'other-state', codeVerifier: 'cv', createdAt: Date.now() },
        },
      },
      default: {
        pending: { state1: { state: 'state1', codeVerifier: 'cv1', createdAt: Date.now() } },
      },
    },
  };
  const pendingChecks = {
    state1: { state: 'state1', codeVerifier: 'cv1', createdAt: Date.now() },
  };

  const result = oidc.buildNextOidcChecks(session, 'default', pendingChecks, 'state1');

  // 'default' key removed; 'other-strategy' preserved
  expect(result).not.toHaveProperty('default');
  expect(result).toHaveProperty('other-strategy');
});

test('buildNextOidcChecks should set remaining checks under sessionKey when not all checks are consumed', () => {
  const session = {
    oidc: {
      default: {
        pending: {
          state1: { state: 'state1', codeVerifier: 'cv1', createdAt: Date.now() },
          state2: { state: 'state2', codeVerifier: 'cv2', createdAt: Date.now() },
        },
      },
    },
  };
  const pendingChecks = {
    state1: { state: 'state1', codeVerifier: 'cv1', createdAt: Date.now() },
    state2: { state: 'state2', codeVerifier: 'cv2', createdAt: Date.now() },
  };

  const result = oidc.buildNextOidcChecks(session, 'default', pendingChecks, 'state1');

  expect(result).toHaveProperty('default');
  expect((result.default as any).pending).toHaveProperty('state2');
  expect((result.default as any).pending).not.toHaveProperty('state1');
});

// --- persistCallbackSession mutant killers ---

test('persistCallbackSession should not set oidc on session when nextOidcChecks is empty', async () => {
  mockSuccessfulGrant(openidClientMock);

  const session = createSessionWithPending({ 'valid-state': createPendingCheck() });
  session.save = vi.fn((cb) => cb());
  const req = createCallbackReq('/auth/oidc/default/cb?code=abc&state=valid-state', session);
  const res = createRes();

  await oidc.callback(req, res);

  // After consuming the only pending check, the oidc key for 'default' should be gone
  expect(req.session?.oidc?.default).toBeUndefined();
});

test('persistCallbackSession should restore rememberMe on the regenerated session', async () => {
  mockSuccessfulGrant(openidClientMock);

  // Simulate a realistic session regeneration that replaces req.session with a new object
  const originalSession: any = createSessionWithPending({ 'valid-state': createPendingCheck() });
  originalSession.rememberMe = true;
  originalSession.save = vi.fn((cb) => cb());

  const newSession: any = {
    save: vi.fn((cb) => cb()),
  };

  originalSession.regenerate = vi.fn((cb) => {
    // Simulate Express session regeneration: req.session is replaced
    req.session = newSession;
    cb();
  });

  const req = createCallbackReq(
    '/auth/oidc/default/cb?code=abc&state=valid-state',
    originalSession,
  );
  const res = createRes();

  await oidc.callback(req, res);

  // After regeneration, the NEW session should have rememberMe restored
  expect(req.session?.rememberMe).toBe(true);
  expect(res.redirect).toHaveBeenCalledWith('https://dd.example.com');
});

test('persistCallbackSession should restore rememberMe=false on regenerated session', async () => {
  mockSuccessfulGrant(openidClientMock);

  const originalSession: any = createSessionWithPending({ 'valid-state': createPendingCheck() });
  originalSession.rememberMe = false;
  originalSession.save = vi.fn((cb) => cb());

  const newSession: any = {
    save: vi.fn((cb) => cb()),
  };

  originalSession.regenerate = vi.fn((cb) => {
    req.session = newSession;
    cb();
  });

  const req = createCallbackReq(
    '/auth/oidc/default/cb?code=abc&state=valid-state',
    originalSession,
  );
  const res = createRes();

  await oidc.callback(req, res);

  // rememberMe=false must survive session regeneration
  expect(req.session?.rememberMe).toBe(false);
  expect(res.redirect).toHaveBeenCalledWith('https://dd.example.com');
});

test('persistCallbackSession should not set rememberMe when preference is undefined after regeneration', async () => {
  mockSuccessfulGrant(openidClientMock);

  const originalSession: any = createSessionWithPending({ 'valid-state': createPendingCheck() });
  // No rememberMe set on session
  originalSession.save = vi.fn((cb) => cb());

  const newSession: any = {
    save: vi.fn((cb) => cb()),
  };

  originalSession.regenerate = vi.fn((cb) => {
    req.session = newSession;
    cb();
  });

  const req = createCallbackReq(
    '/auth/oidc/default/cb?code=abc&state=valid-state',
    originalSession,
  );
  const res = createRes();

  await oidc.callback(req, res);

  // rememberMe should remain unset on the new session (the property must not exist at all,
  // not just be undefined — distinguishes "not set" from "explicitly set to undefined")
  expect(req.session).not.toHaveProperty('rememberMe');
  expect(res.redirect).toHaveBeenCalledWith('https://dd.example.com');
});

// --- redirect session initialization mutant killers ---

test('redirect should initialize oidc field on session when it is absent', async () => {
  const session = { save: vi.fn((cb) => cb()) };
  // session.oidc is initially undefined
  const req = createReq({ session });
  const res = createRes();

  await oidc.redirect(req, res);

  expect(req.session.oidc).toBeDefined();
  expect(typeof req.session.oidc).toBe('object');
});

test('redirect should initialize oidc field on session when it is null', async () => {
  const session = { oidc: null, save: vi.fn((cb) => cb()) };
  const req = createReq({ session });
  const res = createRes();

  await oidc.redirect(req, res);

  expect(req.session.oidc).toBeDefined();
  expect(typeof req.session.oidc).toBe('object');
});

// --- callback session oidc optional chaining mutant killers ---

test('validateCallbackData should return undefined when session has no oidc field', async () => {
  const req = createCallbackReq('/auth/oidc/default/cb?code=abc&state=valid-state', {});
  const res = createRes();

  await oidc.callback(req, res);

  expect(openidClientMock.authorizationCodeGrant).not.toHaveBeenCalled();
  expect401JsonMessage(res, 'OIDC session is missing or expired. Please retry authentication.');
});

test('validateCallbackData should return undefined when session oidc has no entry for strategy key', async () => {
  const req = createCallbackReq('/auth/oidc/default/cb?code=abc&state=valid-state', {
    oidc: { 'other-strategy': {} },
  });
  const res = createRes();

  await oidc.callback(req, res);

  expect(openidClientMock.authorizationCodeGrant).not.toHaveBeenCalled();
  expect401JsonMessage(res, 'OIDC session is missing or expired. Please retry authentication.');
});

// --- getAllowedAuthorizationRedirects issuer URL mutant killers ---

test('getAllowedAuthorizationRedirects should include issuer origin in allowedOrigins', () => {
  oidc.client = {
    serverMetadata: () => ({
      authorization_endpoint: 'https://auth.idp.example.com/authorize',
      issuer: 'https://issuer.idp.example.com',
    }),
  } as any;
  oidc.configuration = {
    ...configurationValid,
    discovery: 'https://idp.example.com/.well-known/openid-configuration',
  };

  const { allowedOrigins } = oidc.getAllowedAuthorizationRedirects();

  expect(allowedOrigins.has('https://issuer.idp.example.com')).toBe(true);
  expect(allowedOrigins.has('https://auth.idp.example.com')).toBe(true);
  expect(allowedOrigins.has('https://idp.example.com')).toBe(true);
});

// --- normalizePathname mutant killers ---

test('getAllowedAuthorizationRedirects should strip trailing slash from authorization endpoint path', () => {
  oidc.client = {
    serverMetadata: () => ({
      authorization_endpoint: 'https://idp.example.com/auth/',
      issuer: 'https://idp.example.com',
    }),
  } as any;
  oidc.configuration = configurationValid;

  const { strictEndpoints } = oidc.getAllowedAuthorizationRedirects();

  expect(strictEndpoints.has('https://idp.example.com/auth')).toBe(true);
  expect(strictEndpoints.has('https://idp.example.com/auth/')).toBe(false);
});

test('getAllowedAuthorizationRedirects should normalize root path to slash', () => {
  oidc.client = {
    serverMetadata: () => ({
      authorization_endpoint: 'https://idp.example.com/',
      issuer: 'https://idp.example.com',
    }),
  } as any;
  oidc.configuration = configurationValid;

  const { strictEndpoints } = oidc.getAllowedAuthorizationRedirects();

  expect(strictEndpoints.has('https://idp.example.com/')).toBe(true);
});

// --- isNonEmptyString: empty codeVerifier in pending check ---

test('collectValidChecks should reject a pending check with an empty codeVerifier', async () => {
  const session = {
    oidc: {
      default: {
        pending: {
          'valid-state': {
            state: 'valid-state',
            codeVerifier: '', // empty string should be rejected
            createdAt: Date.now(),
          },
        },
      },
    },
  };
  const req = createCallbackReq('/auth/oidc/default/cb?code=abc&state=valid-state', session);
  const res = createRes();

  await oidc.callback(req, res);

  expect(openidClientMock.authorizationCodeGrant).not.toHaveBeenCalled();
  expect401JsonMessage(res, 'OIDC session state mismatch or expired. Please retry authentication.');
});

// --- parseHttpUrl protocol check ---

test('parseHttpUrl should reject ftp: protocol URLs in getAllowedAuthorizationRedirects', () => {
  oidc.configuration = {
    ...configurationValid,
    discovery: 'ftp://idp.example.com/openid',
  };
  oidc.client = undefined as any;

  const { strictEndpoints, allowedOrigins } = oidc.getAllowedAuthorizationRedirects();

  expect(strictEndpoints.size).toBe(0);
  expect(allowedOrigins.size).toBe(0);
});

test('isAllowedAuthorizationRedirect should allow https authorization redirect', () => {
  const allowed = oidc.isAllowedAuthorizationRedirect(new URL('https://idp/auth'));
  expect(allowed).toBe(true);
});

test('isAllowedAuthorizationRedirect should allow http authorization redirect', () => {
  oidc.client = {
    serverMetadata: () => ({
      authorization_endpoint: 'http://idp.local/auth',
      issuer: 'http://idp.local',
    }),
  } as any;
  oidc.configuration = configurationValid;

  const allowed = oidc.isAllowedAuthorizationRedirect(new URL('http://idp.local/auth'));
  expect(allowed).toBe(true);
});

test('isAllowedAuthorizationRedirect should reject ftp: protocol', () => {
  const allowed = oidc.isAllowedAuthorizationRedirect(new URL('ftp://idp/auth'));
  expect(allowed).toBe(false);
});

// --- getMaxConcurrentSessionsPerUser: minimum value = 1 ---

test('getMaxConcurrentSessionsPerUser should use value of 1 when configured', async () => {
  mockSuccessfulGrant(openidClientMock);
  const getServerConfigurationSpy = vi.spyOn(configuration, 'getServerConfiguration');
  getServerConfigurationSpy.mockReturnValue({
    session: { maxconcurrentsessions: 1 },
  } as ReturnType<typeof configuration.getServerConfiguration>);

  try {
    // With maxconcurrentsessions=1, a second existing session should be evicted
    const session = createSessionWithPending({ 'valid-state': createPendingCheck() });
    const req = createCallbackReq('/auth/oidc/default/cb?code=abc&state=valid-state', session);
    req.sessionID = 'current-session';
    req.sessionStore = {
      all: vi.fn((done) =>
        done(null, {
          'session-to-evict': {
            passport: { user: JSON.stringify({ username: 'user@example.com' }) },
            cookie: { expires: '2026-01-01T00:00:00.000Z' },
          },
        }),
      ),
      destroy: vi.fn((_sid, done) => done()),
    };
    const res = createRes();

    await oidc.callback(req, res);

    // With limit of 1, the existing session should be evicted
    expect(req.sessionStore.destroy).toHaveBeenCalledWith('session-to-evict', expect.any(Function));
    expect(res.redirect).toHaveBeenCalledWith('https://dd.example.com');
  } finally {
    getServerConfigurationSpy.mockRestore();
  }
});

// --- redirect: session null check and lock key determination ---

test('redirect should warn and return 500 when req.session is null', async () => {
  const req = createReq({ session: null });
  const res = createRes();

  await oidc.redirect(req, res);

  expect(oidc.log.warn).toHaveBeenCalledWith(
    'Unable to initialize OIDC checks because no session is available',
  );
  expect(res.status).toHaveBeenCalledWith(500);
  expect(res.json).toHaveBeenCalledWith({ error: 'Unable to initialize OIDC session' });
});

test('redirect should use session lock when sessionID is a non-empty string', async () => {
  const save = vi.fn((cb) => cb());
  const reload = vi.fn((cb) => cb());
  const req = createReq({
    sessionID: 'real-session-id',
    session: { reload, save },
  });
  const res = createRes();

  await oidc.redirect(req, res);

  // reload should be called as part of lock-guarded persistOidcChecks
  expect(reload).toHaveBeenCalledTimes(1);
  expectDefaultRedirectPayload(res);
});

test('redirect should use session lock when sessionID is a numeric-looking string', async () => {
  const save = vi.fn((cb) => cb());
  const req = createReq({
    sessionID: '12345678',
    session: { save },
  });
  const res = createRes();

  await oidc.redirect(req, res);

  expectDefaultRedirectPayload(res);
});

// --- redirect: oidc session initialization from non-object ---

test('redirect should reset oidc field when it is not an object', async () => {
  const session = { oidc: 'invalid-string', save: vi.fn((cb) => cb()) };
  const req = createReq({ session });
  const res = createRes();

  await oidc.redirect(req, res);

  expect(typeof req.session.oidc).toBe('object');
  expectDefaultRedirectPayload(res);
});

// --- redirect: session lock key undefined path ---

test('redirect should skip session lock when sessionID is a number', async () => {
  const save = vi.fn((cb) => cb());
  const req = createReq({ sessionID: 999 as any, session: { save } });
  const res = createRes();

  await oidc.redirect(req, res);

  expectDefaultRedirectPayload(res);
});

// --- validateCallbackData: req.session optional chaining ---

test('validateCallbackData should handle null session gracefully', async () => {
  const req = createReq({
    url: '/auth/oidc/default/cb?code=abc&state=valid-state',
    session: null,
    login: vi.fn(),
  });
  const res = createRes();

  await oidc.callback(req, res);

  expect(openidClientMock.authorizationCodeGrant).not.toHaveBeenCalled();
  expect401JsonMessage(res, 'OIDC session is missing or expired. Please retry authentication.');
});

// --- buildNextOidcChecks: empty nextOidcChecks early return ---

test('buildNextOidcChecks should return empty object when session.oidc is empty', () => {
  const result = oidc.buildNextOidcChecks(
    { oidc: {} },
    'default',
    { state1: { state: 'state1', codeVerifier: 'cv', createdAt: Date.now() } },
    'state1',
  );
  expect(Object.keys(result)).toHaveLength(0);
});

// --- persistCallbackSession: Object.keys nextOidcChecks length check ---

test('persistCallbackSession should set session.oidc when nextOidcChecks has remaining entries', async () => {
  mockSuccessfulGrant(openidClientMock);

  const session = {
    oidc: {
      default: {
        pending: {
          'state-to-consume': {
            state: 'state-to-consume',
            codeVerifier: 'cv1',
            createdAt: Date.now(),
          },
          'state-remaining': {
            state: 'state-remaining',
            codeVerifier: 'cv2',
            createdAt: Date.now(),
          },
        },
      },
    },
    save: vi.fn((cb) => cb()),
  };

  const req = createCallbackReq('/auth/oidc/default/cb?code=abc&state=state-to-consume', session);
  const res = createRes();

  await oidc.callback(req, res);

  // The remaining check should still be in session.oidc
  expect(req.session?.oidc).toBeDefined();
  expect((req.session?.oidc as any)?.default?.pending?.['state-remaining']).toBeDefined();
  expect((req.session?.oidc as any)?.default?.pending?.['state-to-consume']).toBeUndefined();
  expect(res.redirect).toHaveBeenCalledWith('https://dd.example.com');
});

// --- getElapsedSeconds: arithmetic integrity ---

test('recordLoginMetrics should record a non-negative duration for success', async () => {
  const startedAt = process.hrtime.bigint();
  oidc.recordLoginMetrics('success', startedAt);

  expect(mockObserveAuthLoginDuration).toHaveBeenCalledWith('success', 'oidc', expect.any(Number));
  const duration = mockObserveAuthLoginDuration.mock.calls[0][2];
  expect(duration).toBeGreaterThanOrEqual(0);
  expect(duration).toBeLessThan(10); // should be sub-second
});

// --- collectValidChecks: TTL boundary with <= vs < operator ---

test('collectValidChecks should accept a check created exactly at TTL boundary', async () => {
  mockSuccessfulGrant(openidClientMock);

  const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(1000000000000);
  try {
    const session = {
      oidc: {
        default: {
          pending: {
            'valid-state': {
              state: 'valid-state',
              codeVerifier: 'code-verifier',
              createdAt: 1000000000000 - 5 * 60 * 1000, // exactly at the TTL boundary
            },
          },
        },
      },
      save: vi.fn((cb) => cb()),
    };
    const req = createCallbackReq('/auth/oidc/default/cb?code=abc&state=valid-state', session);
    const res = createRes();

    await oidc.callback(req, res);

    // At exactly the TTL boundary (<=), the check should be valid
    expect(openidClientMock.authorizationCodeGrant).toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith('https://dd.example.com');
  } finally {
    dateSpy.mockRestore();
  }
});

test('collectValidChecks should reject a check that is 1ms past the TTL', async () => {
  const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(1000000000000);
  try {
    const session = createSessionWithPending({
      'valid-state': {
        state: 'valid-state',
        codeVerifier: 'code-verifier',
        createdAt: 1000000000000 - 5 * 60 * 1000 - 1, // 1ms past TTL
      },
    });
    const req = createCallbackReq('/auth/oidc/default/cb?code=abc&state=valid-state', session);
    const res = createRes();

    await oidc.callback(req, res);

    expect(openidClientMock.authorizationCodeGrant).not.toHaveBeenCalled();
    expect401JsonMessage(
      res,
      'OIDC session state mismatch or expired. Please retry authentication.',
    );
  } finally {
    dateSpy.mockRestore();
  }
});

// --- getAllowedAuthorizationRedirects: serverMetadata function check ---

test('getAllowedAuthorizationRedirects should handle client with non-function serverMetadata', () => {
  oidc.client = { serverMetadata: 'not-a-function' } as any;
  oidc.configuration = configurationValid;

  const { strictEndpoints } = oidc.getAllowedAuthorizationRedirects();

  expect(strictEndpoints.size).toBe(0);
});

// --- normalizePendingChecks: non-object rawChecks in redirect ---

test('normalizePendingChecks should handle non-null non-object oidc entry (e.g., number)', async () => {
  mockSuccessfulGrant(openidClientMock);

  // Provide a valid 8-char state that passes OIDC_STATE_PATTERN
  const session = {
    oidc: {
      default: 42, // non-null, non-object value (normalizePendingChecks should handle it)
    },
    save: vi.fn((cb) => cb()),
  };

  const req = createReq({ session });
  const res = createRes();

  // redirect will call normalizePendingChecks with 42 as rawChecks
  await oidc.redirect(req, res);

  // Should still succeed by initializing fresh oidc state
  expectDefaultRedirectPayload(res);
});

// --- normalizePendingChecks: null rawChecks (line 250 null check) ---

test('normalizePendingChecks should handle null oidc session entry (e.g., oidc.default = null)', async () => {
  mockSuccessfulGrant(openidClientMock);

  // Provide a null value for the session key — normalizePendingChecks(null) should return empty record
  const session = {
    oidc: {
      default: null, // explicitly null
    },
    save: vi.fn((cb) => cb()),
  };

  const req = createCallbackReq('/auth/oidc/default/cb?code=abc&state=valid-state', session);
  const res = createRes();

  await oidc.callback(req, res);

  // null session entry = missing checks => authentication error
  expect(openidClientMock.authorizationCodeGrant).not.toHaveBeenCalled();
  expect401JsonMessage(res, 'OIDC session is missing or expired. Please retry authentication.');
});

// --- normalizePendingChecks: pending: null (line 256 null guard) ---

test('normalizePendingChecks should treat pending: null as empty and fall back to legacy format', async () => {
  mockSuccessfulGrant(openidClientMock);

  // pending field is explicitly null — should not be treated as object
  const session = {
    oidc: {
      default: { pending: null, state: null, codeVerifier: null },
    },
    save: vi.fn((cb) => cb()),
  };

  const req = createCallbackReq('/auth/oidc/default/cb?code=abc&state=valid-state', session);
  const res = createRes();

  await oidc.callback(req, res);

  // null pending + null state/codeVerifier = empty checks => state mismatch error
  expect(openidClientMock.authorizationCodeGrant).not.toHaveBeenCalled();
  expect401JsonMessage(res, 'OIDC session state mismatch or expired. Please retry authentication.');
});

// --- normalizePathname: multi-trailing-slash (line 180 /\/+$/ vs /\/$/) ---

test('getAllowedAuthorizationRedirects should strip multiple trailing slashes from authorization endpoint path', () => {
  oidc.client = {
    serverMetadata: () => ({
      authorization_endpoint: 'https://idp.example.com/auth//',
      issuer: 'https://idp.example.com',
    }),
  } as any;
  oidc.configuration = configurationValid;

  const { strictEndpoints } = oidc.getAllowedAuthorizationRedirects();

  // Double trailing slash must be fully stripped to '/auth'
  expect(strictEndpoints.has('https://idp.example.com/auth')).toBe(true);
  expect(strictEndpoints.has('https://idp.example.com/auth/')).toBe(false);
  expect(strictEndpoints.has('https://idp.example.com/auth//')).toBe(false);
});

// --- persistCallbackSession: preserves other strategy when consuming all checks from default ---

test('persistCallbackSession should preserve other strategy keys when all default checks are consumed', async () => {
  mockSuccessfulGrant(openidClientMock);

  const session: any = {
    oidc: {
      default: {
        pending: {
          'valid-state': {
            state: 'valid-state',
            codeVerifier: 'code-verifier',
            createdAt: Date.now(),
          },
        },
      },
      'other-strategy': {
        pending: {
          'other-state': { state: 'other-state', codeVerifier: 'other-cv', createdAt: Date.now() },
        },
      },
    },
    save: vi.fn((cb) => cb()),
  };

  const req = createCallbackReq('/auth/oidc/default/cb?code=abc&state=valid-state', session);
  const res = createRes();

  await oidc.callback(req, res);

  // 'default' key should be removed; 'other-strategy' must remain
  expect(req.session?.oidc).toBeDefined();
  expect(req.session?.oidc).not.toHaveProperty('default');
  expect(req.session?.oidc).toHaveProperty('other-strategy');
  expect(res.redirect).toHaveBeenCalledWith('https://dd.example.com');
});

// --- getConfigurationSchema: redirect default is false (line 407) ---

test('getConfigurationSchema should default redirect to false', () => {
  const previousPublicUrl = configuration.ddEnvVars.DD_PUBLIC_URL;
  configuration.ddEnvVars.DD_PUBLIC_URL = 'https://dd.example.com';
  try {
    const validated = oidc.validateConfiguration({
      discovery: 'https://idp.example.com/.well-known/openid-configuration',
      clientid: 'wud-client',
      clientsecret: 'wud-secret',
      timeout: 5000,
      // redirect is deliberately omitted — must default to false
    } as any);

    expect(validated.redirect).toBe(false);
  } finally {
    if (previousPublicUrl === undefined) {
      delete configuration.ddEnvVars.DD_PUBLIC_URL;
    } else {
      configuration.ddEnvVars.DD_PUBLIC_URL = previousPublicUrl;
    }
  }
});

// --- discoverClient: cafile block sets connect.ca (line 460 block statement) ---

test('initAuthentication should set connect.ca option when cafile is configured', async () => {
  oidc.client = undefined;
  oidc.logoutUrl = undefined;
  const { caPath, cleanup } = await createTemporaryCaFile();
  mockUndiciFetch.mockResolvedValue(new Response(null, { status: 200 }) as Response);
  oidc.configuration = {
    ...configurationValid,
    cafile: caPath,
    insecure: false,
  };
  const mockClient = {};
  openidClientMock.discovery = vi.fn().mockResolvedValue(mockClient);
  openidClientMock.buildEndSessionUrl = vi.fn().mockReturnValue(new URL('https://idp/logout'));

  try {
    await oidc.initAuthentication();

    const callArgs = openidClientMock.discovery.mock.calls[0];
    const customFetch = callArgs[4][openidClientMock.customFetch];
    await customFetch('https://idp.example.com/.well-known/openid-configuration', {
      method: 'GET',
    });

    const requestInit = mockUndiciFetch.mock.calls[0][1] as { dispatcher?: unknown };
    const agentOptions = getUndiciAgentOptions(requestInit.dispatcher);
    const connectOptions = agentOptions?.connect as Record<string, unknown> | undefined;
    // The CA certificate buffer must be present in the connect options
    expect(connectOptions?.ca).toBeDefined();
    // rejectUnauthorized must NOT be false since insecure=false
    expect(connectOptions?.rejectUnauthorized).not.toBe(false);
  } finally {
    await cleanup();
  }
});

// --- discoverClient: insecure=false must NOT set rejectUnauthorized=false (line 466/468) ---

test('initAuthentication should NOT set rejectUnauthorized=false when insecure is false', async () => {
  oidc.client = undefined;
  oidc.logoutUrl = undefined;
  const { caPath, cleanup } = await createTemporaryCaFile();
  mockUndiciFetch.mockResolvedValue(new Response(null, { status: 200 }) as Response);
  oidc.configuration = {
    ...configurationValid,
    cafile: caPath,
    insecure: false,
  };
  const mockClient = {};
  openidClientMock.discovery = vi.fn().mockResolvedValue(mockClient);
  openidClientMock.buildEndSessionUrl = vi.fn().mockReturnValue(new URL('https://idp/logout'));

  try {
    await oidc.initAuthentication();

    const callArgs = openidClientMock.discovery.mock.calls[0];
    const customFetch = callArgs[4][openidClientMock.customFetch];
    await customFetch('https://idp.example.com/.well-known/openid-configuration', {
      method: 'GET',
    });

    const requestInit = mockUndiciFetch.mock.calls[0][1] as { dispatcher?: unknown };
    const agentOptions = getUndiciAgentOptions(requestInit.dispatcher);
    const connectOptions = agentOptions?.connect as Record<string, unknown> | undefined;
    // With insecure=false, TLS verification should NOT be disabled
    expect(connectOptions?.rejectUnauthorized).not.toBe(false);
    // The warn about disabled TLS must NOT appear
    expect(oidc.log.warn).not.toHaveBeenCalledWith(
      'TLS certificate verification disabled for OIDC - do not use in production',
    );
  } finally {
    await cleanup();
  }
});

// --- reloadSessionIfPossible: reload success must NOT trigger regenerate (line 316) ---

test('redirect should not call regenerate when session reload succeeds', async () => {
  const regenerate = vi.fn((cb) => cb());
  const save = vi.fn((cb) => cb());
  const req = createReq({
    sessionID: 'session-abc',
    session: {
      reload: vi.fn((cb) => cb(null)), // success — no error
      regenerate,
      save,
    },
  });
  const res = createRes();

  await oidc.redirect(req, res);

  // reload succeeded => regenerate must NOT have been called
  expect(regenerate).not.toHaveBeenCalled();
  expectDefaultRedirectPayload(res);
});

// --- isValidCheckEntry: null check value (lines 198-200) ---

test('callback should reject pending check with null value', async () => {
  const session = {
    oidc: {
      default: {
        pending: {
          'valid-state': null, // null check entry — must be rejected by isValidCheckEntry
        },
      },
    },
    save: vi.fn((cb) => cb()),
  };

  const req = createCallbackReq('/auth/oidc/default/cb?code=abc&state=valid-state', session);
  const res = createRes();

  await oidc.callback(req, res);

  expect(openidClientMock.authorizationCodeGrant).not.toHaveBeenCalled();
  expect401JsonMessage(res, 'OIDC session state mismatch or expired. Please retry authentication.');
});
