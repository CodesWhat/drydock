import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export const COVERAGE_READ_RETRY_DELAY_MS = 15;
export const COVERAGE_READ_RETRY_MAX_ATTEMPTS = 40;
export const COVERAGE_WRITE_SETTLE_DELAY_MS = 5;
export const COVERAGE_WRITE_SETTLE_IDLE_WINDOW_MS = 50;
export const COVERAGE_WRITE_RETRY_DELAY_MS = 15;
export const COVERAGE_WRITE_RETRY_MAX_ATTEMPTS = 40;
export const DEFAULT_PROJECT = Symbol.for('default-project');

export type CoverageDebugLogger = ((message: string) => void) & { enabled?: boolean };

export interface CoverageProviderForCleanup {
  coverageFilesDirectory?: string;
  coverageFiles: Map<unknown, unknown>;
  pendingPromises: Promise<unknown>[];
}

export interface CoverageProviderForWrites extends CoverageProviderForCleanup {
  coverageFilesDirectory: string;
  coverageFiles: Map<unknown, Record<string, Record<string, string>>>;
}

export interface CoverageProviderForReads {
  coverageFiles: Map<unknown, Record<string, Record<string, string>>>;
  ctx: {
    getProjectByName(name: unknown): unknown;
  };
  options: {
    processingConcurrency: number;
  };
  toSlices: (filenames: string[], concurrency: number) => string[][];
  pendingPromises: Promise<unknown>[];
}

const sleep = (durationMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });

export async function readCoverageFileWithRetry(filename: string): Promise<string> {
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
}

export async function writeCoverageFileWithRetry(filename: string, content: string): Promise<void> {
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
}

export function resolveReportsDirectory(
  provider: Pick<CoverageProviderForCleanup, 'coverageFilesDirectory'> & {
    options?: { reportsDirectory?: string };
  },
): string | undefined {
  const configuredReportsDirectory = provider.options?.reportsDirectory;
  const fallbackReportsDirectory =
    typeof provider.coverageFilesDirectory === 'string' &&
    provider.coverageFilesDirectory.length > 0
      ? dirname(provider.coverageFilesDirectory)
      : undefined;

  return typeof configuredReportsDirectory === 'string' && configuredReportsDirectory.length > 0
    ? configuredReportsDirectory
    : fallbackReportsDirectory;
}

export function assignIsolatedCoverageDirectory(
  provider: CoverageProviderForCleanup & {
    options?: { reportsDirectory?: string };
  },
): void {
  const reportsDirectory = resolveReportsDirectory(provider);
  if (typeof reportsDirectory !== 'string' || reportsDirectory.length === 0) {
    return;
  }

  const uniqueCoverageTmpDirectory = `.tmp-${process.pid}-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}`;
  provider.coverageFilesDirectory = resolve(reportsDirectory, uniqueCoverageTmpDirectory);
}

export function createCoverageFilenameFactory(): (coverageFilesDirectory: string) => string {
  let coverageWriteSequence = 0;
  return (coverageFilesDirectory: string): string =>
    resolve(coverageFilesDirectory, `coverage-${coverageWriteSequence++}.json`);
}

export async function waitForPendingWrites(provider: CoverageProviderForCleanup): Promise<void> {
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
}

export async function resetCoverageProvider(
  provider: CoverageProviderForCleanup & {
    options?: { reportsDirectory?: string };
  },
  originalClean: ((clean?: boolean) => Promise<void>) | undefined,
  clean: boolean,
  onReset: () => void,
): Promise<void> {
  assignIsolatedCoverageDirectory(provider);
  onReset();

  if (originalClean) {
    await originalClean(clean);
    return;
  }

  if (typeof provider.coverageFilesDirectory === 'string') {
    await mkdir(provider.coverageFilesDirectory, { recursive: true });
  }

  provider.coverageFiles = new Map();
  provider.pendingPromises = [];
}

export function createCoverageAfterSuiteRunHandler(
  provider: CoverageProviderForWrites,
  writeErrors: unknown[],
  coveragePayloads: Map<string, string>,
  createCoverageFilename: () => string,
): (args: {
  coverage?: unknown;
  environment: string;
  projectName?: string;
  testFiles: string[];
}) => void {
  return ({ coverage, environment, projectName, testFiles }) => {
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
    const filename = createCoverageFilename();
    coverageByProject[environment] ??= {};
    coverageByProject[environment][testFileKey] = filename;

    const json = JSON.stringify(coverage);
    coveragePayloads.set(filename, json);

    const pendingWrite = writeCoverageFileWithRetry(filename, json).catch((error: unknown) => {
      writeErrors.push(error);
    });
    provider.pendingPromises.push(pendingWrite);
  };
}

async function visitCoverageProjectFiles({
  provider,
  projectName,
  coveragePerProject,
  onDebug,
  visitFile,
  onFinished,
}: {
  provider: CoverageProviderForReads;
  projectName: unknown;
  coveragePerProject: Record<string, Record<string, string>>;
  onDebug: CoverageDebugLogger;
  visitFile: (filename: string) => Promise<void>;
  onFinished: (project: unknown, environment: string) => Promise<void>;
}): Promise<void> {
  const project = provider.ctx.getProjectByName(projectName);

  for (const [environment, coverageByTestfiles] of Object.entries(coveragePerProject)) {
    const filenames = Object.values(coverageByTestfiles) as string[];
    let index = 0;

    for (const chunk of provider.toSlices(filenames, provider.options.processingConcurrency)) {
      if (onDebug.enabled) {
        index += chunk.length;
        onDebug(`Reading coverage results ${index}/${filenames.length}`);
      }

      await Promise.all(chunk.map(async (filename) => visitFile(filename)));
    }

    await onFinished(project, environment);
  }
}

export async function visitCoverageFiles(
  provider: CoverageProviderForReads,
  onDebug: CoverageDebugLogger,
  visitFile: (filename: string) => Promise<void>,
  onFinished: (project: unknown, environment: string) => Promise<void>,
): Promise<void> {
  for (const [projectName, coveragePerProject] of provider.coverageFiles.entries()) {
    await visitCoverageProjectFiles({
      provider,
      projectName,
      coveragePerProject,
      onDebug,
      visitFile,
      onFinished,
    });
  }
}

export function createCoverageReadFilesHandler(
  provider: CoverageProviderForCleanup & CoverageProviderForReads,
  writeErrors: unknown[],
  readCoverageFile: (
    filename: string,
    onFileRead: (coverage: unknown) => void,
    onDebug: CoverageDebugLogger,
  ) => Promise<void>,
): (args: {
  onFileRead: (coverage: unknown) => void;
  onFinished: (project: unknown, environment: string) => Promise<void>;
  onDebug: CoverageDebugLogger;
}) => Promise<void> {
  return async ({ onFileRead, onFinished, onDebug }) => {
    await waitForPendingWrites(provider);
    if (writeErrors.length > 0) {
      throw writeErrors[0];
    }

    await visitCoverageFiles(
      provider,
      onDebug,
      async (filename: string) => {
        await readCoverageFile(filename, onFileRead, onDebug);
      },
      onFinished,
    );
  };
}
