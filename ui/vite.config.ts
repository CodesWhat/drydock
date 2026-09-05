import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { ROUTES } from './src/router/routes';

// workbox-routing tests a RegExpRoute's urlPattern against the FULL url.href
// (which always starts with "http://" or "https://"), never against the
// pathname alone — so a `^`-anchored pathname regex like /^\/api\// can never
// match and silently falls through to the next route. Use a match callback
// against url.pathname instead so this rule actually engages.
export const isApiRequest = ({ url }: { url: URL }): boolean => url.pathname.startsWith('/api/');

// DR-102: the service worker's navigation fallback used to be a denylist
// (navigateFallbackDenylist: [/^\/api\//]) — a hand-maintained list that has to be
// updated by hand every time a new server-owned route is added, and gives the SPA
// fallback to anything the list doesn't yet know about. That was already incomplete:
// Express also owns /auth's OIDC subpaths, /health and /metrics (see #939, forward-ported
// separately as #1016 — a document navigation to any of them, e.g. the identity
// provider's /auth/oidc/<name>/cb redirect, was served index.html instead of reaching
// the server). An allowlist built directly from the router's own route table inverts
// the failure mode: only a path the SPA actually routes gets served index.html, so a
// new *server* route needs no change here at all, and a new *SPA* route is covered
// automatically because this is generated from ROUTES rather than a separate list
// someone has to remember to update in step. A route path segment starting with `:`
// (e.g. `:id` in CONTAINER_LOGS) becomes a `[^/]+` wildcard; every other segment is
// escaped and matched literally. Matched against `pathname + search` (see
// NavigationRoute's own doc comment), so the trailing slash and any query string used
// by the views (see the query param conventions documented in routes.ts) are both
// optional.
export function buildSpaNavigateFallbackPattern(routePath: string): RegExp {
  const segments = routePath.split('/').filter((segment) => segment.length > 0);
  const body = segments
    .map((segment) =>
      segment.startsWith(':') ? '[^/]+' : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    )
    .join('\\/');
  const pathPattern = segments.length > 0 ? `\\/${body}\\/?` : '\\/';
  return new RegExp(`^${pathPattern}(?:\\?.*)?$`);
}

export const navigateFallbackAllowlist: RegExp[] = Object.values(ROUTES).map(
  buildSpaNavigateFallbackPattern,
);

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    vue({
      template: {
        compilerOptions: {
          isCustomElement: (tag) => tag === 'iconify-icon',
        },
      },
    }),
    tailwindcss(),
    VitePWA({
      // Never let a stale precached shell pin users to an old UI: the new
      // service worker takes over and reloads open tabs automatically
      // instead of waiting on a manual "update available" prompt.
      registerType: 'autoUpdate',
      manifestFilename: 'site.webmanifest',
      includeAssets: ['favicon.ico', 'favicon-96x96.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Drydock',
        short_name: 'Drydock',
        description: 'Docker container update manager',
        display: 'standalone',
        // Matches --dd-bg from the One Dark default theme (src/theme/tokens.css).
        theme_color: '#282c34',
        background_color: '#282c34',
        icons: [
          {
            src: '/web-app-manifest-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/web-app-manifest-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/maskable-icon-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // DR-102: only a path the SPA router itself owns gets the offline app-shell
        // fallback; everything else (the REST API, /auth's OIDC subpaths, /health,
        // /metrics, and any future server route) reaches Express, matching what the
        // controller's own route table actually serves. See buildSpaNavigateFallbackPattern
        // above for how this is derived from routes.ts.
        navigateFallbackAllowlist,
        runtimeCaching: [
          {
            urlPattern: isApiRequest,
            handler: 'NetworkOnly',
          },
        ],
        // The main app chunk sits close to the default 2 MiB precache
        // cutoff; give it headroom so it doesn't silently drop out of the
        // precache manifest as the app grows.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
  ],

  resolve: {
    extensions: ['.vue', '.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json'],
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  server: {
    host: '0.0.0.0',
    port: 8080,
    proxy: {
      '^/api': {
        target: 'http://localhost:3333',
        changeOrigin: true,
      },
      '^/auth': {
        target: 'http://localhost:3333',
        changeOrigin: true,
      },
    },
  },

  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'framework', test: /[\\/]node_modules[\\/](vue|vue-router)[\\/]/ },
            { name: 'i18n', test: /[\\/]node_modules[\\/]vue-i18n[\\/]/ },
            { name: 'icons', test: /[\\/]node_modules[\\/]iconify-icon[\\/]/ },
            { name: 'vendor', test: /[\\/]node_modules[\\/]/ },
          ],
        },
      },
    },
  },

  define: {
    __VUE_OPTIONS_API__: false,
    __VUE_PROD_DEVTOOLS__: false,
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
  },
});
