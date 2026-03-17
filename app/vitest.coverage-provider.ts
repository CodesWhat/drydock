import { readFile } from 'node:fs/promises';

import v8CoverageModule from '@vitest/coverage-v8';

const COVERAGE_READ_RETRY_DELAY_MS = 15;
const COVERAGE_READ_RETRY_MAX_ATTEMPTS = 40;

const sleep = (durationMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });

async function readCoverageFileWithRetry(filename: string): Promise<string> {
  for (let attempt = 1; attempt <= COVERAGE_READ_RETRY_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await readFile(filename, 'utf-8');
    } catch (error) {
      const isMissingCoverageFile = (error as NodeJS.ErrnoException)?.code === 'ENOENT';
      if (!isMissingCoverageFile || attempt === COVERAGE_READ_RETRY_MAX_ATTEMPTS) {
        throw error;
      }
      await sleep(COVERAGE_READ_RETRY_DELAY_MS);
    }
  }
  throw new Error(`Unable to read coverage file "${filename}"`);
}

const coverageProviderModule = {
  ...v8CoverageModule,
  async getProvider() {
    const provider = (await v8CoverageModule.getProvider()) as any;

    provider.readCoverageFiles = async ({
      onFileRead,
      onFinished,
      onDebug,
    }: {
      onFileRead: (coverage: unknown) => void;
      onFinished: (project: unknown, environment: string) => Promise<void>;
      onDebug: ((message: string) => void) & { enabled?: boolean };
    }) => {
      let index = 0;
      const waitForPendingWrites = async () => {
        while (provider.pendingPromises.length > 0) {
          const pendingWrites = provider.pendingPromises;
          provider.pendingPromises = [];
          await Promise.all(pendingWrites);
        }
      };

      await waitForPendingWrites();

      for (const [projectName, coveragePerProject] of provider.coverageFiles.entries()) {
        for (const [environment, coverageByTestfiles] of Object.entries(coveragePerProject)) {
          const filenames = Object.values(coverageByTestfiles) as string[];
          const project = provider.ctx.getProjectByName(projectName);

          for (const chunk of provider.toSlices(
            filenames,
            provider.options.processingConcurrency,
          )) {
            if (onDebug.enabled) {
              index += chunk.length;
              onDebug(`Reading coverage results ${index}/${filenames.length}`);
            }
            await Promise.all(
              chunk.map(async (filename: string) => {
                const contents = await readCoverageFileWithRetry(filename);
                onFileRead(JSON.parse(contents));
              }),
            );
          }

          await onFinished(project, environment);
        }
      }
    };

    provider.cleanAfterRun = async () => {
      // Keep .tmp around until process exit to avoid ENOENT from late coverage writes.
    };

    return provider;
  },
};

export default coverageProviderModule;
