import Codeberg from './Codeberg.js';

// Test fixture credentials - not real secrets
const TEST_PASS = 'pass';

const codeberg = new Codeberg();
codeberg.configuration = {
  url: 'https://codeberg.org',
};

test('init should set codeberg url', async () => {
  const cb = new Codeberg();
  cb.configuration = {};
  cb.init();
  expect(cb.configuration.url).toBe('https://codeberg.org');
});

test('normalizeImage should return the proper registry v2 endpoint', async () => {
  expect(
    codeberg.normalizeImage({
      name: 'test/image',
      registry: {
        url: 'codeberg.org/test/image',
      },
    }),
  ).toStrictEqual({
    name: 'test/image',
    registry: {
      url: 'https://codeberg.org/v2',
    },
  });
});

test('init should handle string configuration by resetting to object', async () => {
  const cb = new Codeberg();
  cb.configuration = 'some-string';
  cb.init();
  expect(cb.configuration).toEqual({ url: 'https://codeberg.org' });
});

test('init should handle undefined configuration', async () => {
  const cb = new Codeberg();
  cb.configuration = undefined;
  cb.init();
  expect(cb.configuration).toEqual({ url: 'https://codeberg.org' });
});

test('getConfigurationSchema should accept empty string', async () => {
  const cb = new Codeberg();
  expect(() => cb.validateConfiguration('')).not.toThrow();
});

test('getConfigurationSchema should accept login/password combo', async () => {
  const cb = new Codeberg();
  expect(() =>
    cb.validateConfiguration({
      login: 'user',
      password: TEST_PASS,
    }),
  ).not.toThrow();
});
