const HOMARR_ICONS_REVISION = '46b860c70e866212311aef2f98da3775c17f5068';
const SELFHST_ICONS_REVISION = '47eb6b11d006d7708fad53f4893048c0d515117a';
const SIMPLE_ICONS_VERSION = '16.21.0';

const providers = {
  homarr: {
    extension: 'png',
    url: (slug: string) =>
      `https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@${HOMARR_ICONS_REVISION}/png/${slug}.png`,
    contentType: 'image/png',
  },
  selfhst: {
    extension: 'png',
    url: (slug: string) =>
      `https://cdn.jsdelivr.net/gh/selfhst/icons@${SELFHST_ICONS_REVISION}/png/${slug}.png`,
    contentType: 'image/png',
  },
  simple: {
    extension: 'svg',
    url: (slug: string) =>
      `https://cdn.jsdelivr.net/npm/simple-icons@${SIMPLE_ICONS_VERSION}/icons/${slug}.svg`,
    contentType: 'image/svg+xml',
  },
} as const;

const BUNDLED_ICON_PROVIDERS = new Set(['selfhst']);

function normalizeSlug(slug: string, extension: string): string {
  const slugNormalized = slug.toLowerCase();
  const suffix = `.${extension}`;
  if (slugNormalized.endsWith(suffix)) {
    return slugNormalized.slice(0, -suffix.length);
  }
  return slugNormalized;
}

const providerNames = Object.keys(providers);

export { BUNDLED_ICON_PROVIDERS, normalizeSlug, providerNames, providers };
