import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    exclude: ['**/node_modules/**', '**/dist/**'],
    server: {
      deps: {
        inline: ['openid-client', 'oauth4webapi', 'jose'],
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['**/*.{js,ts}'],
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/coverage/**',
        '**/*.typecheck.ts',
        'vitest.config.ts',
        'model/audit.ts',
        'model/backup.ts',
        'watchers/Watcher.ts',
        'triggers/providers/docker/self-update-types.ts',
        'registries/providers/artifactory/Artifactory.ts',
        'registries/providers/forgejo/Forgejo.ts',
        'registries/providers/gitea/Gitea.ts',
        'registries/providers/harbor/Harbor.ts',
        'registries/providers/nexus/Nexus.ts',
      ],
      thresholds: {
        lines: 100,
        branches: 100,
        functions: 100,
        statements: 100,
      },
    },
  },
});
