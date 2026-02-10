// @ts-nocheck
import Custom from './Custom.js';

// Test fixture credentials - not real secrets
const TEST_LOGIN = 'login';
const TEST_PASSWORD = 'password'; // NOSONAR

const custom = new Custom();
custom.configuration = {
    login: TEST_LOGIN,
    password: TEST_PASSWORD,
    url: 'http://localhost:5000',
};

test('validatedConfiguration should initialize when configuration is valid', async () => {
    expect(
        custom.validateConfiguration({
            url: 'http://localhost:5000',
            login: TEST_LOGIN,
            password: TEST_PASSWORD,
        }),
    ).toStrictEqual({
        url: 'http://localhost:5000',
        login: TEST_LOGIN,
        password: TEST_PASSWORD,
    });
});

test('validatedConfiguration should throw error when auth is not base64', async () => {
    expect(() => {
        custom.validateConfiguration({
            url: 'http://localhost:5000',
            auth: '°°°',
        });
    }).toThrow('"auth" must be a valid base64 string');
});

test('maskConfiguration should mask configuration secrets', async () => {
    expect(custom.maskConfiguration()).toEqual({
        auth: undefined,
        login: TEST_LOGIN,
        password: 'p******d',
        url: 'http://localhost:5000',
    });
});

test('match should return true when registry url is from custom', async () => {
    expect(
        custom.match({
            registry: {
                url: 'localhost:5000',
            },
        }),
    ).toBeTruthy();
});

test('match should return false when registry url is not from custom', async () => {
    expect(
        custom.match({
            registry: {
                url: 'est.notme.io',
            },
        }),
    ).toBeFalsy();
});

test('normalizeImage should return the proper registry v2 endpoint', async () => {
    expect(
        custom.normalizeImage({
            name: 'test/image',
            registry: {
                url: 'localhost:5000/test/image',
            },
        }),
    ).toStrictEqual({
        name: 'test/image',
        registry: {
            url: 'http://localhost:5000/v2',
        },
    });
});

test('authenticate should add basic auth', async () => {
    expect(custom.authenticate(undefined, { headers: {} })).resolves.toEqual({
        headers: {
            Authorization: 'Basic bG9naW46cGFzc3dvcmQ=', // NOSONAR - test fixture, not a real credential
        },
    });
});

test('getAuthCredentials should return base64 creds when set in configuration', async () => {
    custom.configuration.auth = 'dXNlcm5hbWU6cGFzc3dvcmQ='; // NOSONAR - test fixture, not a real credential
    expect(custom.getAuthCredentials()).toEqual('dXNlcm5hbWU6cGFzc3dvcmQ=');
});

test('getAuthCredentials should return base64 creds when login/token set in configuration', async () => {
    custom.configuration.login = 'username';
    custom.configuration.token = TEST_PASSWORD;
    expect(custom.getAuthCredentials()).toEqual('dXNlcm5hbWU6cGFzc3dvcmQ=');
});

test('getAuthCredentials should return undefined when no login/token/auth set in configuration', async () => {
    custom.configuration = {};
    expect(custom.getAuthCredentials()).toBe(undefined);
});
