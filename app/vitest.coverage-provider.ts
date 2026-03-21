import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import v8CoverageModule from '@vitest/coverage-v8';

const COVERAGE_READ_RETRY_DELAY_MS = 15;
const COVERAGE_READ_RETRY_MAX_ATTEMPTS = 40;
const COVERAGE_WRITE_SETTLE_DELAY_MS = 5;
const COVERAGE_WRITE_SETTLE_IDLE_WINDOW_MS = 50;
const COVERAGE_WRITE_RETRY_DELAY_MS = 15;
const COVERAGE_WRITE_RETRY_MAX_ATTEMPTS = 40;
const DEFAULT_PROJECT = Symbol.for('default-project');

let coverageWriteSequence = 0;

const sleep = (durationMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });

// In-memory fallback for coverage data. If the temp file disappears before the
// read phase (e.g. OS tmpdir cleanup, vitest internal clean-up race), the data
// is still available here.  Keyed by the same filename used on disk.
const coveragePayloads = new Map<string, string>();

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

async function writeCoverageFileWithRetry(filename: string, content: string): Promise<void> {
  for (let attempt = 1; attempt <= COVERAGE_WRITE_RETRY_MAX_ATTEMPTS; attempt += 1) {
    try {
      await mkdir(dirname(filename), { recursive: true });
      await writeFile(filename, content, 'utf-8');
      return;
    } catch (error) {
      const isMissingCoverageDirectory = (error as NodeJS.ErrnoException)?.code === 'ENOENT';
      if (!isMissingCoverageDirectory || attempt === COVERAGE_WRITE_RETRY_MAX_ATTEMPTS) {
        throw error;
      }
      await sleep(COVERAGE_WRITE_RETRY_DELAY_MS);
    }
  }
  throw new Error(`Unable to write coverage file "${filename}"`);
}

const coverageProviderModule = {
  ...v8CoverageModule,
  async getProvider() {
    const provider = (await v8CoverageModule.getProvider()) as any;
    const writeErrors: unknown[] = [];
    const resolveReportsDirectory = (): string | undefined => {
      const configuredReportsDirectory = provider.options?.reportsDirectory;
      const fallbackReportsDirectory =
        typeof provider.coverageFilesDirectory === 'string' &&
        provider.coverageFilesDirectory.length > 0
          ? dirname(provider.coverageFilesDirectory)
          : undefined;
      return typeof configuredReportsDirectory === 'string' && configuredReportsDirectory.length > 0
        ? configuredReportsDirectory
        : fallbackReportsDirectory;
    };

    const assignIsolatedCoverageDirectory = () => {
      const reportsDirectory = resolveReportsDirectory();
      if (typeof reportsDirectory !== 'string' || reportsDirectory.length === 0) {
        return;
      }

      const uniqueCoverageTmpDirectory = `.tmp-${process.pid}-${Date.now()}-${Math.random()
        .toString(16)
        .slice(2)}`;
      provider.coverageFilesDirectory = resolve(reportsDirectory, uniqueCoverageTmpDirectory);
    };

    assignIsolatedCoverageDirectory();

    const originalClean =
      typeof provider.clean === 'function' ? provider.clean.bind(provider) : undefined;
    provider.clean = async (clean = true) => {
      assignIsolatedCoverageDirectory();
      writeErrors.length = 0;
      coveragePayloads.clear();

      if (originalClean) {
        await originalClean(clean);
        return;
      }

      if (typeof provider.coverageFilesDirectory === 'string') {
        await mkdir(provider.coverageFilesDirectory, { recursive: true });
      }
      provider.coverageFiles = new Map();
      provider.pendingPromises = [];
    };

    provider.onAfterSuiteRun = ({
      coverage,
      environment,
      projectName,
      testFiles,
    }: {
      coverage?: unknown;
      environment: string;
      projectName?: string;
      testFiles: string[];
    }) => {
      if (!coverage) {
        return;
      }

      const resolvedProject = projectName || DEFAULT_PROJECT;
      let coverageByProject = provider.coverageFiles.get(resolvedProject);
      if (!coverageByProject) {
        coverageByProject = {};
        provider.coverageFiles.set(resolvedProject, coverageByProject);
      }

      const testFileKey = testFiles.join();
      const filename = resolve(
        provider.coverageFilesDirectory,
        `coverage-${coverageWriteSequence++}.json`,
      );
      coverageByProject[environment] ??= {};
      coverageByProject[environment][testFileKey] = filename;

      const json = JSON.stringify(coverage);
      coveragePayloads.set(filename, json);

      // Attach a catch handler immediately to avoid unhandled rejections from async writes.
      const pendingWrite = writeCoverageFileWithRetry(filename, json).catch((error: unknown) => {
        writeErrors.push(error);
      });
      provider.pendingPromises.push(pendingWrite);
    };

    provider.readCoverageFiles = async ({
      onFileRead,
      onFinished,
      onDebug,
    }: {
      onFileRead: (coverage: unknown) => void;
      onFinished: (project: unknown, environment: string) => Promise<void>;
      onDebug: ((message: string) => void) & { enabled?: boolean };
    }) => {
      const waitForPendingWrites = async () => {
        let idleDurationMs = 0;
        while (idleDurationMs < COVERAGE_WRITE_SETTLE_IDLE_WINDOW_MS) {
          while (provider.pendingPromises.length > 0) {
            const pendingWrites = provider.pendingPromises;
            provider.pendingPromises = [];
            await Promise.all(pendingWrites);
            idleDurationMs = 0;
          }

          await sleep(COVERAGE_WRITE_SETTLE_DELAY_MS);
          if (provider.pendingPromises.length === 0) {
            idleDurationMs += COVERAGE_WRITE_SETTLE_DELAY_MS;
          } else {
            idleDurationMs = 0;
          }
        }
      };

      await waitForPendingWrites();
      if (writeErrors.length > 0) {
        throw writeErrors[0];
      }

      for (const [projectName, coveragePerProject] of provider.coverageFiles.entries()) {
        for (const [environment, coverageByTestfiles] of Object.entries(coveragePerProject)) {
          const filenames = Object.values(coverageByTestfiles) as string[];
          const project = provider.ctx.getProjectByName(projectName);
          let index = 0;

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
                let contents: string | undefined = coveragePayloads.get(filename);
                if (contents === undefined) {
                  contents = await readCoverageFileWithRetry(filename);
                }
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
