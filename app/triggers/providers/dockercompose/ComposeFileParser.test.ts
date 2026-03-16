import fs from 'node:fs/promises';
import yaml from 'yaml';
import ComposeFileParser, { updateComposeServiceImageInText } from './ComposeFileParser.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    default: {
      ...actual.default,
      readFile: vi.fn().mockResolvedValue(Buffer.from('')),
      stat: vi.fn().mockResolvedValue({ mtimeMs: Date.now() }),
    },
    readFile: vi.fn().mockResolvedValue(Buffer.from('')),
    stat: vi.fn().mockResolvedValue({ mtimeMs: Date.now() }),
  };
});

describe('ComposeFileParser', () => {
  test('constructor should throw when resolveComposeFilePath is not provided', () => {
    expect(() => new ComposeFileParser({} as any)).toThrow(
      'ComposeFileParser requires dependency "resolveComposeFilePath"',
    );
  });

  test('getComposeFileAsObject should reuse cached parse when file mtime is unchanged', async () => {
    const composeFilePath = '/opt/drydock/test/compose.yml';
    const composeText = ['services:', '  nginx:', '    image: nginx:1.0.0', ''].join('\n');
    const parser = new ComposeFileParser({
      resolveComposeFilePath: (filePath) => filePath,
      getDefaultComposeFilePath: () => composeFilePath,
      getLog: () => ({ error: vi.fn() }),
    });

    fs.readFile.mockResolvedValue(Buffer.from(composeText));
    fs.stat.mockResolvedValue({
      mtimeMs: 1700000000000,
    } as any);

    const parseSpy = vi.spyOn(yaml, 'parse');

    const first = await parser.getComposeFileAsObject(composeFilePath);
    const second = await parser.getComposeFileAsObject(composeFilePath);

    expect(first).toEqual(second);
    expect(parseSpy).toHaveBeenCalledTimes(1);
  });

  test('getCachedComposeDocument should reuse cached parse when mtime is unchanged', () => {
    const parser = new ComposeFileParser({
      resolveComposeFilePath: (filePath) => filePath,
      getDefaultComposeFilePath: () => '/opt/drydock/test/compose.yml',
      getLog: () => ({ error: vi.fn() }),
    });
    const composeFilePath = '/opt/drydock/test/compose.yml';
    const parseDocumentSpy = vi.spyOn(yaml, 'parseDocument');

    const first = parser.getCachedComposeDocument(
      composeFilePath,
      1700000000000,
      ['services:', '  nginx:', '    image: nginx:1.0.0', ''].join('\n'),
    );
    const second = parser.getCachedComposeDocument(
      composeFilePath,
      1700000000000,
      ['services:', '  nginx:', '    image: nginx:2.0.0', ''].join('\n'),
    );

    expect(second).toBe(first);
    expect(parseDocumentSpy).toHaveBeenCalledTimes(1);
  });

  test('updateComposeServiceImageInText should preserve comments while updating target service image', () => {
    const compose = [
      'services:',
      '  nginx:',
      '    # pinned for compatibility',
      '    image: nginx:1.1.0 # current',
      '  redis:',
      '    image: redis:7.0.0',
      '',
    ].join('\n');

    const updated = updateComposeServiceImageInText(compose, 'nginx', 'nginx:1.2.0');

    expect(updated).toContain('    # pinned for compatibility');
    expect(updated).toContain('    image: nginx:1.2.0 # current');
    expect(updated).toContain('    image: redis:7.0.0');
  });

  test('updateComposeServiceImageInText should patch a single-quoted image value in place', () => {
    const compose = ['services:', '  app:', "    image: 'myapp:1.0.0'", ''].join('\n');

    const updated = updateComposeServiceImageInText(compose, 'app', 'myapp:2.0.0');

    expect(updated).toContain("image: 'myapp:2.0.0'");
  });

  test('updateComposeServiceImageInText should patch a double-quoted image value in place', () => {
    const compose = ['services:', '  app:', '    image: "myapp:1.0.0"', ''].join('\n');

    const updated = updateComposeServiceImageInText(compose, 'app', 'myapp:2.0.0');

    expect(updated).toContain('image: "myapp:2.0.0"');
  });

  test('setComposeCacheMaxEntries should evict oldest entries when lowering the limit', () => {
    const parser = new ComposeFileParser({
      resolveComposeFilePath: (filePath) => filePath,
      composeCacheMaxEntries: 10,
    });

    const composeText = ['services:', '  a:', '    image: a:1', ''].join('\n');
    for (let i = 0; i < 5; i++) {
      parser.getCachedComposeDocument(`/file${i}.yml`, 1000 + i, composeText);
    }
    expect(parser._composeDocumentCache.size).toBe(5);

    parser._composeObjectCache.set('/a.yml', { mtimeMs: 1, compose: {} });
    parser._composeObjectCache.set('/b.yml', { mtimeMs: 2, compose: {} });
    parser._composeObjectCache.set('/c.yml', { mtimeMs: 3, compose: {} });
    expect(parser._composeObjectCache.size).toBe(3);

    parser.setComposeCacheMaxEntries(2);

    expect(parser._composeObjectCache.size).toBe(2);
    expect(parser._composeDocumentCache.size).toBe(2);
  });

  test('getComposeFileAsObject should log and rethrow when parsing fails', async () => {
    const errorSpy = vi.fn();
    const parser = new ComposeFileParser({
      resolveComposeFilePath: (filePath) => filePath,
      getDefaultComposeFilePath: () => '/opt/drydock/test/compose.yml',
      getLog: () => ({ error: errorSpy }),
    });

    fs.stat.mockRejectedValue(new Error('file not found'));

    await expect(parser.getComposeFileAsObject('/opt/drydock/test/compose.yml')).rejects.toThrow(
      'file not found',
    );

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Error when parsing the docker-compose yaml file'),
    );
  });

  test('setComposeCacheEntry should evict oldest entries when cache exceeds max', () => {
    const parser = new ComposeFileParser({
      resolveComposeFilePath: (filePath) => filePath,
      composeCacheMaxEntries: 2,
    });

    const cache = parser._composeObjectCache;
    parser.setComposeCacheEntry(cache, '/a.yml', { mtimeMs: 1, compose: {} });
    parser.setComposeCacheEntry(cache, '/b.yml', { mtimeMs: 2, compose: {} });
    parser.setComposeCacheEntry(cache, '/c.yml', { mtimeMs: 3, compose: {} });

    expect(cache.size).toBe(2);
    expect(cache.has('/a.yml')).toBe(false);
    expect(cache.has('/b.yml')).toBe(true);
    expect(cache.has('/c.yml')).toBe(true);
  });

  test('constructor should use fallback defaults when getDefaultComposeFilePath and getLog are omitted', () => {
    const parser = new ComposeFileParser({
      resolveComposeFilePath: (filePath) => filePath,
    });

    expect(parser.getDefaultComposeFilePath()).toBeNull();
    expect(parser.getLog()).toBeUndefined();
  });

  test('getComposeFileAsObject should fall back to default compose file path when no file is provided', async () => {
    const composeFilePath = '/opt/drydock/default.yml';
    const composeText = ['services:', '  app:', '    image: app:1.0.0', ''].join('\n');
    const parser = new ComposeFileParser({
      resolveComposeFilePath: (filePath) => filePath,
      getDefaultComposeFilePath: () => composeFilePath,
      getLog: () => ({ error: vi.fn() }),
    });

    fs.readFile.mockResolvedValue(Buffer.from(composeText));
    fs.stat.mockResolvedValue({ mtimeMs: 1700000000000 } as any);

    const result = await parser.getComposeFileAsObject();

    expect(result).toEqual({
      services: { app: { image: 'app:1.0.0' } },
    });
  });

  test('invalidateComposeCaches should clear both caches for a given path', () => {
    const parser = new ComposeFileParser({
      resolveComposeFilePath: (filePath) => filePath,
    });

    const composeText = ['services:', '  a:', '    image: a:1', ''].join('\n');
    parser.getCachedComposeDocument('/file.yml', 1000, composeText);
    parser._composeObjectCache.set('/file.yml', { mtimeMs: 1, compose: {} });

    expect(parser._composeDocumentCache.size).toBe(1);
    expect(parser._composeObjectCache.size).toBe(1);

    parser.invalidateComposeCaches('/file.yml');

    expect(parser._composeDocumentCache.size).toBe(0);
    expect(parser._composeObjectCache.size).toBe(0);
  });

  test('getComposeFile should log and rethrow when readFile throws synchronously', () => {
    const errorSpy = vi.fn();
    const parser = new ComposeFileParser({
      resolveComposeFilePath: (filePath) => filePath,
      getLog: () => ({ error: errorSpy }),
    });

    fs.readFile.mockImplementation(() => {
      throw new Error('sync read failure');
    });

    expect(() => parser.getComposeFile('/bad.yml')).toThrow('sync read failure');

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Error when reading the docker-compose yaml file'),
    );
  });

  test('getComposeFile should stringify non-Error synchronous read failures', () => {
    const errorSpy = vi.fn();
    const parser = new ComposeFileParser({
      resolveComposeFilePath: (filePath) => filePath,
      getLog: () => ({ error: errorSpy }),
    });

    fs.readFile.mockImplementation(() => {
      throw 42;
    });

    expect(() => parser.getComposeFile('/bad.yml')).toThrow();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Error when reading the docker-compose yaml file /bad.yml (42)'),
    );
  });
});
