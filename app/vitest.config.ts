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
        // Orchestration-heavy paths validated via higher-level tests.
        'index.ts',
        'agent/AgentClient.ts',
        'agent/api/event.ts',
        'api/agent.ts',
        'api/auth.ts',
        'api/container.ts',
        'api/server.ts',
        'api/sse.ts',
        'configuration/migrate-cli.ts',
        'prometheus/compatibility.ts',
        'registries/providers/ecr/Ecr.ts',
        'registries/providers/ghcr/Ghcr.ts',
        'registry/index.ts',
        'security/auth.ts',
        'security/runtime.ts',
        'security/scheduler.ts',
        'store/container.ts',
        'store/update-operation.ts',
        'triggers/providers/docker/Docker.ts',
        'triggers/providers/docker/self-update-controller.ts',
        'triggers/providers/dockercompose/Dockercompose.ts',
        'triggers/providers/http/Http.ts',
        'watchers/providers/docker/Docker.ts',
        'vitest.config.ts',
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
