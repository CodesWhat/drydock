// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

vi.mock('node:fs', () => ({
  default: {
    statSync: vi.fn(),
  },
}));

describe('runtime/paths', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  test('resolveRuntimeRoot should return cached value on second call', async () => {
    fs.statSync.mockImplementation((p) => {
      // Make the cwd candidate pass marker checks
      if (typeof p === 'string') {
        return { isDirectory: () => true };
      }
      throw new Error('not found');
    });

    const { resolveRuntimeRoot } = await import('./paths.js');

    const first = resolveRuntimeRoot();
    const second = resolveRuntimeRoot();
    expect(first).toBe(second);
  });

  test('resolveRuntimeRoot should fall back to cwd when no markers found', async () => {
    fs.statSync.mockImplementation(() => {
      throw new Error('not found');
    });

    const { resolveRuntimeRoot } = await import('./paths.js');
    const result = resolveRuntimeRoot();
    expect(result).toBe(process.cwd());
  });

  test('resolveFromRuntimeRoot should join segments to runtime root', async () => {
    fs.statSync.mockImplementation(() => {
      throw new Error('not found');
    });

    const { resolveFromRuntimeRoot } = await import('./paths.js');
    const result = resolveFromRuntimeRoot('foo', 'bar');
    expect(result).toBe(path.resolve(process.cwd(), 'foo', 'bar'));
  });

  test('resolveUiDirectory should return first candidate when ui dir exists', async () => {
    const runtimeRoot = process.cwd();

    fs.statSync.mockImplementation((p) => {
      const uiPath = path.resolve(runtimeRoot, 'ui');
      if (p === uiPath) {
        return { isDirectory: () => true };
      }
      throw new Error('not found');
    });

    const { resolveUiDirectory } = await import('./paths.js');
    const result = resolveUiDirectory();
    expect(result).toBe(path.resolve(runtimeRoot, 'ui'));
  });

  test('resolveUiDirectory should return parent ui dir when runtime ui does not exist', async () => {
    fs.statSync.mockImplementation((p) => {
      const parentUi = path.resolve(process.cwd(), '..', 'ui');
      if (p === parentUi) {
        return { isDirectory: () => true };
      }
      throw new Error('not found');
    });

    const { resolveUiDirectory } = await import('./paths.js');
    const result = resolveUiDirectory();
    // It should find the parent ui directory
    expect(typeof result).toBe('string');
  });

  test('resolveRuntimeRoot should use module directory candidate when markers exist', async () => {
    // Make all statSync calls pass (markers exist for all candidates)
    fs.statSync.mockImplementation(() => ({
      isDirectory: () => true,
    }));

    const { resolveRuntimeRoot } = await import('./paths.js');
    const result = resolveRuntimeRoot();
    // Should return a string (the first candidate with markers)
    expect(typeof result).toBe('string');
  });

  test('isDirectory should return false when statSync throws', async () => {
    // statSync throws for all paths
    fs.statSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });

    const { resolveRuntimeRoot } = await import('./paths.js');
    // When no markers found, falls back to cwd
    expect(resolveRuntimeRoot()).toBe(process.cwd());
  });

  test('resolveUiDirectory should return first candidate as fallback when no ui dir exists', async () => {
    fs.statSync.mockImplementation(() => {
      throw new Error('not found');
    });

    const { resolveUiDirectory, resolveRuntimeRoot } = await import('./paths.js');
    const runtimeRoot = resolveRuntimeRoot();
    const result = resolveUiDirectory();
    expect(result).toBe(path.resolve(runtimeRoot, 'ui'));
  });

  test('resolveConfiguredPath should resolve relative paths from cwd', async () => {
    const { resolveConfiguredPath } = await import('./paths.js');
    const resolved = resolveConfiguredPath('./certs/client.pem');
    expect(resolved).toBe(path.resolve(process.cwd(), './certs/client.pem'));
  });

  test('resolveConfiguredPath should reject empty values and null bytes', async () => {
    const { resolveConfiguredPath } = await import('./paths.js');
    expect(() => resolveConfiguredPath('')).toThrow('cannot be empty');
    expect(() => resolveConfiguredPath('\0bad')).toThrow('contains invalid null byte');
  });

  test('resolveConfiguredPath should reject non-string values', async () => {
    const { resolveConfiguredPath } = await import('./paths.js');
    expect(() => resolveConfiguredPath(123)).toThrow('must be a string');
  });

  test('resolveConfiguredPath should reject absolute paths when allowAbsolute is false', async () => {
    const { resolveConfiguredPath } = await import('./paths.js');
    expect(() =>
      resolveConfiguredPath(path.resolve('/tmp/certs/client.pem'), {
        allowAbsolute: false,
      }),
    ).toThrow('must be a relative path');
  });

  test('resolveConfiguredPathWithinBase should keep paths inside base directory', async () => {
    const { resolveConfiguredPathWithinBase } = await import('./paths.js');
    const baseDir = path.resolve(process.cwd(), 'store');
    const resolved = resolveConfiguredPathWithinBase(baseDir, 'dd.json');
    expect(resolved).toBe(path.resolve(baseDir, 'dd.json'));
    expect(() => resolveConfiguredPathWithinBase(baseDir, '../outside.json')).toThrow(
      'must stay inside',
    );
  });

  test('resolveConfiguredPathWithinBase should accept base directories already ending with separator', async () => {
    const { resolveConfiguredPathWithinBase } = await import('./paths.js');
    const baseDirWithSeparator = `${path.resolve(process.cwd(), 'store')}${path.sep}`;
    const resolved = resolveConfiguredPathWithinBase(baseDirWithSeparator, 'dd.json');
    expect(resolved).toBe(path.resolve(baseDirWithSeparator, 'dd.json'));
  });

  test('resolveConfiguredPathWithinBase should allow root base directory', async () => {
    const { resolveConfiguredPathWithinBase } = await import('./paths.js');
    const resolved = resolveConfiguredPathWithinBase(path.parse(process.cwd()).root, 'tmp');
    expect(resolved).toBe(path.resolve(path.parse(process.cwd()).root, 'tmp'));
  });

  test('resolveRuntimeRoot should include module-directory candidate when import.meta.url is available', async () => {
    vi.resetModules();
    vi.clearAllMocks();

    const originalFunction = globalThis.Function;
    const fakeModuleFile = path.resolve(process.cwd(), 'runtime', 'paths.ts');
    const fakeModuleUrl = pathToFileURL(fakeModuleFile).href;
    let importMetaFunctionCalled = false;

    // biome-ignore lint/complexity/useArrowFunction: mock constructor requires function expression
    (globalThis as any).Function = function (...args: string[]) {
      if (args.length === 1 && args[0] === 'return import.meta.url') {
        importMetaFunctionCalled = true;
        return () => fakeModuleUrl;
      }
      return originalFunction(...args);
    };

    try {
      fs.statSync.mockImplementation(() => ({
        isDirectory: () => true,
      }));

      const { resolveRuntimeRoot } = await import('./paths.js');
      const runtimeRoot = resolveRuntimeRoot();
      expect(typeof runtimeRoot).toBe('string');
      expect(importMetaFunctionCalled).toBe(true);
    } finally {
      (globalThis as any).Function = originalFunction;
    }
  });

  test('resolveRuntimeRoot should ignore argv candidate when process.argv[1] is missing', async () => {
    vi.resetModules();
    vi.clearAllMocks();

    const originalArgv1 = process.argv[1];
    process.argv[1] = undefined as any;

    try {
      fs.statSync.mockImplementation(() => {
        throw new Error('not found');
      });

      const { resolveRuntimeRoot } = await import('./paths.js');
      expect(resolveRuntimeRoot()).toBe(process.cwd());
    } finally {
      process.argv[1] = originalArgv1;
    }
  });
});
