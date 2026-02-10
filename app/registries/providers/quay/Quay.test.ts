// @ts-nocheck
import axios from 'axios';
import Quay from './Quay.js';
import log from '../../../log/index.js';

// Test fixture credentials - not real secrets
const TEST_TOKEN = 'token'; // NOSONAR

vi.mock('axios');
axios.mockImplementation(() => ({
    token: TEST_TOKEN,
}));

const quay = new Quay();
quay.configuration = {
    namespace: 'namespace',
    account: 'account',
    token: TEST_TOKEN,
};
quay.log = log;

test('validatedConfiguration should initialize when anonymous configuration is valid', async () => {
    expect(quay.validateConfiguration('')).toStrictEqual({});
    expect(quay.validateConfiguration(undefined)).toStrictEqual({});
});

test('validatedConfiguration should initialize when auth configuration is valid', async () => {
    expect(
        quay.validateConfiguration({
            namespace: 'namespace',
            account: 'account',
            token: TEST_TOKEN,
        }),
    ).toStrictEqual({
        namespace: 'namespace',
        account: 'account',
        token: TEST_TOKEN,
    });
});

test('validatedConfiguration should throw error when configuration is missing', async () => {
    expect(() => {
        quay.validateConfiguration({});
    }).toThrow('"namespace" is required');
});

test('maskConfiguration should mask anonymous configuration secrets', async () => {
    const quayInstance = new Quay();
    quayInstance.configuration = '';
    expect(quayInstance.maskConfiguration()).toEqual({});
});

test('maskConfiguration should mask authentication configuration secrets', async () => {
    expect(quay.maskConfiguration()).toEqual({
        account: 'account',
        namespace: 'namespace',
        token: 't***n',
    });
});

test('match should return true when registry url is from quay.io', async () => {
    expect(
        quay.match({
            registry: {
                url: 'quay.io',
            },
        }),
    ).toBeTruthy();
});

test('match should return false when registry url is not from quay.io', async () => {
    expect(
        quay.match({
            registry: {
                url: 'error.io',
            },
        }),
    ).toBeFalsy();
});

test('normalizeImage should return the proper registry v2 endpoint', async () => {
    expect(
        quay.normalizeImage({
            name: 'test/image',
            registry: {
                url: 'quay.io/test/image',
            },
        }),
    ).toStrictEqual({
        name: 'test/image',
        registry: {
            url: 'https://quay.io/test/image/v2',
        },
    });
});

test('getAuthCredentials should return undefined when anonymous configuration', async () => {
    const quayInstance = new Quay();
    quayInstance.configuration = {};
    expect(quayInstance.getAuthCredentials()).toEqual(undefined);
});

test('getAuthCredentials should return base64 encode credentials when auth configuration', async () => {
    const quayInstance = new Quay();
    quayInstance.configuration = {
        namespace: 'namespace',
        account: 'account',
        token: TEST_TOKEN,
    };
    expect(quayInstance.getAuthCredentials()).toEqual(
        'bmFtZXNwYWNlK2FjY291bnQ6dG9rZW4=',
    );
});

test('getAuthPull should return undefined when anonymous configuration', async () => {
    const quayInstance = new Quay();
    quayInstance.configuration = {};
    await expect(quayInstance.getAuthPull()).resolves.toEqual(undefined);
});

test('getAuthPull should return credentials when auth configuration', async () => {
    const quayInstance = new Quay();
    quayInstance.configuration = {
        namespace: 'namespace',
        account: 'account',
        token: TEST_TOKEN,
    };
    await expect(quayInstance.getAuthPull()).resolves.toEqual({
        password: TEST_TOKEN,
        username: 'namespace+account',
    });
});

test('authenticate should populate header with base64 bearer', async () => {
    expect(quay.authenticate({}, { headers: {} })).resolves.toEqual({
        headers: {
            Authorization: `Bearer ${TEST_TOKEN}`,
        },
    });
});

test('authenticate should not populate header with base64 bearer when anonymous', async () => {
    const quayInstance = new Quay();
    quayInstance.configuration = {};
    expect(quayInstance.authenticate({}, { headers: {} })).resolves.toEqual({
        headers: {},
    });
});

test('authenticate should log warning when axios throws an error', async () => {
    axios.mockImplementationOnce(() => {
        throw new Error('Network error');
    });
    const quayInstance = new Quay();
    quayInstance.configuration = {
        namespace: 'namespace',
        account: 'account',
        token: TEST_TOKEN,
    };
    quayInstance.log = { warn: vi.fn() };
    const result = await quayInstance.authenticate(
        { name: 'test/image' },
        { headers: {} },
    );
    expect(quayInstance.log.warn).toHaveBeenCalledWith(
        'Error when trying to get an access token (Network error)',
    );
    // Token is undefined so no Authorization header should be set
    expect(result).toEqual({ headers: {} });
});

test('getTagsPage should call registry with default pagination', async () => {
    const quayInstance = new Quay();
    quayInstance.configuration = {};
    quayInstance.callRegistry = vi.fn().mockResolvedValue({ data: { tags: [] } });
    await quayInstance.getTagsPage(
        { name: 'test/image', registry: { url: 'https://quay.io/v2' } },
        undefined,
        undefined,
    );
    expect(quayInstance.callRegistry).toHaveBeenCalledWith({
        image: { name: 'test/image', registry: { url: 'https://quay.io/v2' } },
        url: 'https://quay.io/v2/test/image/tags/list?n=1000',
        resolveWithFullResponse: true,
    });
});

test('getTagsPage should handle link with next_page parameter', async () => {
    const quayInstance = new Quay();
    quayInstance.configuration = {};
    quayInstance.callRegistry = vi.fn().mockResolvedValue({ data: { tags: [] } });
    await quayInstance.getTagsPage(
        { name: 'test/image', registry: { url: 'https://quay.io/v2' } },
        'sometag',
        '/v2/test/image/tags/list?next_page=abc123',
    );
    expect(quayInstance.callRegistry).toHaveBeenCalledWith({
        image: { name: 'test/image', registry: { url: 'https://quay.io/v2' } },
        url: 'https://quay.io/v2/test/image/tags/list?n=1000&next_page=abc123',
        resolveWithFullResponse: true,
    });
});

test('getTagsPage should handle link with last parameter', async () => {
    const quayInstance = new Quay();
    quayInstance.configuration = {};
    quayInstance.callRegistry = vi.fn().mockResolvedValue({ data: { tags: [] } });
    await quayInstance.getTagsPage(
        { name: 'test/image', registry: { url: 'https://quay.io/v2' } },
        'sometag',
        '</v2/test/image/tags/list?last=xyz789>; rel="next"',
    );
    expect(quayInstance.callRegistry).toHaveBeenCalledWith({
        image: { name: 'test/image', registry: { url: 'https://quay.io/v2' } },
        url: 'https://quay.io/v2/test/image/tags/list?n=1000&last=xyz789',
        resolveWithFullResponse: true,
    });
});

test('getTagsPage should handle link with no matching pattern', async () => {
    const quayInstance = new Quay();
    quayInstance.configuration = {};
    quayInstance.callRegistry = vi.fn().mockResolvedValue({ data: { tags: [] } });
    await quayInstance.getTagsPage(
        { name: 'test/image', registry: { url: 'https://quay.io/v2' } },
        'sometag',
        'some-unrecognized-link-format',
    );
    expect(quayInstance.callRegistry).toHaveBeenCalledWith({
        image: { name: 'test/image', registry: { url: 'https://quay.io/v2' } },
        url: 'https://quay.io/v2/test/image/tags/list?n=1000',
        resolveWithFullResponse: true,
    });
});
