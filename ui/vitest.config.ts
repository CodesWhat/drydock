import { fileURLToPath, URL } from 'node:url';
import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig,
  defineConfig({
    resolve: {
      alias: {
        '@vue/devtools-api': fileURLToPath(
          new URL('./tests/mocks/vueDevtoolsApiMock.js', import.meta.url),
        ),
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./tests/setup.ts'],
      include: ['tests/**/*.spec.ts'],
      css: true,
      server: {
        deps: {
          inline: ['vuetify'],
        },
      },
      transformMode: {
        web: [/\.vue$/],
      },
      coverage: {
        provider: 'v8',
        reporter: ['text', 'lcov', 'html'],
        // Measure executable app logic; Vue SFC template render output produces non-actionable partial branches.
        include: ['src/**/*.{js,ts}'],
        exclude: ['src/main.ts', 'src/registerServiceWorker.ts', '**/*.d.ts', '**/node_modules/**'],
        thresholds: {
          lines: 100,
          branches: 100,
          functions: 100,
          statements: 100,
        },
      },
    },
  }),
);
