/**
 * Post-start liveness verification.
 *
 * After Docker `start()` returns, the container has been launched but may
 * still exit immediately (bad command, broken entrypoint, missing dependency).
 * For images without a configured `HEALTHCHECK`, the existing health gate is
 * skipped — so an exit-on-launch was being treated as a successful update.
 *
 * This module sleeps a brief grace period after start, then re-inspects the
 * new container. If the container is no longer running, the caller throws and
 * the existing rollback machinery takes over. Containers WITH a healthcheck
 * also benefit: the healthcheck loop only watches `State.Health.Status` and
 * does not detect an early exit on its own.
 */

import { parseEnvNonNegativeInteger } from '../util/parse.js';

const DEFAULT_POST_START_LIVENESS_GRACE_MS = 2_000;
const MIN_POST_START_LIVENESS_GRACE_MS = 100;

/**
 * Parse DD_UPDATE_POST_START_LIVENESS_GRACE_MS from the environment.
 *
 * Returns `undefined` when the variable is absent or empty (use the default).
 * Returns `0` when the variable is explicitly `"0"` (opt-out / disable check).
 * Returns the parsed positive integer (≥ 100) when a valid grace is set.
 * Throws a descriptive Error for invalid values so the process fails fast at
 * startup rather than silently ignoring operator intent.
 */
export function parsePostStartLivenessGraceMs(raw: string | undefined): number | undefined {
  const parsed = parseEnvNonNegativeInteger(raw, 'DD_UPDATE_POST_START_LIVENESS_GRACE_MS');
  if (parsed === undefined) {
    return undefined;
  }
  if (parsed === 0) {
    return 0;
  }
  if (parsed < MIN_POST_START_LIVENESS_GRACE_MS) {
    throw new Error(
      `DD_UPDATE_POST_START_LIVENESS_GRACE_MS must be 0 or at least ${MIN_POST_START_LIVENESS_GRACE_MS} (got "${raw}")`,
    );
  }
  return parsed;
}

const _rawGraceMs = parsePostStartLivenessGraceMs(
  process.env.DD_UPDATE_POST_START_LIVENESS_GRACE_MS,
);

export const POST_START_LIVENESS_GRACE_MS: number =
  _rawGraceMs === undefined ? DEFAULT_POST_START_LIVENESS_GRACE_MS : _rawGraceMs;

interface ContainerHandleLike {
  inspect: () => Promise<
    | {
        State?: { Running?: boolean; ExitCode?: number; Error?: string; Status?: string };
      }
    | undefined
  >;
}

interface LoggerLike {
  info: (message: string) => void;
  warn: (message: string) => void;
  debug?: (message: string) => void;
}

export class PostStartLivenessFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PostStartLivenessFailedError';
  }
}

/**
 * Sleep `graceMs`, then inspect the container. Throw a
 * `PostStartLivenessFailedError` when the container is no longer running
 * (exit during the grace window). When `graceMs` is `0` the check is a no-op.
 *
 * Inspect failures are warned-and-tolerated: we cannot prove the container
 * died, and the caller's existing flow (health gate, then cleanup) will catch
 * persistent problems. This keeps the check conservative — it ONLY converts
 * "definitively exited" into a failure.
 */
export async function verifyContainerStillRunning(args: {
  container: ContainerHandleLike;
  containerName: string;
  graceMs: number;
  logger: LoggerLike;
  sleep?: (ms: number) => Promise<void>;
}): Promise<void> {
  const { container, containerName, graceMs, logger } = args;
  if (graceMs <= 0) {
    return;
  }
  const sleep = args.sleep ?? defaultSleep;
  await sleep(graceMs);

  let inspection: Awaited<ReturnType<ContainerHandleLike['inspect']>>;
  try {
    inspection = await container.inspect();
  } catch (error: unknown) {
    logger.warn(
      `Unable to verify post-start liveness for container ${containerName} (${getErrorMessage(error)})`,
    );
    return;
  }

  const state = inspection?.State;
  if (!state || state.Running !== false) {
    return;
  }

  const exitCode = typeof state.ExitCode === 'number' ? state.ExitCode : undefined;
  const stateError = typeof state.Error === 'string' && state.Error.length > 0 ? state.Error : '';
  const status = typeof state.Status === 'string' ? state.Status : 'exited';
  const detail = stateError
    ? ` (${stateError})`
    : exitCode !== undefined
      ? ` with exit code ${exitCode}`
      : '';
  throw new PostStartLivenessFailedError(
    `Container ${containerName} exited within ${graceMs}ms of start (status: ${status})${detail}`,
  );
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
