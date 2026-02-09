// @ts-nocheck
import express from 'express';
import { ClientSecretPost, Configuration } from 'openid-client';
import Oidc from './Oidc.js';

const app = express();

const configurationValid = {
    clientid: '123465798',
    clientsecret: 'secret',
    discovery: 'https://idp/.well-known/openid-configuration',
    redirect: false,
    timeout: 5000,
};

let oidc;

let openidClientMock;

beforeEach(() => {
    jest.resetAllMocks();
    oidc = new Oidc();
    oidc.configuration = configurationValid;
    openidClientMock = {
        randomPKCECodeVerifier: jest.fn().mockReturnValue('code-verifier'),
        calculatePKCECodeChallenge: jest
            .fn()
            .mockResolvedValue('code-challenge'),
        buildAuthorizationUrl: jest
            .fn()
            .mockReturnValue(new URL('https://idp/auth')),
        authorizationCodeGrant: jest.fn(),
        fetchUserInfo: jest.fn(),
        skipSubjectCheck: Symbol('skip-subject-check'),
        ClientSecretPost: jest.fn(),
        discovery: jest.fn(),
        buildEndSessionUrl: jest.fn(),
    };
    oidc.openidClient = openidClientMock;
    oidc.client = new Configuration(
        { issuer: 'https://idp.example.com' },
        'wud-client',
        'wud-secret',
        ClientSecretPost('wud-secret'),
    );
    oidc.name = '';
    oidc.log = {
        debug: jest.fn(),
        warn: jest.fn(),
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
    const mockUserInfo = { email: 'test@example.com' };
    openidClientMock.fetchUserInfo = jest.fn().mockResolvedValue(mockUserInfo);

    const done = jest.fn();
    await oidc.verify('valid-token', done);

    expect(done).toHaveBeenCalledWith(null, { username: 'test@example.com' });
});

test('verify should return false on invalid token', async () => {
    openidClientMock.fetchUserInfo = jest
        .fn()
        .mockRejectedValue(new Error('Invalid token'));
    oidc.log = { warn: jest.fn() };

    const done = jest.fn();
    await oidc.verify('invalid-token', done);

    expect(done).toHaveBeenCalledWith(null, false);
});

test('getUserFromAccessToken should return user with email', async () => {
    const mockUserInfo = { email: 'user@example.com' };
    openidClientMock.fetchUserInfo = jest
        .fn()
        .mockResolvedValue(mockUserInfo);

    const user = await oidc.getUserFromAccessToken('token');
    expect(user).toEqual({ username: 'user@example.com' });
});

test('getUserFromAccessToken should return unknown for missing email', async () => {
    const mockUserInfo = {};
    openidClientMock.fetchUserInfo = jest
        .fn()
        .mockResolvedValue(mockUserInfo);

    const user = await oidc.getUserFromAccessToken('token');
    expect(user).toEqual({ username: 'unknown' });
});

test('redirect should persist oidc checks in session before responding', async () => {
    const save = jest.fn((cb) => cb());
    const req = {
        protocol: 'https',
        hostname: 'wud.example.com',
        session: {
            save,
        },
    };
    const res = {
        json: jest.fn(),
        status: jest.fn().mockReturnThis(),
        send: jest.fn(),
    };

    await oidc.redirect(req, res);

    expect(req.session.oidc.default).toBeDefined();
    expect(req.session.oidc.default.codeVerifier).toBeDefined();
    expect(req.session.oidc.default.state).toBeDefined();
    expect(save).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({ url: 'https://idp/auth' });
    expect(res.status).not.toHaveBeenCalled();
});

test('callback should return explicit error when oidc checks are missing', async () => {
    openidClientMock.authorizationCodeGrant = jest.fn();

    const req = {
        protocol: 'https',
        hostname: 'wud.example.com',
        session: {},
        login: jest.fn(),
    };
    const res = {
        status: jest.fn().mockReturnThis(),
        send: jest.fn(),
    };

    await oidc.callback(req, res);

    expect(openidClientMock.authorizationCodeGrant).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.send).toHaveBeenCalledWith(
        'OIDC session is missing or expired. Please retry authentication.',
    );
});
