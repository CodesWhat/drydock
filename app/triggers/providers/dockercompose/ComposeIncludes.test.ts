import { expandComposeFilesWithIncludes, extractComposeIncludePaths } from './ComposeIncludes.js';

describe('extractComposeIncludePaths', () => {
  test('returns nothing for documents without include', () => {
    expect(extractComposeIncludePaths(undefined)).toEqual([]);
    expect(extractComposeIncludePaths(null)).toEqual([]);
    expect(extractComposeIncludePaths({ services: {} })).toEqual([]);
  });

  test('reads the short form, the long form and path lists', () => {
    expect(
      extractComposeIncludePaths({
        include: [
          'a.yaml',
          { path: 'b.yaml', project_directory: '.' },
          { path: ['c.yaml', 'd.yaml'] },
          { path: 42 },
          { path: '  ' },
          null,
          7,
        ],
      }),
    ).toEqual(['a.yaml', 'b.yaml', 'c.yaml', 'd.yaml']);
  });

  test('accepts a single string include', () => {
    expect(extractComposeIncludePaths({ include: 'only.yaml' })).toEqual(['only.yaml']);
  });
});

function createOptions(files: Record<string, unknown>, overrides = {}) {
  return {
    composeFiles: ['/stack/compose.yaml'],
    readCompose: vi.fn(async (composeFile: string) => {
      if (!(composeFile in files)) {
        throw new Error(`ENOENT ${composeFile}`);
      }
      return files[composeFile];
    }),
    mapPath: vi.fn((composeFilePath: string) => composeFilePath),
    isAllowed: vi.fn(() => true),
    warn: vi.fn(),
    ...overrides,
  };
}

describe('expandComposeFilesWithIncludes', () => {
  test('returns the labelled files untouched when nothing is included', async () => {
    const options = createOptions({ '/stack/compose.yaml': { services: {} } });

    await expect(expandComposeFilesWithIncludes(options)).resolves.toEqual(['/stack/compose.yaml']);
  });

  test('appends included files after the labelled ones, resolving relative paths against the includer', async () => {
    const options = createOptions({
      '/stack/compose.yaml': { include: ['svc/web.yaml', { path: ['../shared/db.yaml'] }] },
      '/stack/svc/web.yaml': {},
      '/shared/db.yaml': {},
    });

    await expect(expandComposeFilesWithIncludes(options)).resolves.toEqual([
      '/stack/compose.yaml',
      '/stack/svc/web.yaml',
      '/shared/db.yaml',
    ]);
  });

  test('follows nested includes relative to the included file', async () => {
    const options = createOptions({
      '/stack/compose.yaml': { include: ['svc/web.yaml'] },
      '/stack/svc/web.yaml': { include: ['deep/cache.yaml'] },
      '/stack/svc/deep/cache.yaml': {},
    });

    await expect(expandComposeFilesWithIncludes(options)).resolves.toEqual([
      '/stack/compose.yaml',
      '/stack/svc/web.yaml',
      '/stack/svc/deep/cache.yaml',
    ]);
  });

  test('maps absolute include paths through the bind mounts', async () => {
    const options = createOptions(
      {
        '/stack/compose.yaml': { include: ['/host/stack/web.yaml'] },
        '/stack/web.yaml': {},
      },
      { mapPath: vi.fn(() => '/stack/web.yaml') },
    );

    await expect(expandComposeFilesWithIncludes(options)).resolves.toEqual([
      '/stack/compose.yaml',
      '/stack/web.yaml',
    ]);
    expect(options.mapPath).toHaveBeenCalledWith('/host/stack/web.yaml');
  });

  test('places included files right after their includer and before later override files', async () => {
    const options = createOptions(
      {
        '/stack/compose.yaml': { include: ['inc.yaml'] },
        '/stack/inc.yaml': { include: ['deeper.yaml'] },
        '/stack/deeper.yaml': {},
        '/stack/override.yaml': { include: ['extra.yaml'] },
        '/stack/extra.yaml': {},
      },
      { composeFiles: ['/stack/compose.yaml', '/stack/override.yaml'] },
    );

    await expect(expandComposeFilesWithIncludes(options)).resolves.toEqual([
      '/stack/compose.yaml',
      '/stack/inc.yaml',
      '/stack/deeper.yaml',
      '/stack/override.yaml',
      '/stack/extra.yaml',
    ]);
  });

  test('does not list a file twice and survives include cycles', async () => {
    const options = createOptions({
      '/stack/compose.yaml': { include: ['a.yaml', 'a.yaml', 'compose.yaml'] },
      '/stack/a.yaml': { include: ['compose.yaml', 'a.yaml'] },
    });

    await expect(expandComposeFilesWithIncludes(options)).resolves.toEqual([
      '/stack/compose.yaml',
      '/stack/a.yaml',
    ]);
  });

  test('skips interpolated paths, disallowed paths and unreadable files with a warning', async () => {
    const options = createOptions(
      {
        '/stack/compose.yaml': {
          include: ['${PROFILE}/web.yaml', '../outside.yaml', 'missing.yaml', 'ok.yaml'],
        },
        '/stack/ok.yaml': {},
      },
      { isAllowed: vi.fn((composeFilePath: string) => composeFilePath !== '/outside.yaml') },
    );

    await expect(expandComposeFilesWithIncludes(options)).resolves.toEqual([
      '/stack/compose.yaml',
      '/stack/missing.yaml',
      '/stack/ok.yaml',
    ]);
    expect(options.warn).toHaveBeenCalledWith(
      expect.stringContaining('interpolated include paths'),
    );
    expect(options.warn).toHaveBeenCalledWith(
      expect.stringContaining('outside the allowed compose roots'),
    );
    expect(options.warn).toHaveBeenCalledWith(
      expect.stringContaining('Unable to read /stack/missing.yaml'),
    );
  });

  test('keeps the labelled file when it cannot be read', async () => {
    const options = createOptions({});

    await expect(expandComposeFilesWithIncludes(options)).resolves.toEqual(['/stack/compose.yaml']);
    expect(options.warn).toHaveBeenCalledWith(
      expect.stringContaining('(ENOENT /stack/compose.yaml)'),
    );
  });

  test('stops following a chain that nests deeper than the depth limit', async () => {
    const files: Record<string, unknown> = { '/stack/compose.yaml': { include: ['l1.yaml'] } };
    for (let level = 1; level <= 12; level++) {
      files[`/stack/l${level}.yaml`] = { include: [`l${level + 1}.yaml`] };
    }
    const options = createOptions(files);

    const expanded = await expandComposeFilesWithIncludes(options);

    expect(expanded).toHaveLength(9);
    expect(expanded.at(-1)).toBe('/stack/l8.yaml');
  });

  test('stops after the maximum number of included files', async () => {
    const includes = Array.from({ length: 70 }, (_, index) => `f${index}.yaml`);
    const files: Record<string, unknown> = { '/stack/compose.yaml': { include: includes } };
    for (const include of includes) {
      files[`/stack/${include}`] = {};
    }
    const options = createOptions(files);

    const expanded = await expandComposeFilesWithIncludes(options);

    expect(expanded).toHaveLength(65);
    expect(options.warn).toHaveBeenCalledWith(
      expect.stringContaining('Stopped following compose includes'),
    );
  });

  test('stops the whole walk once the cap is reached inside a nested include', async () => {
    const nested = Array.from({ length: 70 }, (_, index) => `f${index}.yaml`);
    const files: Record<string, unknown> = {
      '/stack/compose.yaml': { include: ['a.yaml', 'b.yaml'] },
      '/stack/a.yaml': { include: nested },
      '/stack/b.yaml': {},
    };
    for (const include of nested) {
      files[`/stack/${include}`] = {};
    }
    const options = createOptions(files);

    const expanded = await expandComposeFilesWithIncludes(options);

    expect(expanded).toHaveLength(65);
    expect(expanded).not.toContain('/stack/b.yaml');
    expect(options.warn).toHaveBeenCalledTimes(1);
  });
});
