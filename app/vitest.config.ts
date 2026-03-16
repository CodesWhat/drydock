import { defineConfig } from 'vitest/config';

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
  // Use v8 coverage with a small wrapper that avoids a Vitest temp-dir race.
  provider: 'custom',
  customProviderModule: './vitest.coverage-provider.ts',
  reporter: ['text', 'lcov', 'html'],
  include: ['**/*.{js,ts}'],
  exclude: [
    '**/node_modules/**',
    '**/dist/**',
    '**/coverage/**',
    '**/package.json',
    '**/*.d.ts',
    '**/*.typecheck.ts',
    'vitest.config.ts',
    'vitest.coverage-provider.ts',
  ],
  thresholds: {
    lines: 100,
    branches: 100,
    functions: 100,
    statements: 100,
  },
};

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Coverage writes can race with clean-up; keep file execution serial.
    fileParallelism: false,
    exclude: ['**/node_modules/**', '**/dist/**'],
    server: {
      deps: {
        inline: ['openid-client', 'oauth4webapi', 'jose'],
      },
    },
    coverage: coverageConfig,
  },
});
