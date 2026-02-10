// @ts-nocheck
import Docr from './Docr.js';

const docr = new Docr();

test('validatedConfiguration should initialize when configuration is valid', async () => {
    expect(
        docr.validateConfiguration({
            token: 'dop_v1_abcdef',
        }),
    ).toStrictEqual({
        token: 'dop_v1_abcdef',
    });
});

test('validatedConfiguration should initialize when anonymous configuration is valid', async () => {
    expect(docr.validateConfiguration('')).toStrictEqual({});
    expect(docr.validateConfiguration(undefined)).toStrictEqual({});
});

test('match should return true when registry url is from docr', async () => {
    expect(
        docr.match({
            registry: {
                url: 'registry.digitalocean.com',
            },
        }),
    ).toBeTruthy();
});

test('match should return false when registry url is not from docr', async () => {
    expect(
        docr.match({
            registry: {
                url: 'wrong.io',
            },
        }),
    ).toBeFalsy();
});

test('match should reject hostnames that bypass unescaped dot in regex', async () => {
    expect(docr.match({ registry: { url: 'registryXdigitaloceanXcom' } })).toBe(false);
    expect(docr.match({ registry: { url: 'evil-registry.digitalocean.com.attacker.com' } })).toBe(false);
    expect(docr.match({ registry: { url: 'notregistry.digitalocean.com' } })).toBe(false);
});

test('init should map token to password and set default login', async () => {
    await docr.register('registry', 'docr', 'private', {
        token: 'dop_v1_abcdef',
    });

    expect(docr.configuration.url).toEqual(
        'https://registry.digitalocean.com',
    );
    expect(docr.configuration.login).toEqual('doctl');
    expect(docr.configuration.password).toEqual('dop_v1_abcdef');
});

test('normalizeImage should return the proper registry v2 endpoint', async () => {
    docr.configuration = {
        url: 'https://registry.digitalocean.com',
    };

    expect(
        docr.normalizeImage({
            name: 'acme/api',
            registry: {
                url: 'registry.digitalocean.com/acme/api',
            },
        }),
    ).toStrictEqual({
        name: 'acme/api',
        registry: {
            url: 'https://registry.digitalocean.com/v2',
        },
    });
});

test('authenticate should add basic auth from token alias', async () => {
    docr.configuration = {
        login: 'doctl',
        password: 'dop_v1_abcdef',
    };

    expect(docr.authenticate(undefined, { headers: {} })).resolves.toEqual({
        headers: {
            Authorization: 'Basic ZG9jdGw6ZG9wX3YxX2FiY2RlZg==',
        },
    });
});
