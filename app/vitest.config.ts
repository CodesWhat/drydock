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
    '**/*.d.ts',
    '**/*.typecheck.ts',
    '**/auth-types.ts',
    '**/api/openapi.ts',
    '**/api/openapi/index.ts',
    '**/release-notes/types.ts',
    '**/webhooks/parsers/types.ts',
    '**/registries/providers/artifactory/Artifactory.ts',
    '**/registries/providers/forgejo/Forgejo.ts',
    '**/registries/providers/gitea/Gitea.ts',
    '**/registries/providers/harbor/Harbor.ts',
    '**/registries/providers/nexus/Nexus.ts',
    '**/registries/providers/trueforge/Trueforge.ts',
    '**/api/container/query-values.ts',
    '**/api/container/sorting.ts',
    '**/api/container/update-age.ts',
    '**/test/mock-factories.ts',
    '**/*.test.helpers.ts',
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
    exclude: ['**/node_modules/**', '**/dist/**', '**/.stryker-tmp/**'],
    server: {
      deps: {
        inline: ['openid-client', 'oauth4webapi', 'jose'],
      },
    },
    coverage: coverageConfig,
  },
});
