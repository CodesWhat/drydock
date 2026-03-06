const providers = {
  homarr: {
    extension: 'png',
    url: (slug: string) =>
      `https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/png/${slug}.png`,
    contentType: 'image/png',
  },
  selfhst: {
    extension: 'png',
    url: (slug: string) => `https://cdn.jsdelivr.net/gh/selfhst/icons/png/${slug}.png`,
    contentType: 'image/png',
  },
  simple: {
    extension: 'svg',
    url: (slug: string) => `https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/${slug}.svg`,
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
