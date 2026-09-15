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

  test('a "config validate"/"config export" command is dispatched before the load, and never imports main', async () => {
    const loadConfigFileIntoLayer = vi.fn(async () => undefined);
    const mainFactory = vi.fn(() => ({}));
    const runConfigCommandIfRequested = vi.fn(async () => 0);
    const originalArgv = process.argv;
    const originalExitCode = process.exitCode;
    process.argv = ['node', 'index.js', 'config', 'validate'];
    process.exitCode = undefined;

    vi.resetModules();
    vi.doMock('./configuration/file/loader.js', () => ({ loadConfigFileIntoLayer }));
    vi.doMock('./configuration/config-cli.js', () => ({ runConfigCommandIfRequested }));
    vi.doMock('./main.js', mainFactory);

    try {
      await import('./index.js');

      expect(runConfigCommandIfRequested).toHaveBeenCalledWith(['config', 'validate']);
      expect(process.exitCode).toBe(0);
      expect(loadConfigFileIntoLayer).not.toHaveBeenCalled();
      expect(mainFactory).not.toHaveBeenCalled();
    } finally {
      process.argv = originalArgv;
      process.exitCode = originalExitCode;
    }
  });

  test('a non-config command never imports the config CLI and falls through to load-then-import-main', async () => {
    const calls: string[] = [];
    const loadConfigFileIntoLayer = vi.fn(async () => {
      calls.push('loadConfigFileIntoLayer');
    });
    const mainFactory = vi.fn(() => {
      calls.push('main');
      return {};
    });
    const configCliFactory = vi.fn(() => {
      calls.push('config-cli');
      return { runConfigCommandIfRequested: vi.fn(async () => null) };
    });
    const originalArgv = process.argv;
    process.argv = ['node', 'index.js', '--agent'];

    vi.resetModules();
    vi.doMock('./configuration/file/loader.js', () => ({ loadConfigFileIntoLayer }));
    vi.doMock('./configuration/config-cli.js', configCliFactory);
    vi.doMock('./main.js', mainFactory);

    try {
      await import('./index.js');

      expect(configCliFactory).not.toHaveBeenCalled();
      expect(calls).toStrictEqual(['loadConfigFileIntoLayer', 'main']);
    } finally {
      process.argv = originalArgv;
    }
  });

  test('an unknown "config" subcommand falls through to the ordinary bootstrap', async () => {
    const calls: string[] = [];
    const loadConfigFileIntoLayer = vi.fn(async () => {
      calls.push('loadConfigFileIntoLayer');
    });
    const mainFactory = vi.fn(() => {
      calls.push('main');
      return {};
    });
    const runConfigCommandIfRequested = vi.fn(async () => null);
    const originalArgv = process.argv;
    process.argv = ['node', 'index.js', 'config', 'unknown'];

    vi.resetModules();
    vi.doMock('./configuration/file/loader.js', () => ({ loadConfigFileIntoLayer }));
    vi.doMock('./configuration/config-cli.js', () => ({ runConfigCommandIfRequested }));
    vi.doMock('./main.js', mainFactory);

    try {
      await import('./index.js');

      expect(runConfigCommandIfRequested).toHaveBeenCalledWith(['config', 'unknown']);
      expect(calls).toStrictEqual(['loadConfigFileIntoLayer', 'main']);
    } finally {
      process.argv = originalArgv;
    }
  });

  test('the configuration singleton is not evaluated before the file layer is loaded', async () => {
    // Regression: a static import of config-cli.js reached configuration/index.ts
    // (via file/validate.ts) before loadConfigFileIntoLayer ran, so the merge saw
    // an empty file layer and every file-sourced value vanished at runtime.
    const calls: string[] = [];
    const loadConfigFileIntoLayer = vi.fn(async () => {
      calls.push('loadConfigFileIntoLayer');
    });
    const configurationFactory = vi.fn(() => {
      calls.push('configuration');
      return {};
    });
    const originalArgv = process.argv;
    process.argv = ['node', 'index.js'];

    vi.resetModules();
    vi.doMock('./configuration/file/loader.js', () => ({ loadConfigFileIntoLayer }));
    vi.doMock('./configuration/index.js', configurationFactory);
    vi.doMock('./main.js', () => {
      calls.push('main');
      return {};
    });

    try {
      await import('./index.js');

      expect(configurationFactory).not.toHaveBeenCalled();
      expect(calls).toStrictEqual(['loadConfigFileIntoLayer', 'main']);
    } finally {
      process.argv = originalArgv;
    }
  });
});
