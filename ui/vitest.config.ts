import { fileURLToPath, URL } from 'node:url';
import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

interface CoverageThresholds {
  lines: number;
  branches: number;
  functions: number;
  statements: number;
}

interface CustomCoverageConfig {
  provider: 'custom';
  customProviderModule: string;
  reporter: string[];
  include: string[];
  exclude: string[];
  thresholds: Record<'src/**/*.ts' | 'src/**/*.vue', CoverageThresholds>;
}

// Coverage globs are matched against absolute paths, so a bare 'src/**' also matches
// ui/tests/helpers when the checkout itself lives under a directory named src.
// Anchoring the includes to this directory keeps the gate independent of the checkout path.
const uiRoot = fileURLToPath(new URL('.', import.meta.url)).replace(/\/$/, '');
const escapedUiRoot = uiRoot.replace(/[\\()[\]{}!*?+@|]/g, '\\$&');

const coverageConfig: CustomCoverageConfig = {
  provider: 'custom',
  customProviderModule: './vitest.coverage-provider.ts',
  reporter: ['text', 'lcov', 'html', 'json-summary'],
  include: [`${escapedUiRoot}/src/**/*.ts`, `${escapedUiRoot}/src/**/*.vue`],
  exclude: ['**/*.typecheck.ts', '**/*.d.ts', '**/types/**', '**/node_modules/**'],
  thresholds: {
    'src/**/*.ts': {
      lines: 100,
      branches: 100,
      functions: 100,
      statements: 100,
    },
    'src/**/*.vue': {
      lines: 87.89,
      branches: 81.57,
      functions: 84.39,
      statements: 87.54,
    },
  },
};

export default mergeConfig(
  viteConfig,
  defineConfig({
    server: {
      port: 0,
      hmr: false,
    },
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
      fileParallelism: false,
      setupFiles: ['./tests/setup.ts'],
      include: ['tests/**/*.spec.ts'],
      css: true,
      transformMode: {
        web: [/\.vue$/],
      },
      coverage: coverageConfig,
    },
  }),
);
