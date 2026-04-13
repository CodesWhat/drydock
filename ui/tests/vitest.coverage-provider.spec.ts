import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

interface MockCoverageProvider {
  clean?: (clean?: boolean) => Promise<void>;
  coverageFiles: Map<unknown, Record<string, Record<string, string>>>;
  coverageFilesDirectory: string;
  ctx: {
    getProjectByName: (name: unknown) => unknown;
  };
  options: {
    processingConcurrency: number;
    reportsDirectory: string;
  };
  pendingPromises: Promise<void>[];
  toSlices: (filenames: string[], concurrency: number) => string[][];
}

function createMockCoverageProvider(reportsDirectory: string): MockCoverageProvider {
  return {
    coverageFiles: new Map(),
    coverageFilesDirectory: resolve(reportsDirectory, 'raw'),
    ctx: {
      getProjectByName: (name) => name,
    },
    options: {
      processingConcurrency: 1,
      reportsDirectory,
    },
    pendingPromises: [],
    toSlices: (filenames, concurrency) => {
      const chunkSize = Math.max(concurrency, 1);
      const chunks: string[][] = [];
      for (let index = 0; index < filenames.length; index += chunkSize) {
        chunks.push(filenames.slice(index, index + chunkSize));
      }
      return chunks;
    },
  };
}

async function loadCoverageProvider(mockProvider: MockCoverageProvider) {
  vi.resetModules();
  vi.doMock('@vitest/coverage-v8', () => ({
    default: {
      getProvider: vi.fn(async () => mockProvider),
    },
  }));

  return (await import('../vitest.coverage-provider.js')).default;
}

describe('vitest coverage provider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock('@vitest/coverage-v8');
    vi.resetModules();
  });

  it('skips corrupt coverage files and continues processing valid coverage', async () => {
    const reportsDirectory = await mkdtemp(join(tmpdir(), 'drydock-ui-coverage-'));
    const mockProvider = createMockCoverageProvider(reportsDirectory);

    try {
      const coverageProviderModule = await loadCoverageProvider(mockProvider);
      const provider = await coverageProviderModule.getProvider();

      const validFilename = resolve(provider.coverageFilesDirectory, 'coverage-valid.json');
      const invalidFilename = resolve(provider.coverageFilesDirectory, 'coverage-invalid.json');

      await mkdir(provider.coverageFilesDirectory, { recursive: true });
      await writeFile(validFilename, JSON.stringify({ result: 'ok' }), 'utf8');
      await writeFile(invalidFilename, '{"result":', 'utf8');

      provider.coverageFiles.set('ui', {
        browser: {
          'valid.test.ts': validFilename,
          'invalid.test.ts': invalidFilename,
        },
      });

      const onFileRead = vi.fn();
      const onFinished = vi.fn().mockResolvedValue(undefined);
      const onDebug = Object.assign(vi.fn(), { enabled: true });

      await expect(
        provider.readCoverageFiles({
          onFileRead,
          onFinished,
          onDebug,
        }),
      ).resolves.toBeUndefined();

      expect(onFileRead).toHaveBeenCalledTimes(1);
      expect(onFileRead).toHaveBeenCalledWith({ result: 'ok' });
      expect(onFinished).toHaveBeenCalledTimes(1);
      expect(onFinished).toHaveBeenCalledWith('ui', 'browser');
      expect(onDebug).toHaveBeenCalledWith(
        expect.stringContaining(`Skipping corrupt coverage file "${invalidFilename}"`),
      );
    } finally {
      await rm(reportsDirectory, { recursive: true, force: true });
    }
  });

  it('reads coverage from the in-memory cache without touching the filesystem again', async () => {
    const reportsDirectory = await mkdtemp(join(tmpdir(), 'drydock-ui-coverage-'));
    const mockProvider = createMockCoverageProvider(reportsDirectory);

    try {
      const coverageProviderModule = await loadCoverageProvider(mockProvider);
      const provider = await coverageProviderModule.getProvider();

      provider.onAfterSuiteRun({
        coverage: { result: 'cached' },
        environment: 'browser',
        projectName: 'ui',
        testFiles: ['cached.test.ts'],
      });
      await Promise.all(provider.pendingPromises);

      const cachedFilename = Object.values(provider.coverageFiles.get('ui').browser)[0] as string;
      await unlink(cachedFilename);

      const onFileRead = vi.fn();
      const onFinished = vi.fn().mockResolvedValue(undefined);
      const onDebug = Object.assign(vi.fn(), { enabled: true });

      await expect(
        provider.readCoverageFiles({
          onFileRead,
          onFinished,
          onDebug,
        }),
      ).resolves.toBeUndefined();

      expect(onFileRead).toHaveBeenCalledTimes(1);
      expect(onFileRead).toHaveBeenCalledWith({ result: 'cached' });
      expect(onFinished).toHaveBeenCalledWith('ui', 'browser');
    } finally {
      await rm(reportsDirectory, { recursive: true, force: true });
    }
  });

  it('retries missing coverage files before succeeding', async () => {
    const reportsDirectory = await mkdtemp(join(tmpdir(), 'drydock-ui-coverage-'));
    const mockProvider = createMockCoverageProvider(reportsDirectory);

    try {
      const coverageProviderModule = await loadCoverageProvider(mockProvider);
      const provider = await coverageProviderModule.getProvider();
      const filename = resolve(provider.coverageFilesDirectory, 'coverage-retry.json');
      await mkdir(provider.coverageFilesDirectory, { recursive: true });

      provider.coverageFiles.set('ui', {
        browser: {
          'retry.test.ts': filename,
        },
      });
      const delayedWrite = new Promise<void>((resolveWrite, rejectWrite) => {
        setTimeout(() => {
          writeFile(filename, JSON.stringify({ result: 'retried' }), 'utf8').then(
            () => resolveWrite(),
            rejectWrite,
          );
        }, 60);
      });

      const onFileRead = vi.fn();
      const onFinished = vi.fn().mockResolvedValue(undefined);
      const onDebug = Object.assign(vi.fn(), { enabled: true });

      await expect(
        provider.readCoverageFiles({
          onFileRead,
          onFinished,
          onDebug,
        }),
      ).resolves.toBeUndefined();

      await delayedWrite;
      expect(onFileRead).toHaveBeenCalledWith({ result: 'retried' });
      expect(onFinished).toHaveBeenCalledWith('ui', 'browser');
    } finally {
      await rm(reportsDirectory, { recursive: true, force: true });
    }
  });

  it('surfaces deferred coverage write failures before processing results', async () => {
    const reportsDirectory = await mkdtemp(join(tmpdir(), 'drydock-ui-coverage-'));
    const mockProvider = createMockCoverageProvider(reportsDirectory);
    const blockedReportsDirectory = resolve(reportsDirectory, 'blocked');
    await writeFile(blockedReportsDirectory, 'not-a-directory', 'utf8');
    mockProvider.options.reportsDirectory = blockedReportsDirectory;

    try {
      const coverageProviderModule = await loadCoverageProvider(mockProvider);
      const provider = await coverageProviderModule.getProvider();

      provider.onAfterSuiteRun({
        coverage: { result: 'will-fail' },
        environment: 'browser',
        projectName: 'ui',
        testFiles: ['write-error.test.ts'],
      });

      const onFileRead = vi.fn();
      const onFinished = vi.fn().mockResolvedValue(undefined);
      const onDebug = Object.assign(vi.fn(), { enabled: true });

      const readError = await provider
        .readCoverageFiles({
          onFileRead,
          onFinished,
          onDebug,
        })
        .catch((error) => error);

      expect(readError).toBeInstanceOf(Error);
      expect((readError as NodeJS.ErrnoException).code).toBeTruthy();
      expect((readError as Error).message).toContain(blockedReportsDirectory);
      expect(onFileRead).not.toHaveBeenCalled();
      expect(onFinished).not.toHaveBeenCalled();
    } finally {
      await rm(reportsDirectory, { recursive: true, force: true });
    }
  });
});
