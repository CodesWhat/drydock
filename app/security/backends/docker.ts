import { isAbsolute } from 'node:path';
import { Writable } from 'node:stream';

const DEFAULT_MEMORY_BYTES = 512 * 1024 * 1024;
const DEFAULT_PIDS_LIMIT = 64;
const DEFAULT_TMPFS_SIZE_BYTES = 64 * 1024 * 1024;
const DEFAULT_CACHE_TARGET = '/cache';
const MAX_ARGUMENTS = 256;
const MAX_ARGUMENT_BYTES = 64 * 1024;
const MAX_ENVIRONMENT_ENTRIES = 128;
const DEFAULT_PULL_TIMEOUT_MS = 10 * 60 * 1000;
const PINNED_IMAGE_PATTERN = /^[^\s@]+@sha256:[a-fA-F0-9]{64}$/;
const ENVIRONMENT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const VOLUME_CACHE_PATTERN = /^volume:([A-Za-z0-9][A-Za-z0-9_.-]{0,127})$/;

export interface DockerScannerRegistryAuth {
  username?: string;
  password?: string;
  email?: string;
  serveraddress?: string;
  identitytoken?: string;
  registrytoken?: string;
}

export interface DockerScannerHardeningOptions {
  cacheTarget?: string;
  memoryBytes?: number;
  networkMode?: string;
  pidsLimit?: number;
  tmpfsSizeBytes?: number;
}

export interface DockerScannerBackendOptions {
  client: DockerScannerClient;
  cacheDir: string;
  hardening?: DockerScannerHardeningOptions;
}

export interface DockerScannerRunOptions {
  image: string;
  args: string[];
  env?: Record<string, string>;
  timeoutMs: number;
  maxOutputBytes: number;
  auth?: DockerScannerRegistryAuth;
}

export interface DockerScannerRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface DockerScannerImageInfo {
  image: string;
  id?: string;
  digest: string;
  version?: string;
}

interface DockerScannerStream {
  once?: (event: string, listener: (...args: unknown[]) => void) => unknown;
}

interface DockerScannerContainer {
  attach: (options: {
    stream: boolean;
    stdout: boolean;
    stderr: boolean;
  }) => Promise<DockerScannerStream>;
  start: () => Promise<unknown>;
  wait: () => Promise<{ StatusCode?: number }>;
  stop: (options: { t: number }) => Promise<unknown>;
  kill: () => Promise<unknown>;
  remove: (options: { force: boolean }) => Promise<unknown>;
}

interface DockerScannerClient {
  createContainer: (options: Record<string, unknown>) => Promise<DockerScannerContainer>;
  getImage: (image: string) => {
    inspect: () => Promise<{
      Id?: string;
      RepoDigests?: string[];
      Config?: { Labels?: Record<string, string> };
    }>;
  };
  modem: {
    demuxStream: (stream: DockerScannerStream, stdout: Writable, stderr: Writable) => void;
    followProgress: (
      stream: unknown,
      callback: (error: Error | null, output?: unknown) => void,
    ) => void;
  };
  pull: (
    image: string,
    options: { authconfig?: DockerScannerRegistryAuth },
    callback: (error: Error | null, stream?: unknown) => void,
  ) => void;
}

interface ResolvedHardeningOptions {
  cacheTarget: string;
  memoryBytes: number;
  networkMode: string;
  pidsLimit: number;
  tmpfsSizeBytes: number;
}

class DockerScannerTimeoutError extends Error {}
class DockerScannerOutputLimitError extends Error {}

function assertPinnedImage(image: string): void {
  if (!PINNED_IMAGE_PATTERN.test(image)) {
    throw new Error('Scanner worker image must be pinned by sha256 digest');
  }
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function assertAbsoluteContainerPath(value: string, name: string): void {
  if (!value.startsWith('/') || value === '/' || value.includes('\0')) {
    throw new Error(`${name} must be a non-root absolute container path`);
  }
}

function validateCacheDirectory(cacheDir: string): void {
  if (VOLUME_CACHE_PATTERN.test(cacheDir)) {
    return;
  }
  if (
    !isAbsolute(cacheDir) ||
    cacheDir === '/' ||
    cacheDir.includes('\0') ||
    cacheDir === '/var/run/docker.sock'
  ) {
    throw new Error('cacheDir must be a safe absolute provider cache directory');
  }
}

function resolveHardeningOptions(
  hardening: DockerScannerHardeningOptions | undefined,
): ResolvedHardeningOptions {
  const resolved = {
    cacheTarget: hardening?.cacheTarget ?? DEFAULT_CACHE_TARGET,
    memoryBytes: hardening?.memoryBytes ?? DEFAULT_MEMORY_BYTES,
    networkMode: hardening?.networkMode ?? 'none',
    pidsLimit: hardening?.pidsLimit ?? DEFAULT_PIDS_LIMIT,
    tmpfsSizeBytes: hardening?.tmpfsSizeBytes ?? DEFAULT_TMPFS_SIZE_BYTES,
  };
  assertAbsoluteContainerPath(resolved.cacheTarget, 'hardening.cacheTarget');
  assertPositiveInteger(resolved.memoryBytes, 'hardening.memoryBytes');
  assertPositiveInteger(resolved.pidsLimit, 'hardening.pidsLimit');
  assertPositiveInteger(resolved.tmpfsSizeBytes, 'hardening.tmpfsSizeBytes');
  if (!resolved.networkMode.trim() || resolved.networkMode.includes('\0')) {
    throw new Error('hardening.networkMode must be a non-empty Docker network mode');
  }
  return resolved;
}

function validateRegistryAuth(
  auth: DockerScannerRegistryAuth | undefined,
): DockerScannerRegistryAuth | undefined {
  if (auth === undefined) {
    return undefined;
  }
  const allowedKeys = [
    'username',
    'password',
    'email',
    'serveraddress',
    'identitytoken',
    'registrytoken',
  ] as const;
  const normalized: DockerScannerRegistryAuth = {};
  for (const key of allowedKeys) {
    const value = auth[key];
    if (value === undefined) {
      continue;
    }
    if (typeof value !== 'string' || value.includes('\0')) {
      throw new Error(`Registry auth ${key} must be a string without null bytes`);
    }
    normalized[key] = value;
  }
  return normalized;
}

function validateRunOptions(options: DockerScannerRunOptions): void {
  assertPinnedImage(options.image);
  if (
    !Array.isArray(options.args) ||
    options.args.length === 0 ||
    options.args.length > MAX_ARGUMENTS
  ) {
    throw new Error(`args must contain between 1 and ${MAX_ARGUMENTS} entries`);
  }
  for (const argument of options.args) {
    if (
      typeof argument !== 'string' ||
      argument.includes('\0') ||
      Buffer.byteLength(argument, 'utf8') > MAX_ARGUMENT_BYTES
    ) {
      throw new Error('args entries must be bounded strings without null bytes');
    }
  }
  const environmentEntries = Object.entries(options.env ?? {});
  if (environmentEntries.length > MAX_ENVIRONMENT_ENTRIES) {
    throw new Error(`env must contain at most ${MAX_ENVIRONMENT_ENTRIES} entries`);
  }
  for (const [name, value] of environmentEntries) {
    if (!ENVIRONMENT_NAME_PATTERN.test(name)) {
      throw new Error(`Invalid environment variable name: ${name}`);
    }
    if (typeof value !== 'string' || value.includes('\0')) {
      throw new Error(`Invalid environment variable value for ${name}`);
    }
  }
  assertPositiveInteger(options.timeoutMs, 'timeoutMs');
  assertPositiveInteger(options.maxOutputBytes, 'maxOutputBytes');
  validateRegistryAuth(options.auth);
}

function bytesToTmpfsMegabytes(bytes: number): number {
  return Math.max(1, Math.ceil(bytes / (1024 * 1024)));
}

function buildContainerConfiguration(
  options: DockerScannerRunOptions,
  cacheDir: string,
  hardening: ResolvedHardeningOptions,
): Record<string, unknown> {
  const volumeMatch = cacheDir.match(VOLUME_CACHE_PATTERN);
  return {
    Image: options.image,
    Cmd: [...options.args],
    Env: Object.entries(options.env ?? {}).map(([name, value]) => `${name}=${value}`),
    AttachStdout: true,
    AttachStderr: true,
    Tty: false,
    OpenStdin: false,
    HostConfig: {
      AutoRemove: false,
      ReadonlyRootfs: true,
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges:true'],
      PidsLimit: hardening.pidsLimit,
      Memory: hardening.memoryBytes,
      NetworkMode: hardening.networkMode,
      Tmpfs: {
        '/tmp': `rw,noexec,nosuid,nodev,size=${bytesToTmpfsMegabytes(hardening.tmpfsSizeBytes)}m`,
      },
      Mounts: [
        {
          Type: volumeMatch ? 'volume' : 'bind',
          Source: volumeMatch?.[1] || cacheDir,
          Target: hardening.cacheTarget,
          ReadOnly: false,
        },
      ],
    },
  };
}

function createStreamCompletion(stream: DockerScannerStream): {
  done: Promise<void>;
  failed: Promise<never>;
} {
  let resolveDone!: () => void;
  let rejectFailed!: (error: Error) => void;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  const failed = new Promise<never>((_resolve, reject) => {
    rejectFailed = reject;
  });
  if (typeof stream.once !== 'function') {
    resolveDone?.();
    return { done, failed };
  }
  stream.once('end', () => resolveDone?.());
  stream.once('close', () => resolveDone?.());
  stream.once('error', (error: unknown) =>
    rejectFailed?.(error instanceof Error ? error : new Error(String(error))),
  );
  return { done, failed };
}

function createOutputCollectors(maxOutputBytes: number): {
  stdout: Writable;
  stderr: Writable;
  stdoutText: () => string;
  stderrText: () => string;
  overflowError: () => DockerScannerOutputLimitError | undefined;
  overflow: Promise<never>;
} {
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  let totalBytes = 0;
  let rejectOverflow: (error: Error) => void;
  let overflowed = false;
  let outputLimitError: DockerScannerOutputLimitError | undefined;
  const overflow = new Promise<never>((_resolve, reject) => {
    rejectOverflow = reject;
  });

  const createCollector = (chunks: Buffer[]) =>
    new Writable({
      decodeStrings: false,
      write(chunk: Buffer | string, _encoding, callback) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const remainingBytes = Math.max(0, maxOutputBytes - totalBytes);
        if (remainingBytes > 0) {
          chunks.push(buffer.subarray(0, remainingBytes));
          totalBytes += Math.min(buffer.length, remainingBytes);
        }
        if (buffer.length > remainingBytes && !overflowed) {
          overflowed = true;
          outputLimitError = new DockerScannerOutputLimitError(
            `Scanner worker output exceeded ${maxOutputBytes} bytes`,
          );
          rejectOverflow?.(outputLimitError);
        }
        callback();
      },
    });

  return {
    stdout: createCollector(stdoutChunks),
    stderr: createCollector(stderrChunks),
    stdoutText: () => Buffer.concat(stdoutChunks).toString('utf8'),
    stderrText: () => Buffer.concat(stderrChunks).toString('utf8'),
    overflowError: () => outputLimitError,
    overflow,
  };
}

async function terminateWorker(container: DockerScannerContainer): Promise<void> {
  try {
    await container.stop({ t: 0 });
  } catch {
    try {
      await container.kill();
    } catch {
      // Removal below is the final cleanup attempt.
    }
  }
}

function waitForTimeout(timeoutMs: number): {
  promise: Promise<never>;
  clear: () => void;
} {
  let timer: ReturnType<typeof setTimeout>;
  const promise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new DockerScannerTimeoutError(`Scanner worker timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  return {
    promise,
    clear: () => clearTimeout(timer),
  };
}

function parseDigest(image: string, repoDigests: string[] | undefined): string {
  const requestedDigest = image.match(/@((?:sha256):[a-fA-F0-9]{64})$/)?.[1];
  const inspectedDigest = repoDigests
    ?.map((repoDigest) => repoDigest.match(/@((?:sha256):[a-fA-F0-9]{64})$/)?.[1])
    .find((digest): digest is string => digest !== undefined);
  return requestedDigest ?? inspectedDigest ?? image.slice(image.lastIndexOf('@') + 1);
}

export function createDockerScannerBackend(options: DockerScannerBackendOptions) {
  if (!options?.client) {
    throw new Error('Docker scanner backend requires a client');
  }
  validateCacheDirectory(options.cacheDir);
  const hardening = resolveHardeningOptions(options.hardening);
  const pullsInFlight = new Map<string, Promise<void>>();

  async function pullImage(
    image: string,
    auth?: DockerScannerRegistryAuth,
    timeoutMs = DEFAULT_PULL_TIMEOUT_MS,
  ): Promise<void> {
    assertPinnedImage(image);
    assertPositiveInteger(timeoutMs, 'timeoutMs');
    const normalizedAuth = validateRegistryAuth(auth);
    const existingPull = pullsInFlight.get(image);
    if (existingPull) {
      return existingPull;
    }

    const rawPull = new Promise<void>((resolve, reject) => {
      options.client.pull(
        image,
        { ...(normalizedAuth ? { authconfig: normalizedAuth } : {}) },
        (error, stream) => {
          if (error) {
            reject(error);
            return;
          }
          if (!stream) {
            reject(new Error('Docker image pull returned no progress stream'));
            return;
          }
          try {
            options.client.modem.followProgress(stream, (progressError) => {
              if (progressError) {
                reject(progressError);
                return;
              }
              resolve();
            });
          } catch (followError: unknown) {
            reject(followError);
          }
        },
      );
    });
    const timeout = waitForTimeout(timeoutMs);
    const pullPromise = Promise.race([rawPull, timeout.promise]).finally(() => {
      timeout.clear();
      pullsInFlight.delete(image);
    });
    pullsInFlight.set(image, pullPromise);
    return pullPromise;
  }

  async function ensureImage(
    image: string,
    auth: DockerScannerRegistryAuth | undefined,
    timeoutMs: number,
  ): Promise<void> {
    try {
      await options.client.getImage(image).inspect();
    } catch (error: unknown) {
      if ((error as { statusCode?: unknown })?.statusCode !== 404) {
        throw error;
      }
      await pullImage(image, auth, timeoutMs);
    }
  }

  async function run(runOptions: DockerScannerRunOptions): Promise<DockerScannerRunResult> {
    validateRunOptions(runOptions);
    const startedAt = Date.now();
    const preparationTimeout = waitForTimeout(runOptions.timeoutMs);
    try {
      await Promise.race([
        ensureImage(runOptions.image, runOptions.auth, runOptions.timeoutMs),
        preparationTimeout.promise,
      ]);
    } finally {
      preparationTimeout.clear();
    }
    const remainingTimeoutMs = runOptions.timeoutMs - (Date.now() - startedAt);
    if (remainingTimeoutMs <= 0) {
      throw new DockerScannerTimeoutError(
        `Scanner worker timed out after ${runOptions.timeoutMs}ms`,
      );
    }

    const timeout = waitForTimeout(remainingTimeoutMs);
    let container: DockerScannerContainer | undefined;
    let createContainerPromise: Promise<DockerScannerContainer> | undefined;
    try {
      createContainerPromise = options.client.createContainer(
        buildContainerConfiguration(runOptions, options.cacheDir, hardening),
      );
      container = await Promise.race([createContainerPromise, timeout.promise]);
      const stream = await Promise.race([
        container.attach({ stream: true, stdout: true, stderr: true }),
        timeout.promise,
      ]);
      const streamCompletion = createStreamCompletion(stream);
      const collectors = createOutputCollectors(runOptions.maxOutputBytes);
      // Attach handlers before demux/start so an early stream or output failure cannot
      // become an unhandled rejection if container startup fails first. Promise.race
      // below still observes the original rejected promises during normal execution.
      void streamCompletion.failed.catch(() => undefined);
      void collectors.overflow.catch(() => undefined);
      options.client.modem.demuxStream(stream, collectors.stdout, collectors.stderr);
      await Promise.race([
        container.start(),
        timeout.promise,
        collectors.overflow,
        streamCompletion.failed,
      ]);

      const waitResult: { StatusCode?: number } = await Promise.race([
        container.wait(),
        timeout.promise,
        collectors.overflow,
        streamCompletion.failed,
      ]);
      await Promise.race([
        streamCompletion.done,
        collectors.overflow,
        streamCompletion.failed,
        timeout.promise,
      ]);
      const outputLimitError = collectors.overflowError();
      if (outputLimitError) {
        throw outputLimitError;
      }

      const exitCode = waitResult.StatusCode;
      if (!Number.isInteger(exitCode)) {
        throw new Error('Scanner worker returned an invalid exit status');
      }
      const stdout = collectors.stdoutText();
      const stderr = collectors.stderrText();
      if (exitCode !== 0) {
        throw new Error(
          `Scanner worker exited with status ${exitCode}${stderr ? `: ${stderr.trim()}` : ''}`,
        );
      }
      return { exitCode, stdout, stderr } as DockerScannerRunResult;
    } catch (error: unknown) {
      if (error instanceof DockerScannerTimeoutError && createContainerPromise && !container) {
        void createContainerPromise
          .then((lateContainer) => lateContainer.remove({ force: true }))
          .catch(() => undefined);
      }
      if (
        container &&
        (error instanceof DockerScannerTimeoutError ||
          error instanceof DockerScannerOutputLimitError)
      ) {
        await terminateWorker(container);
      }
      throw error;
    } finally {
      timeout.clear();
      if (container) {
        try {
          await container.remove({ force: true });
        } catch {
          // Best-effort cleanup must not hide the scanner result or primary failure.
        }
      }
    }
  }

  async function inspectImage(image: string): Promise<DockerScannerImageInfo> {
    assertPinnedImage(image);
    const inspected = await options.client.getImage(image).inspect();
    const version = inspected.Config?.Labels?.['org.opencontainers.image.version'];
    return {
      image,
      ...(typeof inspected.Id === 'string' && inspected.Id ? { id: inspected.Id } : {}),
      digest: parseDigest(image, inspected.RepoDigests),
      ...(typeof version === 'string' && version ? { version } : {}),
    };
  }

  return { pullImage, run, inspectImage };
}
