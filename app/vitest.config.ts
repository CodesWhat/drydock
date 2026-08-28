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
  reporter: ['text', 'lcov', 'html', 'json-summary'],
  include: ['**/*.{js,ts}'],
  exclude: [
    '**/node_modules/**',
    '**/dist/**',
    '**/coverage/**',
    '**/.stryker-tmp/**',
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
    '**/api/container/update-age.ts',
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
    // No test-level retry (house standard: root-cause or quarantine, never
    // blind-retry). The cross-file flake this used to guard against
    // (store/index.test.ts, registry/index.test.ts) traced to
    // store/index.test.ts's 'node:fs' mock: it was swapped per test via
    // `vi.doMock('node:fs', () => createFsMock(overrides))` after
    // `vi.resetModules()`, so a freshly re-imported store/index.js could in
    // principle capture a stale/incomplete prior mock instead of the
    // just-registered one (symptom: renameSync asserted called 0 times — see
    // PR #417 / #436 history). Fixed by giving 'node:fs' one stable,
    // hoisted mock object for the whole file and reconfiguring its methods
    // in place instead of swapping the mocked module's identity — see
    // store/index.test.ts. Validated with 100+ shuffled/targeted full-suite
    // runs (with and without coverage) with retry removed and zero flakes.
    exclude: ['**/node_modules/**', '**/dist/**', '**/.stryker-tmp/**'],
    server: {
      deps: {
        inline: ['openid-client', 'oauth4webapi', 'jose'],
      },
    },
    coverage: coverageConfig,
  },
});
