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
  thresholds: CoverageThresholds;
}

const coverageConfig: CustomCoverageConfig = {
  provider: 'custom',
  customProviderModule: './vitest.coverage-provider.ts',
  reporter: ['text', 'lcov', 'html', 'json-summary'],
  include: ['src/**/*.ts'],
  exclude: ['**/*.typecheck.ts', '**/*.d.ts', '**/types/**', '**/node_modules/**'],
  thresholds: {
    lines: 100,
    branches: 100,
    functions: 100,
    statements: 100,
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
