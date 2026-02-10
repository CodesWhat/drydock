// @ts-nocheck
import Dhi from './Dhi.js';

// Test fixture credentials - not real secrets
const TEST_TOKEN = 'mytoken'; // NOSONAR
const TEST_PASSWORD = 'testpass'; // NOSONAR
const TEST_TOKEN_ALT = 'testtoken'; // NOSONAR

// Mock axios
vi.mock('axios', () => ({ default: vi.fn() }));

describe('DHI Registry', () => {
    let dhi;

    beforeEach(async () => {
        dhi = new Dhi();
        await dhi.register('registry', 'dhi', 'test', {});
        vi.clearAllMocks();
    });

    test('should create instance', async () => {
        expect(dhi).toBeDefined();
        expect(dhi).toBeInstanceOf(Dhi);
    });

    test('should have correct registry url after init', async () => {
        expect(dhi.configuration.url).toBe('https://dhi.io');
    });

    test('should match dhi registry', async () => {
        expect(dhi.match({ registry: { url: 'dhi.io' } })).toBe(true);
        expect(dhi.match({ registry: { url: 'sub.dhi.io' } })).toBe(true);
        expect(dhi.match({ registry: { url: 'docker.io' } })).toBe(false);
    });

    test('should normalize image url without adding library prefix', async () => {
        const image = { name: 'python', registry: {} };
        const normalized = dhi.normalizeImage(image);
        expect(normalized.name).toBe('python');
        expect(normalized.registry.url).toBe('https://dhi.io/v2');
    });

    test('should initialize with token as password', async () => {
        const dhiWithToken = new Dhi();
        await dhiWithToken.register('registry', 'dhi', 'test', {
            token: TEST_TOKEN,
        });
        expect(dhiWithToken.configuration.password).toBe(TEST_TOKEN);
    });

    test('should authenticate with credentials', async () => {
        const { default: axios } = await import('axios');
        axios.mockResolvedValue({ data: { token: 'auth-token' } }); // NOSONAR - test fixture, not a real credential

        dhi.getAuthCredentials = vi.fn().mockReturnValue('base64credentials');

        const image = { name: 'python' };
        const requestOptions = { headers: {} };

        const result = await dhi.authenticate(image, requestOptions);

        expect(axios).toHaveBeenCalledWith({
            method: 'GET',
            url: 'https://dhi.io/token?service=registry.docker.io&scope=repository:python:pull&grant_type=password',
            headers: {
                Accept: 'application/json',
                Authorization: 'Basic base64credentials', // NOSONAR - test fixture, not a real credential
            },
        });
        expect(result.headers.Authorization).toBe('Bearer auth-token');
    });

    test('should authenticate without credentials', async () => {
        const { default: axios } = await import('axios');
        axios.mockResolvedValue({ data: { token: 'public-token' } }); // NOSONAR - test fixture, not a real credential

        dhi.getAuthCredentials = vi.fn().mockReturnValue(null);

        const image = { name: 'python' };
        const requestOptions = { headers: {} };

        const result = await dhi.authenticate(image, requestOptions);

        expect(axios).toHaveBeenCalledWith({
            method: 'GET',
            url: 'https://dhi.io/token?service=registry.docker.io&scope=repository:python:pull&grant_type=password',
            headers: {
                Accept: 'application/json',
            },
        });
        expect(result.headers.Authorization).toBe('Bearer public-token');
    });

    test('should mask all configuration fields', async () => {
        dhi.configuration = {
            url: 'https://dhi.io',
            login: 'testuser',
            password: TEST_PASSWORD,
            token: TEST_TOKEN_ALT,
            auth: 'dGVzdDp0ZXN0',
        };
        const masked = dhi.maskConfiguration();
        expect(masked).toEqual({
            url: 'https://dhi.io',
            login: 'testuser',
            password: 't******s',
            token: 't*******n',
            auth: 'd**********0',
        });
    });
});
