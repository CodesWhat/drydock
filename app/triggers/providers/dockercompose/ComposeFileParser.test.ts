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
});
