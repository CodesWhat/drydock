// @ts-nocheck
import axios from 'axios';
import Ghcr from './Ghcr.js';

vi.mock('axios');

describe('GitHub Container Registry', () => {
  let ghcr;

  beforeEach(async () => {
    axios.mockReset();
    axios.mockResolvedValue({ data: { token: 'registry-token' } });
    ghcr = new Ghcr();
    await ghcr.register('registry', 'ghcr', 'test', {
      username: 'testuser',
      token: 'testtoken',
    });
  });

  test('should create instance', async () => {
    expect(ghcr).toBeDefined();
    expect(ghcr).toBeInstanceOf(Ghcr);
  });

  test('should match registry', async () => {
    expect(ghcr.match({ registry: { url: 'ghcr.io' } })).toBe(true);
    expect(ghcr.match({ registry: { url: 'docker.io' } })).toBe(false);
  });

  test('should normalize image name', async () => {
    const image = { name: 'user/repo', registry: { url: 'ghcr.io' } };
    const normalized = ghcr.normalizeImage(image);
    expect(normalized.name).toBe('user/repo');
    expect(normalized.registry.url).toBe('https://ghcr.io/v2');
  });

  test('should not modify URL if already starts with https', async () => {
    const image = {
      name: 'user/repo',
      registry: { url: 'https://ghcr.io/v2' },
    };
    const normalized = ghcr.normalizeImage(image);
    expect(normalized.registry.url).toBe('https://ghcr.io/v2');
  });

  test('should mask configuration token', async () => {
    ghcr.configuration = { username: 'testuser', token: 'secret_token' };
    const masked = ghcr.maskConfiguration();
    expect(masked.username).toBe('testuser');
    expect(masked.token).toBe('s**********n');
  });

  test('should return auth pull credentials', async () => {
    ghcr.configuration = { username: 'testuser', token: 'testtoken' };
    const auth = await ghcr.getAuthPull();
    expect(auth).toEqual({
      username: 'testuser',
      password: 'testtoken',
    });
  });

  test('should return undefined auth pull when no credentials', async () => {
    ghcr.configuration = {};
    const auth = await ghcr.getAuthPull();
    expect(auth).toBeUndefined();
  });

  test('should authenticate with token', async () => {
    ghcr.configuration = { username: 'test-user', token: 'test-token' };
    const image = { name: 'user/repo' };
    const requestOptions = { headers: {} };

    const result = await ghcr.authenticate(image, requestOptions);

    const expectedBasic = Buffer.from('test-user:test-token', 'utf-8').toString('base64');
    expect(axios).toHaveBeenCalledWith({
      method: 'GET',
      url: 'https://ghcr.io/token?service=ghcr.io&scope=repository%3Auser%2Frepo%3Apull',
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${expectedBasic}`,
      },
    });
    expect(result.headers.Authorization).toBe('Bearer registry-token');
  });

  test('should retry anonymously when configured credentials are rejected with 403', async () => {
    ghcr.configuration = { username: 'test-user', token: 'test-token' };
    axios.mockRejectedValueOnce(new Error('Request failed with status code 403'));
    axios.mockResolvedValueOnce({ data: { token: 'anon-token' } });
    const image = { name: 'user/repo' };
    const requestOptions = { headers: {} };
    const warnSpy = vi.spyOn(ghcr.log, 'warn');

    const result = await ghcr.authenticate(image, requestOptions);

    const expectedBasic = Buffer.from('test-user:test-token', 'utf-8').toString('base64');
    expect(axios).toHaveBeenNthCalledWith(1, {
      method: 'GET',
      url: 'https://ghcr.io/token?service=ghcr.io&scope=repository%3Auser%2Frepo%3Apull',
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${expectedBasic}`,
      },
    });
    expect(axios).toHaveBeenNthCalledWith(2, {
      method: 'GET',
      url: 'https://ghcr.io/token?service=ghcr.io&scope=repository%3Auser%2Frepo%3Apull',
      headers: {
        Accept: 'application/json',
      },
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('GHCR credentials were rejected for registry ghcr.test (status 403)'),
    );
    expect(result.headers.Authorization).toBe('Bearer anon-token');
  });

  test('should not retry anonymously when no credentials are configured', async () => {
    ghcr.configuration = {};
    axios.mockRejectedValueOnce(new Error('Request failed with status code 403'));
    const image = { name: 'user/repo' };
    const requestOptions = { headers: {} };

    await expect(ghcr.authenticate(image, requestOptions)).rejects.toThrow('status code 403');
    expect(axios).toHaveBeenCalledTimes(1);
  });

  test('should not retry anonymously for non-auth token failures', async () => {
    ghcr.configuration = { username: 'test-user', token: 'test-token' };
    axios.mockRejectedValueOnce(new Error('Request failed with status code 500'));
    const image = { name: 'user/repo' };
    const requestOptions = { headers: {} };

    await expect(ghcr.authenticate(image, requestOptions)).rejects.toThrow('status code 500');
    expect(axios).toHaveBeenCalledTimes(1);
  });

  test('should authenticate without token', async () => {
    ghcr.configuration = {};
    const image = { name: 'user/repo' };
    const requestOptions = { headers: {} };

    const result = await ghcr.authenticate(image, requestOptions);

    expect(axios).toHaveBeenCalledWith({
      method: 'GET',
      url: 'https://ghcr.io/token?service=ghcr.io&scope=repository%3Auser%2Frepo%3Apull',
      headers: {
        Accept: 'application/json',
      },
    });
    expect(result.headers.Authorization).toBe('Bearer registry-token');
  });

  test('should authenticate with token endpoint access_token field', async () => {
    ghcr.configuration = {};
    axios.mockResolvedValueOnce({ data: { access_token: 'access-token' } });
    const image = { name: 'user/repo' };
    const requestOptions = { headers: {} };

    const result = await ghcr.authenticate(image, requestOptions);

    expect(result.headers.Authorization).toBe('Bearer access-token');
  });

  test('should validate string configuration', async () => {
    expect(() => ghcr.validateConfiguration('')).not.toThrow();
    expect(() => ghcr.validateConfiguration('some-string')).not.toThrow();
  });

  test('should return undefined auth pull when missing username', async () => {
    ghcr.configuration = { token: 'test-token' };
    const auth = await ghcr.getAuthPull();
    expect(auth).toBeUndefined();
  });

  test('should return undefined auth pull when missing token', async () => {
    ghcr.configuration = { username: 'testuser' };
    const auth = await ghcr.getAuthPull();
    expect(auth).toBeUndefined();
  });
});
