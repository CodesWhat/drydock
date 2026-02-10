// @ts-nocheck
import express from 'express';
import { ClientSecretPost, Configuration } from 'openid-client';
import Oidc from './Oidc.js';

const app = express();

const configurationValid = {
    clientid: '123465798',
    clientsecret: 'secret', // NOSONAR - test fixture, not a real credential
    discovery: 'https://idp/.well-known/openid-configuration',
    redirect: false,
    timeout: 5000,
};

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

function createCallbackReq(originalUrl: string, session: any, loginBehavior?: (user, done) => void) {
    return createReq({
        originalUrl,
        session,
        login: vi.fn(loginBehavior || ((user, done) => done())),
    });
}

/** Set up a successful grant + userInfo mock on the openidClientMock */
function mockSuccessfulGrant(mock: any) {
    mock.authorizationCodeGrant = vi
        .fn()
        .mockResolvedValue({ access_token: 'token' }); // NOSONAR - test fixture, not a real credential
    mock.fetchUserInfo = vi
        .fn()
        .mockResolvedValue({ email: 'user@example.com' });
}

/** Assert a 401 JSON error response */
function expect401Json(res: any, error = 'Authentication failed') {
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error });
}

/** Assert a 401 text error response */
function expect401Send(res: any, message: string) {
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.send).toHaveBeenCalledWith(message);
}

/** Perform a redirect flow and return the session with pending state */
async function performRedirect(oidcInstance: any, mock: any, session?: any) {
    const sess = session || { save: vi.fn((cb) => cb()) };
    const res = createRes();
    await oidcInstance.redirect(
        createReq({ session: sess }),
        res,
    );
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
        calculatePKCECodeChallenge: vi
            .fn()
            .mockResolvedValue('code-challenge'),
        buildAuthorizationUrl: vi
            .fn()
            .mockReturnValue(new URL('https://idp/auth')),
        authorizationCodeGrant: vi.fn(),
        fetchUserInfo: vi.fn(),
        skipSubjectCheck: Symbol('skip-subject-check'),
        ClientSecretPost: vi.fn(),
        discovery: vi.fn(),
        buildEndSessionUrl: vi.fn(),
    };
    oidc.openidClient = openidClientMock;
    oidc.client = new Configuration(
        { issuer: 'https://idp.example.com' },
        'dd-client',
        'dd-secret', // NOSONAR - test fixture, not a real credential
        ClientSecretPost('dd-secret'), // NOSONAR - test fixture, not a real credential
    );
    oidc.name = '';
    oidc.log = {
        debug: vi.fn(),
        warn: vi.fn(),
    };
});

test('validateConfiguration should return validated configuration when valid', async () => {
    const validatedConfiguration =
        oidc.validateConfiguration(configurationValid);
    expect(validatedConfiguration).toStrictEqual(configurationValid);
});

test('validateConfiguration should throw error when invalid', async () => {
    const configuration = {};
    expect(() => {
        oidc.validateConfiguration(configuration);
    }).toThrowError('"discovery" is required');
});

test('getStrategy should return an Authentication strategy', async () => {
    const strategy = oidc.getStrategy(app);
    expect(strategy.name).toEqual('oidc');
});

test('maskConfiguration should mask configuration secrets', async () => {
    expect(oidc.maskConfiguration()).toEqual({
        clientid: '1*******8',
        clientsecret: 's****t',
        discovery: 'https://idp/.well-known/openid-configuration',
        redirect: false,
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

test('verify should return user on valid token', async () => {
    openidClientMock.fetchUserInfo = vi.fn().mockResolvedValue({ email: 'test@example.com' });

    const done = vi.fn();
    await oidc.verify('valid-token', done);

    expect(done).toHaveBeenCalledWith(null, { username: 'test@example.com' });
});

test('verify should return false on invalid token', async () => {
    openidClientMock.fetchUserInfo = vi
        .fn()
        .mockRejectedValue(new Error('Invalid token'));
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
        req.session.oidc.default.pending[
            Object.keys(req.session.oidc.default.pending)[0]
        ].codeVerifier,
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
                session.oidc = JSON.parse(
                    JSON.stringify(persistedOidcState.oidc || {}),
                );
                cb();
            }, 0);
        });
        session.save = vi.fn((cb) => {
            setTimeout(() => {
                persistedOidcState.oidc = JSON.parse(
                    JSON.stringify(session.oidc || {}),
                );
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

test('callback should fail with explicit message when callback state is missing', async () => {
    const session = createSessionWithPending({
        state1: createPendingCheck(),
    });
    const req = createCallbackReq('/auth/oidc/default/cb?code=abc', session);
    const res = createRes();

    await oidc.callback(req, res);

    expect(openidClientMock.authorizationCodeGrant).not.toHaveBeenCalled();
    expect401Send(res, 'OIDC callback is missing state. Please retry authentication.');
});

test('callback should return explicit error when oidc checks are missing', async () => {
    openidClientMock.authorizationCodeGrant = vi.fn();

    const req = createCallbackReq(undefined, {});
    const res = createRes();

    await oidc.callback(req, res);

    expect(openidClientMock.authorizationCodeGrant).not.toHaveBeenCalled();
    expect401Send(res, 'OIDC session is missing or expired. Please retry authentication.');
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

    const req = createCallbackReq(
        `/auth/oidc/default/cb?code=abc&state=${firstState}`,
        session,
    );
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

    const req = createCallbackReq(
        '/auth/oidc/default/cb?code=abc&state=legacy-state',
        {
            oidc: {
                default: {
                    state: 'legacy-state',
                    codeVerifier: 'legacy-code-verifier',
                },
            },
        },
    );
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
    const req = createCallbackReq(
        '/auth/oidc/default/cb?code=abc&state=unknown-state',
        session,
    );
    const res = createRes();

    await oidc.callback(req, res);

    expect(openidClientMock.authorizationCodeGrant).not.toHaveBeenCalled();
    expect401Send(res, 'OIDC session state mismatch or expired. Please retry authentication.');
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

test('callback should return 401 when authorizationCodeGrant throws', async () => {
    openidClientMock.authorizationCodeGrant = vi
        .fn()
        .mockRejectedValue(new Error('grant failed'));

    const session = createSessionWithPending({
        'valid-state': createPendingCheck(),
    });
    const req = createCallbackReq(
        '/auth/oidc/default/cb?code=abc&state=valid-state',
        session,
    );
    const res = createRes();

    await oidc.callback(req, res);

    expect401Json(res);
});

test.each([
    [
        'session is unavailable',
        {},
    ],
    [
        'session save fails',
        { session: { save: vi.fn((cb) => cb(new Error('save failed'))) } },
    ],
    [
        'session reload error',
        { session: { reload: vi.fn((cb) => cb(new Error('reload failed'))), save: vi.fn((cb) => cb()) } },
    ],
])('redirect should respond with 500 when %s', async (_label, reqOverrides) => {
    const req = createReq(reqOverrides);
    const res = createRes();

    await oidc.redirect(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
});

test('callback should return 401 when access_token is missing', async () => {
    openidClientMock.authorizationCodeGrant = vi
        .fn()
        .mockResolvedValue({});

    const session = createSessionWithPending({
        'valid-state': createPendingCheck(),
    });
    const req = createCallbackReq(
        '/auth/oidc/default/cb?code=abc&state=valid-state',
        session,
    );
    const res = createRes();

    await oidc.callback(req, res);

    expect401Json(res);
});

test('initAuthentication should discover and configure client', async () => {
    const mockClient = {};
    openidClientMock.discovery = vi.fn().mockResolvedValue(mockClient);
    openidClientMock.buildEndSessionUrl = vi.fn().mockReturnValue(new URL('https://idp/logout'));

    await oidc.initAuthentication();

    expect(openidClientMock.discovery).toHaveBeenCalled();
    expect(oidc.logoutUrl).toBe('https://idp/logout');
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

test('redirect should skip session lock when sessionID is empty', async () => {
    const save = vi.fn((cb) => cb());
    const req = createReq({ sessionID: '', session: { save } });
    const res = createRes();

    await oidc.redirect(req, res);

    expect(res.json).toHaveBeenCalledWith({ url: 'https://idp/auth' });
});
