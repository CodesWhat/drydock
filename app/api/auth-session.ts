import { randomBytes } from 'node:crypto';
import joi from 'joi';
import { ddEnvVars } from '../configuration/index.js';
import log from '../log/index.js';
import { getStoredSessionSecret, setStoredSessionSecret } from '../store/secrets.js';
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
 *
 * Precedence:
 * 1. ddEnvVars.DD_SESSION_SECRET (non-empty after trim) — reads the resolved value from the
 *    post-replaceSecrets() configuration map. If DD_SESSION_SECRET__FILE was set, its file
 *    contents have already been substituted into ddEnvVars.DD_SESSION_SECRET, so the file
 *    value wins over the bare env var (consistent with drydock's secret resolution everywhere).
 * 2. Persisted secret in the LokiJS store — survives restarts without operator intervention.
 * 3. Auto-generated: 64 random bytes (hex) written to the store so it persists across restarts.
 *
 * @returns {string}
 */
export function getSessionSecretKey(): string {
  const envSecret = ddEnvVars.DD_SESSION_SECRET?.trim();
  if (envSecret) {
    log.info('Using session secret from DD_SESSION_SECRET environment variable');
    return envSecret;
  }

  log.warn(
    'DD_SESSION_SECRET is not set. Using an auto-generated secret persisted in the store ' +
      '(/store/dd.json). For production deployments, set DD_SESSION_SECRET explicitly and ' +
      'ensure the store directory is not world-readable.',
  );

  const storedSecret = getStoredSessionSecret();
  if (storedSecret) {
    log.info('Using persisted session secret from store');
    return storedSecret;
  }

  const newSecret = randomBytes(64).toString('hex');
  setStoredSessionSecret(newSecret);
  log.info('Generated and persisted a new session secret to the store');
  return newSecret;
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
