import { resolveComposeDependsOn } from './compose-dependency-resolver.js';

function makeParser(responses: Record<string, unknown>) {
  return {
    getComposeFileAsObject: vi.fn(async (filePath: string) => {
      const response = responses[filePath];
      if (response instanceof Error) {
        throw response;
      }
      return response;
    }),
  };
}

describe('resolveComposeDependsOn', () => {
  test('returns empty when the container has no compose service label', async () => {
    const result = await resolveComposeDependsOn({ labels: {} });
    expect(result).toEqual({ dependsOn: [], warnings: [] });
  });

  test('returns empty when the container has no labels at all', async () => {
    const result = await resolveComposeDependsOn({});
    expect(result).toEqual({ dependsOn: [], warnings: [] });
  });

  test('returns empty when the compose service label is present but no config_files label exists', async () => {
    const result = await resolveComposeDependsOn({
      labels: { 'com.docker.compose.service': 'web' },
    });
    expect(result).toEqual({ dependsOn: [], warnings: [] });
  });

  test('returns empty when the compose file has no matching service entry', async () => {
    const composeFileParser = makeParser({
      '/opt/stack/compose.yml': { services: { other: {} } },
    });
    const result = await resolveComposeDependsOn(
      {
        labels: {
          'com.docker.compose.service': 'web',
          'com.docker.compose.project.config_files': '/opt/stack/compose.yml',
        },
      },
      { composeFileParser },
    );
    expect(result).toEqual({ dependsOn: [], warnings: [] });
  });

  test('returns empty when the service defines no depends_on', async () => {
    const composeFileParser = makeParser({
      '/opt/stack/compose.yml': { services: { web: {} } },
    });
    const result = await resolveComposeDependsOn(
      {
        labels: {
          'com.docker.compose.service': 'web',
          'com.docker.compose.project.config_files': '/opt/stack/compose.yml',
        },
      },
      { composeFileParser },
    );
    expect(result).toEqual({ dependsOn: [], warnings: [] });
  });

  test('flattens short-form depends_on array', async () => {
    const composeFileParser = makeParser({
      '/opt/stack/compose.yml': {
        services: { web: { depends_on: ['db', 'redis'] }, db: {}, redis: {} },
      },
    });
    const result = await resolveComposeDependsOn(
      {
        labels: {
          'com.docker.compose.service': 'web',
          'com.docker.compose.project.config_files': '/opt/stack/compose.yml',
        },
      },
      { composeFileParser },
    );
    expect(result).toEqual({ dependsOn: ['db', 'redis'], warnings: [] });
  });

  test('flattens long-form depends_on object, ignoring condition', async () => {
    const composeFileParser = makeParser({
      '/opt/stack/compose.yml': {
        services: {
          web: { depends_on: { db: { condition: 'service_healthy' }, redis: {} } },
          db: {},
          redis: {},
        },
      },
    });
    const result = await resolveComposeDependsOn(
      {
        labels: {
          'com.docker.compose.service': 'web',
          'com.docker.compose.project.config_files': '/opt/stack/compose.yml',
        },
      },
      { composeFileParser },
    );
    expect(result).toEqual({ dependsOn: ['db', 'redis'], warnings: [] });
  });

  test('drops a self-referencing depends_on entry with a warning', async () => {
    const composeFileParser = makeParser({
      '/opt/stack/compose.yml': {
        services: { web: { depends_on: ['web', 'db'] }, db: {} },
      },
    });
    const result = await resolveComposeDependsOn(
      {
        labels: {
          'com.docker.compose.service': 'web',
          'com.docker.compose.project.config_files': '/opt/stack/compose.yml',
        },
      },
      { composeFileParser },
    );
    expect(result.dependsOn).toEqual(['db']);
    expect(result.warnings).toEqual([
      'Compose service "web" lists itself in "depends_on" (/opt/stack/compose.yml) — self-reference dropped.',
    ]);
  });

  test('drops a depends_on entry referencing an unknown service with a warning', async () => {
    const composeFileParser = makeParser({
      '/opt/stack/compose.yml': {
        services: { web: { depends_on: ['db', 'ghost'] }, db: {} },
      },
    });
    const result = await resolveComposeDependsOn(
      {
        labels: {
          'com.docker.compose.service': 'web',
          'com.docker.compose.project.config_files': '/opt/stack/compose.yml',
        },
      },
      { composeFileParser },
    );
    expect(result.dependsOn).toEqual(['db']);
    expect(result.warnings).toEqual([
      'Compose service "web" depends on unknown service "ghost" not defined in /opt/stack/compose.yml — edge dropped.',
    ]);
  });

  test('resolves relative compose file paths against the working_dir label', async () => {
    const composeFileParser = makeParser({
      '/opt/stack/compose.yml': { services: { web: { depends_on: ['db'] }, db: {} } },
    });
    const result = await resolveComposeDependsOn(
      {
        labels: {
          'com.docker.compose.service': 'web',
          'com.docker.compose.project.config_files': 'compose.yml',
          'com.docker.compose.project.working_dir': '/opt/stack',
        },
      },
      { composeFileParser },
    );
    expect(result.dependsOn).toEqual(['db']);
  });

  test('leaves an absolute compose file path untouched even with a working_dir label', async () => {
    const composeFileParser = makeParser({
      '/opt/stack/compose.yml': { services: { web: { depends_on: ['db'] }, db: {} } },
    });
    const result = await resolveComposeDependsOn(
      {
        labels: {
          'com.docker.compose.service': 'web',
          'com.docker.compose.project.config_files': '/opt/stack/compose.yml',
          'com.docker.compose.project.working_dir': '/somewhere/else',
        },
      },
      { composeFileParser },
    );
    expect(result.dependsOn).toEqual(['db']);
  });

  test('falls through to the next config file when the first fails to parse', async () => {
    const composeFileParser = makeParser({
      '/opt/stack/broken.yml': new Error('boom'),
      '/opt/stack/compose.yml': { services: { web: { depends_on: ['db'] }, db: {} } },
    });
    const result = await resolveComposeDependsOn(
      {
        labels: {
          'com.docker.compose.service': 'web',
          'com.docker.compose.project.config_files': '/opt/stack/broken.yml,/opt/stack/compose.yml',
        },
      },
      { composeFileParser },
    );
    expect(result.dependsOn).toEqual(['db']);
    expect(result.warnings).toEqual([
      'Unable to read compose file "/opt/stack/broken.yml" for dependency detection of service "web"',
    ]);
  });

  test('returns empty with a warning when every config file fails to parse', async () => {
    const composeFileParser = makeParser({
      '/opt/stack/broken.yml': new Error('boom'),
    });
    const result = await resolveComposeDependsOn(
      {
        labels: {
          'com.docker.compose.service': 'web',
          'com.docker.compose.project.config_files': '/opt/stack/broken.yml',
        },
      },
      { composeFileParser },
    );
    expect(result).toEqual({
      dependsOn: [],
      warnings: [
        'Unable to read compose file "/opt/stack/broken.yml" for dependency detection of service "web"',
      ],
    });
  });

  test('ignores blank entries in a comma-separated config_files label', async () => {
    const composeFileParser = makeParser({
      '/opt/stack/compose.yml': { services: { web: { depends_on: ['db'] }, db: {} } },
    });
    const result = await resolveComposeDependsOn(
      {
        labels: {
          'com.docker.compose.service': 'web',
          'com.docker.compose.project.config_files': ' ,/opt/stack/compose.yml, ',
        },
      },
      { composeFileParser },
    );
    expect(result.dependsOn).toEqual(['db']);
  });

  test('treats a non-array/non-object depends_on value as empty', async () => {
    const composeFileParser = makeParser({
      '/opt/stack/compose.yml': { services: { web: { depends_on: 'db' }, db: {} } },
    });
    const result = await resolveComposeDependsOn(
      {
        labels: {
          'com.docker.compose.service': 'web',
          'com.docker.compose.project.config_files': '/opt/stack/compose.yml',
        },
      },
      { composeFileParser },
    );
    expect(result).toEqual({ dependsOn: [], warnings: [] });
  });

  test('resolves a depends_on target declared only in a later overlay file (multi-file compose merge)', async () => {
    const composeFileParser = makeParser({
      '/opt/stack/base.yml': { services: { web: { depends_on: ['db'] } } },
      '/opt/stack/overlay.yml': { services: { db: {} } },
    });
    const result = await resolveComposeDependsOn(
      {
        labels: {
          'com.docker.compose.service': 'web',
          'com.docker.compose.project.config_files': '/opt/stack/base.yml,/opt/stack/overlay.yml',
        },
      },
      { composeFileParser },
    );
    expect(result).toEqual({ dependsOn: ['db'], warnings: [] });
  });

  test('picks up a depends_on entry added to the service by a later overlay file', async () => {
    const composeFileParser = makeParser({
      '/opt/stack/base.yml': { services: { web: {}, db: {} } },
      '/opt/stack/overlay.yml': { services: { web: { depends_on: ['db'] } } },
    });
    const result = await resolveComposeDependsOn(
      {
        labels: {
          'com.docker.compose.service': 'web',
          'com.docker.compose.project.config_files': '/opt/stack/base.yml,/opt/stack/overlay.yml',
        },
      },
      { composeFileParser },
    );
    expect(result).toEqual({ dependsOn: ['db'], warnings: [] });
  });

  test('unions depends_on entries when both base and overlay declare them for the same service', async () => {
    const composeFileParser = makeParser({
      '/opt/stack/base.yml': { services: { web: { depends_on: ['db'] }, db: {} } },
      '/opt/stack/overlay.yml': { services: { web: { depends_on: ['cache'] }, cache: {} } },
    });
    const result = await resolveComposeDependsOn(
      {
        labels: {
          'com.docker.compose.service': 'web',
          'com.docker.compose.project.config_files': '/opt/stack/base.yml,/opt/stack/overlay.yml',
        },
      },
      { composeFileParser },
    );
    expect(result).toEqual({ dependsOn: ['db', 'cache'], warnings: [] });
  });

  test('does not duplicate a depends_on target repeated across files', async () => {
    const composeFileParser = makeParser({
      '/opt/stack/base.yml': { services: { web: { depends_on: ['db'] }, db: {} } },
      '/opt/stack/overlay.yml': { services: { web: { depends_on: ['db'] } } },
    });
    const result = await resolveComposeDependsOn(
      {
        labels: {
          'com.docker.compose.service': 'web',
          'com.docker.compose.project.config_files': '/opt/stack/base.yml,/opt/stack/overlay.yml',
        },
      },
      { composeFileParser },
    );
    expect(result).toEqual({ dependsOn: ['db'], warnings: [] });
  });

  test('an unreadable middle config file still warns but does not prevent merging the surrounding files', async () => {
    const composeFileParser = makeParser({
      '/opt/stack/base.yml': { services: { web: { depends_on: ['db'] }, db: {} } },
      '/opt/stack/broken.yml': new Error('boom'),
      '/opt/stack/overlay.yml': { services: { web: { depends_on: ['cache'] }, cache: {} } },
    });
    const result = await resolveComposeDependsOn(
      {
        labels: {
          'com.docker.compose.service': 'web',
          'com.docker.compose.project.config_files':
            '/opt/stack/base.yml,/opt/stack/broken.yml,/opt/stack/overlay.yml',
        },
      },
      { composeFileParser },
    );
    expect(result.dependsOn).toEqual(['db', 'cache']);
    expect(result.warnings).toEqual([
      'Unable to read compose file "/opt/stack/broken.yml" for dependency detection of service "web"',
    ]);
  });

  test('uses the default ComposeFileParser instance when none is injected', async () => {
    const result = await resolveComposeDependsOn({
      labels: {
        'com.docker.compose.service': 'web',
        'com.docker.compose.project.config_files': '/nonexistent/compose.yml',
      },
    });
    expect(result.dependsOn).toEqual([]);
    expect(result.warnings).toEqual([
      'Unable to read compose file "/nonexistent/compose.yml" for dependency detection of service "web"',
    ]);
  });
});
