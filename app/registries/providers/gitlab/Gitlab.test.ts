// @ts-nocheck
import axios from 'axios';
import Gitlab from './Gitlab.js';

// Test fixture credentials - not real secrets
const TEST_TOKEN = 'abcdef'; // NOSONAR

const gitlab = new Gitlab();
gitlab.configuration = {
    url: 'https://registry.gitlab.com',
    authurl: 'https://gitlab.com',
    token: TEST_TOKEN,
};

vi.mock('axios');

test('validatedConfiguration should initialize when configuration is valid', async () => {
    expect(
        gitlab.validateConfiguration({
            token: TEST_TOKEN,
        }),
    ).toStrictEqual({
        url: 'https://registry.gitlab.com',
        authurl: 'https://gitlab.com',
        token: TEST_TOKEN,
    });
    expect(
        gitlab.validateConfiguration({
            url: 'https://registry.custom.com',
            authurl: 'https://custom.com',
            token: TEST_TOKEN,
        }),
    ).toStrictEqual({
        url: 'https://registry.custom.com',
        authurl: 'https://custom.com',
        token: TEST_TOKEN,
    });
});

test('validatedConfiguration should throw error when no pam', async () => {
    expect(() => {
        gitlab.validateConfiguration({});
    }).toThrow('"token" is required');
});

test('maskConfiguration should mask configuration secrets', async () => {
    expect(gitlab.maskConfiguration()).toEqual({
        url: 'https://registry.gitlab.com',
        authurl: 'https://gitlab.com',
        token: 'a****f',
    });
});

test('match should return true when registry url is from gitlab.com', async () => {
    expect(
        gitlab.match({
            registry: {
                url: 'gitlab.com',
            },
        }),
    ).toBeTruthy();
});

test('match should return true when registry url is from custom gitlab', async () => {
    const gitlabCustom = new Gitlab();
    gitlabCustom.configuration = {
        url: 'https://registry.custom.com',
        authurl: 'https://custom.com',
        token: TEST_TOKEN,
    };
    expect(
        gitlabCustom.match({
            registry: {
                url: 'custom.com',
            },
        }),
    ).toBeTruthy();
});

test('authenticate should perform authenticate request', async () => {
    axios.mockImplementation(() => ({
        data: {
            token: 'token', // NOSONAR - test fixture, not a real credential
        },
    }));
    expect(
        gitlab.authenticate(
            {},
            {
                headers: {},
            },
        ),
    ).resolves.toEqual({ headers: { Authorization: 'Bearer token' } });
});

test('normalizeImage should return the proper registry v2 endpoint', async () => {
    expect(
        gitlab.normalizeImage({
            name: 'test/image',
            registry: {
                url: 'registry.gitlab.com',
            },
        }),
    ).toStrictEqual({
        name: 'test/image',
        registry: {
            url: 'https://registry.gitlab.com/v2',
        },
    });
});

test('getAuthPull should return pam', async () => {
    await expect(gitlab.getAuthPull()).resolves.toEqual({
        username: '',
        password: gitlab.configuration.token,
    });
});
