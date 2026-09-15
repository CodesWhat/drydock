import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  constructComponent,
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

  test('getAvailableProviders should stringify non-Error exceptions', () => {
    fs.readdirSync.mockImplementation(() => {
      throw 'cannot read as string';
    });
    const onError = vi.fn();

    expect(getAvailableProviders('triggers/providers', onError)).toEqual([]);
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('cannot read as string'));
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

  // constructComponent resolves against the fake /runtime root above, so the
  // dynamic import() it performs always fails against the real filesystem —
  // these tests are about which path it tries, not about a successful
  // construction (registry/index.test.ts covers that against real provider
  // files, since resolveRuntimeRoot there is unmocked).
  test('constructComponent should prefer the provider-by-convention file (capitalized) when it exists', async () => {
    fs.existsSync.mockImplementation((candidate) => `${candidate}`.endsWith('Docker.ts'));

    await expect(constructComponent('watcher', 'docker', 'watchers/providers')).rejects.toThrow(
      /Docker/,
    );
  });

  test('constructComponent should fall back to the lowercase provider file when no convention file exists', async () => {
    fs.existsSync.mockReturnValue(false);

    await expect(constructComponent('watcher', 'docker', 'watchers/providers')).rejects.toThrow(
      /docker/,
    );
  });

  test('constructComponent should lowercase the provider before building either candidate path', async () => {
    fs.existsSync.mockReturnValue(false);

    await expect(constructComponent('registry', 'GHCR', 'registries/providers')).rejects.toThrow(
      /ghcr/,
    );
  });

  test('constructComponent should capitalize the lowercased provider, not the raw one, so an unnormalized caller still finds the convention file', async () => {
    fs.existsSync.mockImplementation((candidate) => `${candidate}`.endsWith('Ghcr.ts'));

    await expect(constructComponent('registry', 'GHCR', 'registries/providers')).rejects.toThrow(
      /Ghcr/,
    );
  });
});
