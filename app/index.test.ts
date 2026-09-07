import { afterEach, describe, expect, test, vi } from 'vitest';

describe('bootstrap', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('loads the config file layer before importing main', async () => {
    const calls: string[] = [];
    const loadConfigFileIntoLayer = vi.fn(async () => {
      calls.push('loadConfigFileIntoLayer');
    });
    const mainFactory = vi.fn(() => {
      calls.push('main');
      return {};
    });

    vi.resetModules();
    vi.doMock('./configuration/file/loader.js', () => ({ loadConfigFileIntoLayer }));
    vi.doMock('./main.js', mainFactory);

    await import('./index.js');

    expect(loadConfigFileIntoLayer).toHaveBeenCalledTimes(1);
    expect(mainFactory).toHaveBeenCalledTimes(1);
    expect(calls).toStrictEqual(['loadConfigFileIntoLayer', 'main']);
  });

  test('on a load failure, prints the loader message to stderr, sets exit code 1, and never imports main', async () => {
    const loadError = new Error('DD_CONFIG_FILE points at "/nope.yml", which does not exist');
    const loadConfigFileIntoLayer = vi.fn(async () => {
      throw loadError;
    });
    const mainFactory = vi.fn(() => ({}));
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const originalExitCode = process.exitCode;

    vi.resetModules();
    vi.doMock('./configuration/file/loader.js', () => ({ loadConfigFileIntoLayer }));
    vi.doMock('./main.js', mainFactory);

    try {
      await import('./index.js');

      expect(stderrWrite).toHaveBeenCalledWith(`${loadError.message}\n`);
      expect(process.exitCode).toBe(1);
      expect(mainFactory).not.toHaveBeenCalled();
    } finally {
      process.exitCode = originalExitCode;
    }
  });
});
