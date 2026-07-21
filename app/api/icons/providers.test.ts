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

  test('pins every runtime icon URL to an immutable upstream revision', () => {
    expect(providers.homarr.url('docker')).toBe(
      'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@46b860c70e866212311aef2f98da3775c17f5068/png/docker.png',
    );
    expect(providers.selfhst.url('docker')).toBe(
      'https://cdn.jsdelivr.net/gh/selfhst/icons@47eb6b11d006d7708fad53f4893048c0d515117a/png/docker.png',
    );
    expect(providers.simple.url('docker')).toBe(
      'https://cdn.jsdelivr.net/npm/simple-icons@16.21.0/icons/docker.svg',
    );

    expect(Object.values(providers).map((provider) => provider.url('docker'))).not.toContainEqual(
      expect.stringContaining('@latest'),
    );
  });
});
