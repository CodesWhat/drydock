import { DEFAULT_WATCHER_PROVIDER, splitWatcherProvider } from './watcher-provider.js';

describe('splitWatcherProvider', () => {
  test('takes the provider off the configuration and normalizes it', () => {
    expect(splitWatcherProvider({ provider: ' File ', path: '/images.yml' })).toEqual({
      provider: 'file',
      configuration: { path: '/images.yml' },
    });
  });

  test.each([
    [{ socket: '/var/run/docker.sock' }],
    [{ provider: '', socket: 'x' }],
    [{ provider: '  ', socket: 'x' }],
    [{ provider: 5, socket: 'x' }],
  ])('keeps the docker default and the configuration untouched for %j', (configuration) => {
    const result = splitWatcherProvider(configuration);

    expect(result.provider).toBe(DEFAULT_WATCHER_PROVIDER);
    expect(result.configuration).toBe(configuration);
  });
});
