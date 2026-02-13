// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  getAvailableProviders,
  resolveComponentModuleSpecifier,
  resolveComponentRoot,
} from './component-resolution.js';

vi.mock('node:fs', () => ({
  default: {
    readdirSync: vi.fn(),
    statSync: vi.fn(),
    existsSync: vi.fn(),
  },
}));

vi.mock('../runtime/paths.js', () => ({
  resolveRuntimeRoot: vi.fn(() => '/runtime'),
  resolveConfiguredPathWithinBase: vi.fn((baseDir, candidate) => path.resolve(baseDir, candidate)),
}));

describe('component-resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.JEST_WORKER_ID;
  });

  test('resolveComponentRoot should resolve component path within runtime root', () => {
    expect(resolveComponentRoot('trigger', 'triggers/providers')).toBe(
      '/runtime/triggers/providers',
    );
  });

  test('getAvailableProviders should return sorted provider directories', () => {
    fs.readdirSync.mockReturnValue(['zeta', 'alpha', 'README.md']);
    fs.statSync.mockImplementation((filePath) => ({
      isDirectory: () => !`${filePath}`.endsWith('README.md'),
    }));

    const providers = getAvailableProviders('triggers/providers');
    expect(providers).toEqual(['alpha', 'zeta']);
  });

  test('getAvailableProviders should return empty list and call onError on failure', () => {
    fs.readdirSync.mockImplementation(() => {
      throw new Error('cannot read');
    });
    const onError = vi.fn();

    expect(getAvailableProviders('triggers/providers', onError)).toEqual([]);
    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining('Unable to load providers under triggers/providers'),
    );
  });

  test('resolveComponentModuleSpecifier should prefer .js files when available', () => {
    fs.existsSync.mockImplementation((candidate) => `${candidate}`.endsWith('.js'));
    const base = '/runtime/triggers/providers/docker/Docker';

    const resolved = resolveComponentModuleSpecifier(base);
    expect(resolved).toBe(pathToFileURL(`${base}.js`).href);
  });

  test('resolveComponentModuleSpecifier should return extensionless path for ts-jest mode', () => {
    process.env.JEST_WORKER_ID = '1';
    fs.existsSync.mockImplementation((candidate) => `${candidate}`.endsWith('.ts'));
    const base = '/runtime/triggers/providers/docker/Docker';

    const resolved = resolveComponentModuleSpecifier(base);
    expect(resolved).toBe(base);
  });

  test('resolveComponentModuleSpecifier should return .ts URL when only ts file exists', () => {
    fs.existsSync.mockImplementation((candidate) => `${candidate}`.endsWith('.ts'));
    const base = '/runtime/triggers/providers/docker/Docker';

    const resolved = resolveComponentModuleSpecifier(base);
    expect(resolved).toBe(pathToFileURL(`${base}.ts`).href);
  });

  test('resolveComponentModuleSpecifier should fall back to .js URL when no file exists', () => {
    fs.existsSync.mockReturnValue(false);
    const base = '/runtime/triggers/providers/docker/Docker';

    const resolved = resolveComponentModuleSpecifier(base);
    expect(resolved).toBe(pathToFileURL(`${base}.js`).href);
  });
});
