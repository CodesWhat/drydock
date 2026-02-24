// @ts-nocheck
import axios from 'axios';
import Mau from './Mau.js';

const TEST_TOKEN = 'abcdef';

const mau = new Mau();
mau.configuration = {
  url: 'https://dock.mau.dev',
  authurl: 'https://dock.mau.dev',
  token: TEST_TOKEN,
};

vi.mock('axios');

test('validatedConfiguration should initialize when configuration is empty string', async () => {
  expect(mau.validateConfiguration('')).toStrictEqual({});
});

test('validatedConfiguration should initialize when configuration is valid', async () => {
  expect(
    mau.validateConfiguration({
      token: TEST_TOKEN,
    }),
  ).toStrictEqual({
    url: 'https://dock.mau.dev',
    authurl: 'https://dock.mau.dev',
    token: TEST_TOKEN,
  });
});

test('maskConfiguration should mask token', async () => {
  expect(mau.maskConfiguration()).toEqual({
    url: 'https://dock.mau.dev',
    authurl: 'https://dock.mau.dev',
    token: 'a****f',
  });
});

test('match should return true for dock.mau.dev', async () => {
  expect(
    mau.match({
      registry: {
        url: 'dock.mau.dev',
      },
    }),
  ).toBeTruthy();
});

test('match should return true for subdomains of dock.mau.dev', async () => {
  expect(
    mau.match({
      registry: {
        url: 'registry.dock.mau.dev',
      },
    }),
  ).toBeTruthy();
});

test('match should return false for other registries', async () => {
  expect(
    mau.match({
      registry: {
        url: 'registry.gitlab.com',
      },
    }),
  ).toBeFalsy();
});

test('match should return false and never throw when registry url is missing', async () => {
  expect(() => mau.match({ registry: { url: undefined } })).not.toThrow();
  expect(() => mau.match({})).not.toThrow();
  expect(mau.match({ registry: { url: undefined } })).toBe(false);
  expect(mau.match({})).toBe(false);
});

test('match should reject hostnames that bypass unescaped dot in regex', async () => {
  expect(mau.match({ registry: { url: 'dockXmauXdev' } })).toBe(false);
  expect(mau.match({ registry: { url: 'evil-dock.mau.dev.attacker.com' } })).toBe(false);
  expect(mau.match({ registry: { url: 'notdock.mau.dev' } })).toBe(false);
});

test('authenticate should perform request with token auth when token is configured', async () => {
  axios.mockImplementation(() => ({
    data: {
      token: 'token',
    },
  }));

  await expect(
    mau.authenticate(
      { name: 'team/image' },
      {
        headers: {},
      },
    ),
  ).resolves.toEqual({ headers: { Authorization: 'Bearer token' } });

  expect(axios).toHaveBeenCalledWith(
    expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: `Basic ${Buffer.from(`:${TEST_TOKEN}`, 'utf-8').toString('base64')}`,
      }),
    }),
  );
});

test('authenticate should omit basic auth when token is not configured', async () => {
  const mauPublic = new Mau();
  mauPublic.configuration = {
    url: 'https://dock.mau.dev',
    authurl: 'https://dock.mau.dev',
  };

  axios.mockImplementation(() => ({
    data: {
      token: 'public-token',
    },
  }));

  await expect(
    mauPublic.authenticate(
      { name: 'team/image' },
      {
        headers: {},
      },
    ),
  ).resolves.toEqual({ headers: { Authorization: 'Bearer public-token' } });

  expect(axios).toHaveBeenCalledWith(
    expect.objectContaining({
      headers: {
        Accept: 'application/json',
      },
    }),
  );
});

test('authenticate should throw when token endpoint returns empty response', async () => {
  axios.mockImplementation(() => ({
    data: {},
  }));

  await expect(
    mau.authenticate(
      { name: 'team/image' },
      {
        headers: {},
      },
    ),
  ).rejects.toThrow('does not contain token');
});

test('normalizeImage should return the proper registry v2 endpoint', async () => {
  expect(
    mau.normalizeImage({
      name: 'test/image',
      registry: {
        url: 'dock.mau.dev',
      },
    }),
  ).toStrictEqual({
    name: 'test/image',
    registry: {
      url: 'https://dock.mau.dev/v2',
    },
  });
});

test('getAuthPull should return undefined when no token is configured', async () => {
  const mauPublic = new Mau();
  mauPublic.configuration = {
    url: 'https://dock.mau.dev',
    authurl: 'https://dock.mau.dev',
  };
  await expect(mauPublic.getAuthPull()).resolves.toBeUndefined();
});

test('getAuthPull should return username/password when token is configured', async () => {
  await expect(mau.getAuthPull()).resolves.toEqual({
    username: '',
    password: TEST_TOKEN,
  });
});

test('init should default url/authurl when configuration is undefined', async () => {
  const mauDefault = new Mau();
  mauDefault.configuration = undefined;

  mauDefault.init();

  expect(mauDefault.configuration).toEqual({
    url: 'https://dock.mau.dev',
    authurl: 'https://dock.mau.dev',
  });
});

test('init should convert string configuration to object defaults', async () => {
  const mauString = new Mau();
  mauString.configuration = 'legacy-string-config';

  mauString.init();

  expect(mauString.configuration).toEqual({
    url: 'https://dock.mau.dev',
    authurl: 'https://dock.mau.dev',
  });
});
