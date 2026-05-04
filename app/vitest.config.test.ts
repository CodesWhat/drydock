import { describe, expect, test } from 'vitest';
import config from './vitest.config.js';

describe('vitest coverage configuration', () => {
  test('coverage excludes only infrastructure and declaration files', () => {
    const exclude = config.test?.coverage?.exclude ?? [];
    expect(exclude).toEqual([
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
      '**/registries/providers/trueforge/Trueforge.ts',
      '**/api/container/query-values.ts',
      '**/api/container/sorting.ts',
      '**/api/container/update-age.ts',
      '**/test/mock-factories.ts',
      '**/*.test.helpers.ts',
      'vitest.config.ts',
      'vitest.coverage-provider.ts',
    ]);
  });

  test('keeps SSE constants in coverage through API module imports', () => {
    const include = config.test?.coverage?.include ?? [];
    const exclude = config.test?.coverage?.exclude ?? [];

    expect(include).toContain('**/*.{js,ts}');
    expect(exclude).not.toContain('**/api/sse-constants.ts');
    expect(exclude).not.toContain('app/api/sse-constants.ts');
  });
});
