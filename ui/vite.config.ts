import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// workbox-routing tests a RegExpRoute's urlPattern against the FULL url.href
// (which always starts with "http://" or "https://"), never against the
// pathname alone — so a `^`-anchored pathname regex like /^\/api\// can never
// match and silently falls through to the next route. Use a match callback
// against url.pathname instead so this rule actually engages.
export const isApiRequest = ({ url }: { url: URL }): boolean => url.pathname.startsWith('/api/');

// Every path Express owns on the SPA's own origin. A top-level navigation to
// one of these has to reach the server, so the precached app shell must never
// answer it. Taken from the server's route table:
//
//   /api, /api/v1  REST API (app/api/index.ts), the SSE stream at
//                  /api/v1/events/ui, the agent websocket at /api/portwing/ws
//   /auth/...      login, logout, user and status (app/api/auth.ts), plus the
//                  per-provider OIDC pair /auth/oidc/<name>/redirect and
//                  /auth/oidc/<name>/cb (app/authentications/providers/oidc)
//   /health        readiness probe (app/api/index.ts)
//   /metrics       prometheus exposition (app/api/index.ts)
//
// Bare "/auth" is deliberately left out: that exact path is a SPA view
// (ui/src/router/routes.ts, ROUTES.AUTH) and Express owns only its subpaths,
// so the pattern requires the trailing slash.
//
// Unlike a RegExpRoute urlPattern (see isApiRequest above), workbox tests a
// NavigationRoute denylist against url.pathname + url.search, so anchoring on
// the path is correct here. The [/?] alternative is what lets a bare
// "/health?verbose=1" match without also matching "/healthcheck".
export const SERVER_OWNED_NAVIGATION_PATTERNS: RegExp[] = [
  /^\/api(?:[/?]|$)/,
  /^\/auth\//,
  /^\/health(?:[/?]|$)/,
  /^\/metrics(?:[/?]|$)/,
];

// Mirrors workbox NavigationRoute's own denylist loop so the patterns can be
// asserted against real callback URLs in tests.
export const isServerOwnedNavigation = (pathnameAndSearch: string): boolean =>
  SERVER_OWNED_NAVIGATION_PATTERNS.some((pattern) => pattern.test(pathnameAndSearch));

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
        // Drydock is a live dashboard — stale API data is worse than a
        // request failing outright, so /api is never handled by the SW,
        // neither for navigations nor for runtime fetches.
        //
        // The navigation fallback skips every other server-owned route too.
        // Answering /auth/oidc/<name>/cb with index.html meant the OIDC code
        // exchange never reached Express, so login bounced back to the login
        // page (#939). Those routes get no runtimeCaching rule on purpose:
        // with nothing matching, workbox never calls respondWith and the
        // browser performs the request itself, which keeps the callback's
        // redirect out of the service worker entirely.
        navigateFallbackDenylist: SERVER_OWNED_NAVIGATION_PATTERNS,
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
