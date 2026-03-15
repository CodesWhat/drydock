import { defineConfig } from 'vitest/config';

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
    coverage: {
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
    } as any,
  },
});
