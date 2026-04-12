import v8CoverageModule from '@vitest/coverage-v8';

import {
  assignIsolatedCoverageDirectory,
  createCoverageAfterSuiteRunHandler,
  createCoverageFilenameFactory,
  createCoverageReadFilesHandler,
  readCoverageFileWithRetry,
  resetCoverageProvider,
} from '../app/vitest.coverage-provider.shared.js';

const coveragePayloads = new Map<string, string>();
const createCoverageFilename = createCoverageFilenameFactory();

const parseCoverageFile = (
  filename: string,
  contents: string,
  onDebug: ((message: string) => void) & { enabled?: boolean },
): unknown => {
  try {
    return JSON.parse(contents);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (onDebug.enabled) {
      onDebug(`Skipping corrupt coverage file "${filename}": ${message}`);
    }
    return undefined;
  }
};

const coverageProviderModule = {
  ...v8CoverageModule,
  async getProvider() {
    const provider = (await v8CoverageModule.getProvider()) as any;
    const writeErrors: unknown[] = [];

    assignIsolatedCoverageDirectory(provider);

    const originalClean =
      typeof provider.clean === 'function' ? provider.clean.bind(provider) : undefined;
    provider.clean = async (clean = true) => {
      await resetCoverageProvider(provider, originalClean, clean, () => {
        writeErrors.length = 0;
        coveragePayloads.clear();
      });
    };

    provider.onAfterSuiteRun = createCoverageAfterSuiteRunHandler(
      provider,
      writeErrors,
      coveragePayloads,
      () => createCoverageFilename(provider.coverageFilesDirectory),
    );

    provider.readCoverageFiles = createCoverageReadFilesHandler(
      provider,
      writeErrors,
      async (filename, onFileRead, onDebug) => {
        let contents = coveragePayloads.get(filename);
        if (contents === undefined) {
          contents = await readCoverageFileWithRetry(filename);
        }

        const parsedCoverage = parseCoverageFile(filename, contents, onDebug);
        if (parsedCoverage !== undefined) {
          onFileRead(parsedCoverage);
        }
      },
    );

    provider.cleanAfterRun = async () => {
      // Keep temp coverage files around until process exit to avoid late ENOENT reads.
    };

    return provider;
  },
};

export default coverageProviderModule;
