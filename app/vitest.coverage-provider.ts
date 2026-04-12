import v8CoverageModule from '@vitest/coverage-v8';

import {
  assignIsolatedCoverageDirectory,
  createCoverageAfterSuiteRunHandler,
  createCoverageFilenameFactory,
  createCoverageReadFilesHandler,
  readCoverageFileWithRetry,
  resetCoverageProvider,
} from './vitest.coverage-provider.shared.js';

const coveragePayloads = new Map<string, string>();
const createCoverageFilename = createCoverageFilenameFactory();

const readCoverageFile = async (
  filename: string,
  onFileRead: (coverage: unknown) => void,
): Promise<void> => {
  const contents = coveragePayloads.get(filename) ?? (await readCoverageFileWithRetry(filename));
  onFileRead(JSON.parse(contents));
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
      async (filename, onFileRead) => {
        await readCoverageFile(filename, onFileRead);
      },
    );

    provider.cleanAfterRun = async () => {
      // Keep .tmp around until process exit to avoid ENOENT from late coverage writes.
    };

    return provider;
  },
};

export default coverageProviderModule;
