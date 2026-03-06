import { BUNDLED_ICON_PROVIDERS, normalizeSlug, providerNames, providers } from './providers.js';

describe('icons/providers', () => {
  test('normalizes slug to lowercase and strips matching extension suffix', () => {
    expect(normalizeSlug('Docker.SVG', 'svg')).toBe('docker');
    expect(normalizeSlug('Docker.png', 'svg')).toBe('docker.png');
  });

  test('exposes expected provider names', () => {
    expect(providerNames).toEqual(['homarr', 'selfhst', 'simple']);
  });

  test('marks only selfhst provider as bundled by default', () => {
    expect(BUNDLED_ICON_PROVIDERS.has('selfhst')).toBe(true);
    expect(BUNDLED_ICON_PROVIDERS.has('simple')).toBe(false);
  });

  test('builds expected upstream URL for simple icons', () => {
    expect(providers.simple.url('docker')).toBe(
      'https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/docker.svg',
    );
  });
});
