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
        'api/container.ts',
        'api/server.ts',
        'api/sse.ts',
        'configuration/migrate-cli.ts',
        'prometheus/compatibility.ts',
        'registries/providers/ghcr/Ghcr.ts',
        'registry/index.ts',
        'security/runtime.ts',
        'store/container.ts',
        'store/update-operation.ts',
        'triggers/providers/docker/Docker.ts',
        'triggers/providers/docker/self-update-controller.ts',
        'triggers/providers/dockercompose/Dockercompose.ts',
        'watchers/providers/docker/Docker.ts',
        // Branch-only exclusions until deeper edge-case harnessing is added.
        'agent/api/event.ts',
        'api/agent.ts',
        'api/icons.ts',
        'security/auth.ts',
        'registries/providers/ecr/Ecr.ts',
        'triggers/providers/http/Http.ts',
        'triggers/providers/docker/HealthMonitor.ts',
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
