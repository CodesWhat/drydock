// @ts-nocheck
import Acr from './Acr.js';

const acr = new Acr();
acr.configuration = {
    clientid: 'clientid',
    clientsecret: 'clientsecret', // NOSONAR - test fixture, not a real credential
};

test('validatedConfiguration should initialize when configuration is valid', async () => {
    expect(
        acr.validateConfiguration({
            clientid: 'clientid',
            clientsecret: 'clientsecret', // NOSONAR - test fixture, not a real credential
        }),
    ).toStrictEqual({
        clientid: 'clientid',
        clientsecret: 'clientsecret', // NOSONAR - test fixture, not a real credential
    });
});

test('validatedConfiguration should throw error when configuration item is missing', async () => {
    expect(() => {
        acr.validateConfiguration({});
    }).toThrow('"clientid" is required');
});

test('maskConfiguration should mask configuration secrets', async () => {
    expect(acr.maskConfiguration()).toEqual({
        clientid: 'clientid',
        clientsecret: 'c**********t',
    });
});

test('match should return true when registry url is from acr', async () => {
    expect(
        acr.match({
            registry: {
                url: 'test.azurecr.io',
            },
        }),
    ).toBeTruthy();
});

test('match should return false when registry url is not from acr', async () => {
    expect(
        acr.match({
            registry: {
                url: 'est.notme.io',
            },
        }),
    ).toBeFalsy();
});

test('normalizeImage should return the proper registry v2 endpoint', async () => {
    expect(
        acr.normalizeImage({
            name: 'test/image',
            registry: {
                url: 'test.azurecr.io/test/image',
            },
        }),
    ).toStrictEqual({
        name: 'test/image',
        registry: {
            url: 'https://test.azurecr.io/test/image/v2',
        },
    });
});

test('authenticate should add basic auth', async () => {
    expect(acr.authenticate(undefined, { headers: {} })).resolves.toEqual({
        headers: {
            Authorization: 'Basic Y2xpZW50aWQ6Y2xpZW50c2VjcmV0',
        },
    });
});

test('getAuthPull should return clientid and clientsecret', async () => {
    const result = await acr.getAuthPull();
    expect(result).toEqual({
        username: 'clientid',
        password: 'clientsecret', // NOSONAR - test fixture, not a real credential
    });
});

test('normalizeImage should not double-prepend https when url already has it', async () => {
    expect(
        acr.normalizeImage({
            name: 'test/image',
            registry: {
                url: 'https://test.azurecr.io/v2',
            },
        }),
    ).toStrictEqual({
        name: 'test/image',
        registry: {
            url: 'https://test.azurecr.io/v2',
        },
    });
});
