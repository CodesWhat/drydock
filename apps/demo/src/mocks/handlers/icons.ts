import { HttpResponse, http } from 'msw';

/**
 * Icon proxy handler — mirrors the real backend's /api/icons/:provider/:slug
 * endpoint by redirecting to the jsDelivr CDN.
 *
 * For the selfhst provider, if the primary CDN returns 404, falls back to the
 * homarr dashboard-icons repo (same pattern the real backend uses for missing
 * icons). The Docker icon from selfhst is the final fallback.
 */

const CDN: Record<string, { url: (slug: string) => string; contentType: string }> = {
  selfhst: {
    url: (slug) => `https://cdn.jsdelivr.net/gh/selfhst/icons/png/${slug}.png`,
    contentType: 'image/png',
  },
  homarr: {
    url: (slug) => `https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/png/${slug}.png`,
    contentType: 'image/png',
  },
  simple: {
    url: (slug) => `https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/${slug}.svg`,
    contentType: 'image/svg+xml',
  },
};

const DOCKER_FALLBACK_URL = CDN.selfhst.url('docker');

async function tryFetch(url: string): Promise<Response | null> {
  try {
    const res = await fetch(url);
    if (res.ok) return res;
  } catch {
    /* network error — treat as miss */
  }
  return null;
}

export const iconHandlers = [
  http.get('/api/v1/icons/:provider/:slug', async ({ params }) => {
    const provider = params.provider as string;
    const slug = (params.slug as string).replace(/\.(png|svg)$/i, '');

    const config = CDN[provider];
    if (!config) {
      return new HttpResponse(null, { status: 400 });
    }

    // Try primary provider
    let upstream = await tryFetch(config.url(slug));
    let usedDockerFallback = false;

    // Selfhst miss → try homarr fallback
    if (!upstream && provider === 'selfhst') {
      upstream = await tryFetch(CDN.homarr.url(slug));
    }

    // Still nothing → Docker icon as final fallback
    if (!upstream) {
      upstream = await tryFetch(DOCKER_FALLBACK_URL);
      usedDockerFallback = upstream !== null;
    }

    if (!upstream) {
      return new HttpResponse(null, { status: 404 });
    }

    const buffer = await upstream.arrayBuffer();
    const contentType = upstream.headers.get('content-type') ?? config.contentType;

    return new HttpResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': usedDockerFallback ? 'no-store' : 'public, max-age=31536000, immutable',
      },
    });
  }),

  http.delete('/api/v1/icons/cache', () => HttpResponse.json({ cleared: 0 })),
];
