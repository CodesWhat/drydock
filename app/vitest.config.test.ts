import { describe, expect, test } from 'vitest';
import config from './vitest.config.js';

describe('vitest coverage configuration', () => {
  test('coverage excludes only infra files and v8-uninstrumentable stubs', () => {
    const exclude = config.test?.coverage?.exclude ?? [];
    expect(exclude).toEqual([
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
    ]);
  });
});
