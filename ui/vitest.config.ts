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
      transformMode: {
        web: [/\.vue$/],
      },
      coverage: {
        provider: 'v8',
        reporter: ['text', 'lcov', 'html'],
        // Gate coverage on unit-tested runtime logic (services + core composables).
        include: [
          'src/services/**/*.ts',
          'src/composables/useTheme.ts',
          'src/composables/useFont.ts',
          'src/composables/useIcons.ts',
        ],
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
