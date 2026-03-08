import axios from 'axios';
import Lscr from './Lscr.js';

vi.mock('axios');

let lscr;

beforeEach(() => {
  axios.mockReset();
  axios.mockResolvedValue({ data: { token: 'xxxxx' } });
  lscr = new Lscr();
  lscr.configuration = {
    username: 'user',
    token: 'token',
  };
});

test('validatedConfiguration should initialize when auth configuration is valid', async () => {
  expect(
    lscr.validateConfiguration({
      username: 'user',
      token: 'token',
    }),
  ).toStrictEqual({
    username: 'user',
    token: 'token',
  });
});

test('validatedConfiguration should initialize when anonymous configuration is valid', async () => {
  expect(lscr.validateConfiguration('')).toStrictEqual({});
  expect(lscr.validateConfiguration(undefined)).toStrictEqual({});
});

test('validatedConfiguration should throw error when configuration is missing', async () => {
  expect(() => {
    lscr.validateConfiguration({});
  }).toThrow();
});

test('match should return true when registry url is from lscr', async () => {
  expect(
    lscr.match({
      registry: {
        url: 'lscr.io',
      },
    }),
  ).toBeTruthy();
});

test('match should return false when registry url is not from lscr', async () => {
  expect(
    lscr.match({
      registry: {
        url: 'wrong.io',
      },
    }),
  ).toBeFalsy();
});

test('normalizeImage should return the proper registry v2 endpoint', async () => {
  expect(
    lscr.normalizeImage({
      name: 'test/image',
      registry: {
        url: 'lscr.io/test/image',
      },
    }),
  ).toStrictEqual({
    name: 'test/image',
    registry: {
      url: 'https://lscr.io/test/image/v2',
    },
  });
});

test('should authenticate against ghcr.io token endpoint for lscr.io images', async () => {
  lscr.configuration = { username: 'test-user', token: 'test-token' };
  const image = { name: 'linuxserver/sonarr' };
  const requestOptions = {
    headers: {},
    url: 'https://lscr.io/v2/linuxserver/sonarr/manifests/latest',
  };

  const result = await lscr.authenticate(image, requestOptions);

  const expectedBasic = Buffer.from('test-user:test-token', 'utf-8').toString('base64');
  expect(axios).toHaveBeenCalledWith({
    method: 'GET',
    url: 'https://ghcr.io/token?service=ghcr.io&scope=repository%3Alinuxserver%2Fsonarr%3Apull',
    headers: {
      Accept: 'application/json',
      Authorization: `Basic ${expectedBasic}`,
    },
  });
  expect(result.headers.Authorization).toBe('Bearer xxxxx');
});
