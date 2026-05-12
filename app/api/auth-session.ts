import joi from 'joi';
import log from '../log/index.js';
import { getErrorMessage } from '../util/error.js';
import { enforceConcurrentSessionLimit } from '../util/session-limit.js';
import type { AuthRequest, SessionUser } from './auth-types.js';

export const DEFAULT_SESSION_DAYS = 7;
export const REMEMBER_ME_DAYS = 30;
const DEFAULT_MAX_CONCURRENT_SESSIONS_PER_USER = 5;
const BASIC_SESSION_LOCK_WAIT_TIMEOUT_MS = 10 * 1000;
const BASIC_SESSION_LOCK_STALE_TTL_MS = 60 * 1000;

let maxConcurrentSessionsPerUser = DEFAULT_MAX_CONCURRENT_SESSIONS_PER_USER;
const basicSessionLocks = new Map<string, Promise<void>>();

const sessionUserSchema = joi
  .object({
    username: joi.string().required(),
  })
  .required()
  .unknown(false);

/**
 * Get cookie max age.
 * @param days
 * @returns {number}
 */
export function getCookieMaxAge(days: number): number {
  return 3600 * 1000 * 24 * days;
}

/**
 * Get session secret key.
 * Uses DD_SESSION_SECRET env var.
 * @returns {string}
 */
export function getSessionSecretKey(): string {
  const envSecret = process.env.DD_SESSION_SECRET;
  if (envSecret) {
    log.info('Using session secret from DD_SESSION_SECRET environment variable');
    return envSecret;
  }

  const missingSessionSecretMessage =
    'DD_SESSION_SECRET is required. Set DD_SESSION_SECRET to a strong persistent value.';
  log.error(missingSessionSecretMessage);
  throw new Error(missingSessionSecretMessage);
}

export function deserializeSessionUser(serializedUser: unknown): SessionUser {
  if (typeof serializedUser !== 'string') {
    throw new Error('Serialized user must be a JSON string');
  }

  let parsedUser: unknown;
  try {
    parsedUser = JSON.parse(serializedUser);
  } catch {
    throw new Error('Serialized user JSON is malformed');
  }

  const validatedUser = sessionUserSchema.validate(parsedUser, {
    convert: false,
    stripUnknown: false,
  });
  if (validatedUser.error) {
    throw new Error(validatedUser.error.message);
  }

  return validatedUser.value as SessionUser;
}

function getMaxConcurrentSessionsPerUser(serverConfiguration: Record<string, unknown>): number {
  const configuredMaxSessions = (serverConfiguration.session as Record<string, unknown> | undefined)
    ?.maxconcurrentsessions;

  if (
    typeof configuredMaxSessions !== 'number' ||
    !Number.isInteger(configuredMaxSessions) ||
    configuredMaxSessions < 1
  ) {
    return DEFAULT_MAX_CONCURRENT_SESSIONS_PER_USER;
  }

  return configuredMaxSessions;
}

export function configureSessionLimits(serverConfiguration: Record<string, unknown>): void {
  maxConcurrentSessionsPerUser = getMaxConcurrentSessionsPerUser(serverConfiguration);
}

async function withBasicSessionLock<T>(lockKey: string, operation: () => Promise<T>): Promise<T> {
  if (lockKey.length === 0) {
    return operation();
  }

  const previousLock = basicSessionLocks.get(lockKey) || Promise.resolve();
  let releaseLock: (() => void) | undefined;
  const currentLock = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  const nextLock = previousLock.catch(() => undefined).then(() => currentLock);
  basicSessionLocks.set(lockKey, nextLock);

  const staleLockCleanupTimer = setTimeout(() => {
    if (basicSessionLocks.get(lockKey) === nextLock) {
      basicSessionLocks.delete(lockKey);
    }
  }, BASIC_SESSION_LOCK_STALE_TTL_MS);
  staleLockCleanupTimer.unref?.();

  let previousLockWaitTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      previousLock.catch(() => undefined),
      new Promise<void>((resolve) => {
        previousLockWaitTimer = setTimeout(resolve, BASIC_SESSION_LOCK_WAIT_TIMEOUT_MS);
        previousLockWaitTimer.unref?.();
      }),
    ]);
    return await operation();
  } finally {
    if (previousLockWaitTimer !== undefined) {
      clearTimeout(previousLockWaitTimer);
    }
    clearTimeout(staleLockCleanupTimer);
    releaseLock?.();
    if (basicSessionLocks.get(lockKey) === nextLock) {
      basicSessionLocks.delete(lockKey);
    }
  }
}

export const testable_withBasicSessionLock = withBasicSessionLock;
export const testable_basicSessionLocks = basicSessionLocks;

export function enforceSessionLimitBeforeLogin(
  req: AuthRequest,
  username: string,
  onSuccess: () => Promise<void>,
  onFailure: (errorMessage: string) => void,
): void {
  const normalizedUsername = username.trim();
  if (normalizedUsername.length === 0) {
    void onSuccess().catch((error: unknown) => {
      const errorMessage = `Unable to enforce session limit before login (${getErrorMessage(error)})`;
      log.warn(errorMessage);
      onFailure(errorMessage);
    });
    return;
  }

  void withBasicSessionLock(normalizedUsername, async () => {
    if (
      !req.sessionStore ||
      typeof req.sessionStore.all !== 'function' ||
      typeof req.sessionStore.destroy !== 'function'
    ) {
      await onSuccess();
      return;
    }

    await enforceConcurrentSessionLimit({
      username: normalizedUsername,
      maxConcurrentSessions: maxConcurrentSessionsPerUser,
      sessionStore: req.sessionStore,
      currentSessionId: req.sessionID,
    });
    await onSuccess();
  }).catch((error: unknown) => {
    const errorMessage = `Unable to enforce session limit before login (${getErrorMessage(error)})`;
    log.warn(errorMessage);
    onFailure(errorMessage);
  });
}
