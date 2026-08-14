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
        'Compose dependency detection for service "web" is disabled: none of the configured compose files could be read (tried: /opt/stack/broken.yml). If drydock is running in a container, verify the compose file\'s host path is bind-mounted into it.',
      ],
    });
  });

  test('adds one loud summary warning naming every path tried when every file across multiple config files fails to read', async () => {
    const composeFileParser = makeParser({
      '/opt/stack/broken-a.yml': new Error('boom-a'),
      '/opt/stack/broken-b.yml': new Error('boom-b'),
    });
    const result = await resolveComposeDependsOn(
      {
        labels: {
          'com.docker.compose.service': 'web',
          'com.docker.compose.project.config_files':
            '/opt/stack/broken-a.yml,/opt/stack/broken-b.yml',
        },
      },
      { composeFileParser },
    );
    expect(result.dependsOn).toEqual([]);
    expect(result.warnings).toEqual([
      'Unable to read compose file "/opt/stack/broken-a.yml" for dependency detection of service "web"',
      'Unable to read compose file "/opt/stack/broken-b.yml" for dependency detection of service "web"',
      'Compose dependency detection for service "web" is disabled: none of the configured compose files could be read (tried: /opt/stack/broken-a.yml, /opt/stack/broken-b.yml). If drydock is running in a container, verify the compose file\'s host path is bind-mounted into it.',
    ]);
  });

  describe('with a self-container identifier available (HOSTNAME set)', () => {
    let originalHostname: string | undefined;

    beforeEach(() => {
      originalHostname = process.env.HOSTNAME;
      process.env.HOSTNAME = 'drydock-self';
    });

    afterEach(() => {
      if (originalHostname === undefined) {
        delete process.env.HOSTNAME;
      } else {
        process.env.HOSTNAME = originalHostname;
      }
    });

    test('translates a host compose file path to its in-container path via self bind mounts before reading', async () => {
      // Drydock's own container was started with `-v /opt/stack:/host/opt/stack`
      // (HostConfig.Binds source=host path, destination=drydock's own internal
      // path) — the compose project label holds the HOST's view of the path
      // (`/opt/stack/compose.yml`), which only resolves once translated to
      // drydock's own internal `/host/opt/stack/compose.yml`.
      const composeFileParser = makeParser({
        '/host/opt/stack/compose.yml': {
          services: { web: { depends_on: ['db'] }, db: {} },
        },
      });
      const dockerApi = {
        getContainer: vi.fn(() => ({
          inspect: vi.fn().mockResolvedValue({
            HostConfig: { Binds: ['/opt/stack:/host/opt/stack'] },
          }),
        })),
      };
      const result = await resolveComposeDependsOn(
        {
          labels: {
            'com.docker.compose.service': 'web',
            'com.docker.compose.project.config_files': '/opt/stack/compose.yml',
          },
        },
        { composeFileParser, dockerApi },
      );
      expect(result).toEqual({ dependsOn: ['db'], warnings: [] });
      expect(composeFileParser.getComposeFileAsObject).toHaveBeenCalledWith(
        '/host/opt/stack/compose.yml',
      );
      expect(dockerApi.getContainer).toHaveBeenCalledWith('drydock-self');
    });

    test('leaves the path untouched and degrades gracefully when no bind mount matches (untranslatable path)', async () => {
      const composeFileParser = makeParser({
        '/opt/stack/compose.yml': new Error('ENOENT'),
      });
      const dockerApi = {
        getContainer: vi.fn(() => ({
          inspect: vi.fn().mockResolvedValue({
            HostConfig: { Binds: ['/opt/other-stack:/host/other-stack'] },
          }),
        })),
      };
      const result = await resolveComposeDependsOn(
        {
          labels: {
            'com.docker.compose.service': 'web',
            'com.docker.compose.project.config_files': '/opt/stack/compose.yml',
          },
        },
        { composeFileParser, dockerApi },
      );
      expect(result.dependsOn).toEqual([]);
      expect(result.warnings).toEqual([
        'Unable to read compose file "/opt/stack/compose.yml" for dependency detection of service "web"',
        'Compose dependency detection for service "web" is disabled: none of the configured compose files could be read (tried: /opt/stack/compose.yml). If drydock is running in a container, verify the compose file\'s host path is bind-mounted into it.',
      ]);
    });

    test('degrades gracefully (untranslated paths) when the self bind-mount inspect itself fails', async () => {
      const composeFileParser = makeParser({
        '/opt/stack/compose.yml': { services: { web: { depends_on: ['db'] }, db: {} } },
      });
      const dockerApi = {
        getContainer: vi.fn(() => ({
          inspect: vi.fn().mockRejectedValue(new Error('inspect failed')),
        })),
      };
      const result = await resolveComposeDependsOn(
        {
          labels: {
            'com.docker.compose.service': 'web',
            'com.docker.compose.project.config_files': '/opt/stack/compose.yml',
          },
        },
        { composeFileParser, dockerApi },
      );
      expect(result).toEqual({ dependsOn: ['db'], warnings: [] });
    });

    test('fetches self bind mounts at most once per dockerApi instance (cached across calls)', async () => {
      const composeFileParser = makeParser({
        '/host/opt/stack/compose.yml': { services: { web: {}, db: {} } },
      });
      const inspect = vi.fn().mockResolvedValue({
        HostConfig: { Binds: ['/opt/stack:/host/opt/stack'] },
      });
      const dockerApi = {
        getContainer: vi.fn(() => ({ inspect })),
      };
      const containerRef = {
        labels: {
          'com.docker.compose.service': 'web',
          'com.docker.compose.project.config_files': '/opt/stack/compose.yml',
        },
      };
      await resolveComposeDependsOn(containerRef, { composeFileParser, dockerApi });
      await resolveComposeDependsOn(containerRef, { composeFileParser, dockerApi });
      expect(inspect).toHaveBeenCalledTimes(1);
    });
  });

  test('does not attempt bind-mount translation when no dockerApi is supplied (no HOSTNAME lookup)', async () => {
    const composeFileParser = makeParser({
      '/opt/stack/compose.yml': { services: { web: { depends_on: ['db'] }, db: {} } },
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
    expect(result).toEqual({ dependsOn: ['db'], warnings: [] });
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

  test('treats a parsed compose file with no services key as declaring no services', async () => {
    const composeFileParser = makeParser({
      '/opt/stack/empty.yml': {},
      '/opt/stack/overlay.yml': { services: { web: { depends_on: ['db'] }, db: {} } },
    });
    const result = await resolveComposeDependsOn(
      {
        labels: {
          'com.docker.compose.service': 'web',
          'com.docker.compose.project.config_files': '/opt/stack/empty.yml,/opt/stack/overlay.yml',
        },
      },
      { composeFileParser },
    );
    expect(result).toEqual({ dependsOn: ['db'], warnings: [] });
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
      'Compose dependency detection for service "web" is disabled: none of the configured compose files could be read (tried: /nonexistent/compose.yml). If drydock is running in a container, verify the compose file\'s host path is bind-mounted into it.',
    ]);
  });
});
