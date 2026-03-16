import { describe, expect, test } from 'vitest';
import config from './vitest.config.js';

describe('vitest coverage configuration', () => {
  test('coverage excludes only infrastructure and declaration files', () => {
    const exclude = config.test?.coverage?.exclude ?? [];
    expect(exclude).toEqual([
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/package.json',
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
      'vitest.config.ts',
      'vitest.coverage-provider.ts',
    ]);
  });
});
