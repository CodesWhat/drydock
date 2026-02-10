// @ts-nocheck
// Force v8 coverage to pick up the Forgejo module by importing directly
import Forgejo from './Forgejo.js';

// Test fixture credentials - not real secrets
const TEST_LOGIN = 'login';
const TEST_PASSWORD = 'password'; // NOSONAR
const TEST_PASS = 'pass'; // NOSONAR

// Verify the Forgejo class is properly a subclass of Gitea
test('Forgejo should be an instance of Gitea', async () => {
    const { default: Gitea } = await import('../gitea/Gitea.js');
    const forgejo = new Forgejo();
    expect(forgejo).toBeInstanceOf(Gitea);
});

const forgejo = new Forgejo();
forgejo.configuration = {
    login: TEST_LOGIN,
    password: TEST_PASSWORD,
    url: 'https://forgejo.acme.com',
};

test('validatedConfiguration should initialize when configuration is valid', async () => {
    expect(
        forgejo.validateConfiguration({
            url: 'https://forgejo.acme.com',
            login: TEST_LOGIN,
            password: TEST_PASSWORD,
        }),
    ).toStrictEqual({
        url: 'https://forgejo.acme.com',
        login: TEST_LOGIN,
        password: TEST_PASSWORD,
    });
});

test('validatedConfiguration should throw error when auth is not base64', async () => {
    expect(() => {
        forgejo.validateConfiguration({
            url: 'https://forgejo.acme.com',
            auth: '°°°',
        });
    }).toThrow('"auth" must be a valid base64 string');
});

test('match should return true when registry url is from forgejo', async () => {
    expect(
        forgejo.match({
            registry: {
                url: 'forgejo.acme.com',
            },
        }),
    ).toBeTruthy();
});

test('match should return false when registry url is not from forgejo', async () => {
    expect(
        forgejo.match({
            registry: {
                url: 'forgejo.notme.io',
            },
        }),
    ).toBeFalsy();
});

test('normalizeImage should return the proper registry v2 endpoint', async () => {
    expect(
        forgejo.normalizeImage({
            name: 'test/image',
            registry: {
                url: 'forgejo.acme.com/test/image',
            },
        }),
    ).toStrictEqual({
        name: 'test/image',
        registry: {
            url: 'https://forgejo.acme.com/v2',
        },
    });
});

test('should initialize and prepend https to URL without protocol', async () => {
    const forgejoInstance = new Forgejo();
    forgejoInstance.configuration = {
        url: 'forgejo.example.com',
        login: 'user',
        password: TEST_PASS,
    };

    forgejoInstance.init();
    expect(forgejoInstance.configuration.url).toBe('https://forgejo.example.com');
});

test('should not modify URL that already has protocol', async () => {
    const forgejoInstance = new Forgejo();
    forgejoInstance.configuration = {
        url: 'http://forgejo.example.com',
        login: 'user',
        password: TEST_PASS,
    };

    forgejoInstance.init();
    expect(forgejoInstance.configuration.url).toBe('http://forgejo.example.com');
});

test('should validate configuration with auth instead of login/password', async () => {
    const config = {
        url: 'https://forgejo.example.com',
        auth: Buffer.from('user:pass').toString('base64'),
    };

    expect(() => forgejo.validateConfiguration(config)).not.toThrow();
});

test('should validate configuration with empty auth', async () => {
    const config = {
        url: 'https://forgejo.example.com',
        auth: '',
    };

    expect(() => forgejo.validateConfiguration(config)).not.toThrow();
});

test('match should handle URLs with different protocols', async () => {
    const forgejoWithHttp = new Forgejo();
    forgejoWithHttp.configuration = { url: 'http://forgejo.acme.com' };

    expect(
        forgejoWithHttp.match({
            registry: { url: 'https://forgejo.acme.com' },
        }),
    ).toBeTruthy();
});

test('match should be case insensitive', async () => {
    const forgejoUpper = new Forgejo();
    forgejoUpper.configuration = { url: 'https://FORGEJO.ACME.COM' };

    expect(
        forgejoUpper.match({
            registry: { url: 'forgejo.acme.com' },
        }),
    ).toBeTruthy();
});
