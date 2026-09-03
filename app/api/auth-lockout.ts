import fs from 'node:fs';
import path from 'node:path';
import type { NextFunction, Response } from 'express';
import log from '../log/index.js';
import {
  recordAuthLogin,
  setAuthAccountLockedTotal,
  setAuthIpLockedTotal,
} from '../prometheus/auth.js';
import * as store from '../store/index.js';
import { getErrorMessage } from '../util/error.js';
import { toPositiveInteger } from '../util/parse.js';
import { recordLoginAuditEvent } from './auth-audit.js';
import type { AuthRequest } from './auth-types.js';
import { authenticateRequest } from './authenticator-chain.js';
import { sendErrorResponse } from './error-response.js';
import { getFirstHeaderValue } from './header-value.js';
import { type AuthenticatedPrincipal, isLoginSessionEligible } from './principal.js';

const MS_PER_MINUTE = 60 * 1000;
const DEFAULT_LOCKOUT_WINDOW_MINUTES = 15;
const DEFAULT_LOCKOUT_DURATION_MINUTES = 15;

/**
 * Default lockout tuning (overridable by env):
 * - Account threshold (5): slows credential stuffing while keeping typo lockouts low.
 * - IP threshold (25): applies broader pressure without over-blocking shared/NAT egress IPs.
 * - 15-minute window + 15-minute lockout: reduces brute-force throughput but auto-recovers quickly.
 * - Tracked-identity cap (5000): bounds in-memory state under abuse scenarios.
 */
const DEFAULT_ACCOUNT_LOCKOUT_MAX_ATTEMPTS = 5;
const DEFAULT_IP_LOCKOUT_MAX_ATTEMPTS = 25;
const DEFAULT_LOCKOUT_WINDOW_MS = DEFAULT_LOCKOUT_WINDOW_MINUTES * MS_PER_MINUTE;
const DEFAULT_LOCKOUT_DURATION_MS = DEFAULT_LOCKOUT_DURATION_MINUTES * MS_PER_MINUTE;
const DEFAULT_LOCKOUT_PRUNE_INTERVAL_MS = MS_PER_MINUTE;
const DEFAULT_MAX_LOCKOUT_TRACKED_IDENTITIES = 5000;
const DEFAULT_MAX_CONCURRENT_LOGIN_ATTEMPTS = 2;
const LOCKOUT_STATE_FILE_SUFFIX = '.auth-lockouts.json';
const LOCKOUT_STATE_PERSIST_DEBOUNCE_MS = 250;
const LOGIN_LOCKOUT_ERROR_MESSAGE =
  'Account temporarily locked due to repeated failed login attempts';
const LOGIN_CONCURRENCY_ERROR_MESSAGE = 'Too many concurrent login attempts';
const LOCKOUT_ENTRY_NUMERIC_FIELDS: ReadonlyArray<keyof LoginLockoutEntry> = [
  'failedAttempts',
  'windowStartAt',
  'lockedUntil',
  'lastAttemptAt',
];

interface LoginLockoutEntry {
  failedAttempts: number;
  windowStartAt: number;
  lockedUntil: number;
  lastAttemptAt: number;
}

interface LoginLockoutPolicy {
  maxAttempts: number;
  windowMs: number;
  lockoutMs: number;
}

interface PersistedLoginLockoutState {
  account: Record<string, LoginLockoutEntry>;
  ip: Record<string, LoginLockoutEntry>;
}

const accountLoginLockouts = new Map<string, LoginLockoutEntry>();
const ipLoginLockouts = new Map<string, LoginLockoutEntry>();
let maintenanceTimer: ReturnType<typeof setInterval> | undefined;
let persistTimer: ReturnType<typeof setTimeout> | undefined;
let persistenceInitialized = false;
let activeLoginAttempts = 0;

function countActiveLockouts(lockouts: Map<string, LoginLockoutEntry>, now: number): number {
  let activeLockouts = 0;
  lockouts.forEach((entry) => {
    if (entry.lockedUntil > now) {
      activeLockouts += 1;
    }
  });
  return activeLockouts;
}

function updateLockoutGaugeTotals(now = Date.now()): void {
  setAuthAccountLockedTotal(countActiveLockouts(accountLoginLockouts, now));
  setAuthIpLockedTotal(countActiveLockouts(ipLoginLockouts, now));
}

function parsePositiveIntegerEnv(name: string, fallback: number): number {
  return toPositiveInteger(process.env[name], fallback);
}

const accountLockoutPolicy: LoginLockoutPolicy = {
  maxAttempts: parsePositiveIntegerEnv(
    'DD_AUTH_ACCOUNT_LOCKOUT_MAX_ATTEMPTS',
    DEFAULT_ACCOUNT_LOCKOUT_MAX_ATTEMPTS,
  ),
  windowMs: parsePositiveIntegerEnv('DD_AUTH_LOCKOUT_WINDOW_MS', DEFAULT_LOCKOUT_WINDOW_MS),
  lockoutMs: parsePositiveIntegerEnv('DD_AUTH_LOCKOUT_DURATION_MS', DEFAULT_LOCKOUT_DURATION_MS),
};

const ipLockoutPolicy: LoginLockoutPolicy = {
  maxAttempts: parsePositiveIntegerEnv(
    'DD_AUTH_IP_LOCKOUT_MAX_ATTEMPTS',
    DEFAULT_IP_LOCKOUT_MAX_ATTEMPTS,
  ),
  windowMs: parsePositiveIntegerEnv('DD_AUTH_LOCKOUT_WINDOW_MS', DEFAULT_LOCKOUT_WINDOW_MS),
  lockoutMs: parsePositiveIntegerEnv('DD_AUTH_LOCKOUT_DURATION_MS', DEFAULT_LOCKOUT_DURATION_MS),
};
const lockoutPruneIntervalMs = parsePositiveIntegerEnv(
  'DD_AUTH_LOCKOUT_PRUNE_INTERVAL_MS',
  DEFAULT_LOCKOUT_PRUNE_INTERVAL_MS,
);
const maxTrackedLockoutIdentities = parsePositiveIntegerEnv(
  'DD_AUTH_LOCKOUT_MAX_TRACKED_IDENTITIES',
  DEFAULT_MAX_LOCKOUT_TRACKED_IDENTITIES,
);
const maxConcurrentLoginAttempts = parsePositiveIntegerEnv(
  'DD_AUTH_MAX_CONCURRENT_LOGIN_ATTEMPTS',
  DEFAULT_MAX_CONCURRENT_LOGIN_ATTEMPTS,
);

function getLockoutStatePath(): string {
  const storeConfiguration = store.getConfiguration();
  return `${storeConfiguration.path}/${storeConfiguration.file}${LOCKOUT_STATE_FILE_SUFFIX}`;
}

function isLoginLockoutEntry(candidate: unknown): candidate is LoginLockoutEntry {
  if (!candidate || typeof candidate !== 'object') {
    return false;
  }
  const entry = candidate as Partial<LoginLockoutEntry>;
  return LOCKOUT_ENTRY_NUMERIC_FIELDS.every((field) => Number.isFinite(entry[field]));
}

function toPersistedRecord(
  lockouts: Map<string, LoginLockoutEntry>,
): Record<string, LoginLockoutEntry> {
  return [...lockouts.entries()].reduce<Record<string, LoginLockoutEntry>>(
    (records, [key, entry]) => {
      records[key] = entry;
      return records;
    },
    {},
  );
}

function persistLockoutState(): void {
  try {
    const lockoutStatePath = getLockoutStatePath();
    fs.mkdirSync(path.dirname(lockoutStatePath), { recursive: true });
    const persistedState: PersistedLoginLockoutState = {
      account: toPersistedRecord(accountLoginLockouts),
      ip: toPersistedRecord(ipLoginLockouts),
    };
    fs.writeFileSync(lockoutStatePath, JSON.stringify(persistedState), {
      encoding: 'utf8',
      mode: 0o600,
    });
  } catch (error: unknown) {
    log.warn(`Unable to persist login lockout state (${getErrorMessage(error)})`);
  }
}

function scheduleLockoutStatePersist(): void {
  if (persistTimer) {
    return;
  }
  persistTimer = setTimeout(() => {
    persistTimer = undefined;
    persistLockoutState();
  }, LOCKOUT_STATE_PERSIST_DEBOUNCE_MS);
}

function hydrateLockoutMap(
  lockouts: Map<string, LoginLockoutEntry>,
  serializedEntries: unknown,
  policy: LoginLockoutPolicy,
): void {
  if (!serializedEntries || typeof serializedEntries !== 'object') {
    return;
  }
  Object.entries(serializedEntries as Record<string, unknown>).forEach(([identity, entry]) => {
    if (isLoginLockoutEntry(entry)) {
      lockouts.set(identity, entry);
    }
  });
  pruneLockoutEntries(lockouts, policy, Date.now());
}

function loadPersistedLockoutState(): void {
  try {
    const lockoutStatePath = getLockoutStatePath();
    if (!fs.existsSync(lockoutStatePath)) {
      return;
    }
    const stateFileContent = fs.readFileSync(lockoutStatePath, 'utf8');
    const parsedState = JSON.parse(stateFileContent) as unknown;
    if (!parsedState || typeof parsedState !== 'object') {
      return;
    }
    const persistedState = parsedState as Partial<PersistedLoginLockoutState>;
    hydrateLockoutMap(accountLoginLockouts, persistedState.account, accountLockoutPolicy);
    hydrateLockoutMap(ipLoginLockouts, persistedState.ip, ipLockoutPolicy);
    updateLockoutGaugeTotals();
  } catch (error: unknown) {
    log.warn(`Unable to load login lockout state (${getErrorMessage(error)})`);
  }
}

function pruneAndPersistIfChanged(): void {
  const accountSizeBeforePrune = accountLoginLockouts.size;
  const ipSizeBeforePrune = ipLoginLockouts.size;
  const now = Date.now();
  pruneLockoutEntries(accountLoginLockouts, accountLockoutPolicy, now);
  pruneLockoutEntries(ipLoginLockouts, ipLockoutPolicy, now);
  if (
    accountLoginLockouts.size !== accountSizeBeforePrune ||
    ipLoginLockouts.size !== ipSizeBeforePrune
  ) {
    scheduleLockoutStatePersist();
  }
  updateLockoutGaugeTotals(now);
}

export function initializeLoginLockoutState(): void {
  if (persistenceInitialized) {
    updateLockoutGaugeTotals();
    return;
  }
  persistenceInitialized = true;
  loadPersistedLockoutState();
  updateLockoutGaugeTotals();
  maintenanceTimer = setInterval(() => {
    pruneAndPersistIfChanged();
  }, lockoutPruneIntervalMs);
}

function normalizeIdentity(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : undefined;
}

function getLoginIdentity(req: AuthRequest): string | undefined {
  const requestBody = req.body as { username?: unknown } | undefined;
  if (typeof requestBody?.username === 'string') {
    const username = requestBody.username.trim();
    if (username.length > 0) {
      return username;
    }
  }

  const authorization = getFirstHeaderValue(req.headers?.authorization);
  if (!authorization || !authorization.toLowerCase().startsWith('basic ')) {
    return undefined;
  }

  const encoded = authorization.slice(6).trim();
  if (!encoded) {
    return undefined;
  }

  try {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const separatorIndex = decoded.indexOf(':');
    const username = separatorIndex >= 0 ? decoded.slice(0, separatorIndex) : decoded;
    const trimmed = username.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

function pruneLockoutEntries(
  lockouts: Map<string, LoginLockoutEntry>,
  policy: LoginLockoutPolicy,
  now: number,
): void {
  lockouts.forEach((entry, key) => {
    const expired = entry.lockedUntil <= now && now - entry.lastAttemptAt > policy.windowMs;
    if (expired) {
      lockouts.delete(key);
    }
  });

  if (lockouts.size <= maxTrackedLockoutIdentities) {
    return;
  }

  const orderedEntries = [...lockouts.entries()].sort(
    (a, b) => a[1].lastAttemptAt - b[1].lastAttemptAt,
  );
  const overflowCount = orderedEntries.length - maxTrackedLockoutIdentities;
  for (let index = 0; index < overflowCount; index += 1) {
    lockouts.delete(orderedEntries[index][0]);
  }
}

function isExpiredUnlockedEntry(
  entry: LoginLockoutEntry,
  policy: LoginLockoutPolicy,
  now: number,
): boolean {
  return entry.lockedUntil <= now && now - entry.lastAttemptAt > policy.windowMs;
}

function removeExpiredUnlockedEntries(
  lockouts: Map<string, LoginLockoutEntry>,
  policy: LoginLockoutPolicy,
  now: number,
): void {
  lockouts.forEach((entry, key) => {
    if (isExpiredUnlockedEntry(entry, policy, now)) {
      lockouts.delete(key);
    }
  });
}

function evictOldestTrackedEntries(
  lockouts: Map<string, LoginLockoutEntry>,
  entriesToEvict: number,
): void {
  for (let remaining = entriesToEvict; remaining > 0; remaining -= 1) {
    let oldestKey: string | undefined;
    let oldestLastAttemptAt = Number.POSITIVE_INFINITY;

    lockouts.forEach((entry, key) => {
      if (entry.lastAttemptAt < oldestLastAttemptAt) {
        oldestKey = key;
        oldestLastAttemptAt = entry.lastAttemptAt;
      }
    });

    if (!oldestKey) {
      return;
    }

    lockouts.delete(oldestKey);
  }
}

function makeTrackedIdentityCapacity(
  lockouts: Map<string, LoginLockoutEntry>,
  policy: LoginLockoutPolicy,
  now: number,
): void {
  if (lockouts.size < maxTrackedLockoutIdentities) {
    return;
  }

  removeExpiredUnlockedEntries(lockouts, policy, now);

  const entriesToEvict = lockouts.size - maxTrackedLockoutIdentities + 1;
  if (entriesToEvict > 0) {
    evictOldestTrackedEntries(lockouts, entriesToEvict);
  }
}

function getLockoutUntil(
  lockouts: Map<string, LoginLockoutEntry>,
  policy: LoginLockoutPolicy,
  key: string | undefined,
  now: number,
): number | undefined {
  if (!key) {
    return undefined;
  }

  const entry = lockouts.get(key);
  if (!entry) {
    return undefined;
  }

  if (entry.lockedUntil <= now) {
    if (now - entry.lastAttemptAt > policy.windowMs) {
      lockouts.delete(key);
      scheduleLockoutStatePersist();
      updateLockoutGaugeTotals(now);
    }
    return undefined;
  }

  return entry.lockedUntil;
}

function registerFailedLoginAttempt(
  lockouts: Map<string, LoginLockoutEntry>,
  policy: LoginLockoutPolicy,
  key: string | undefined,
  now: number,
): number | undefined {
  if (!key) {
    return undefined;
  }

  let existingEntry = lockouts.get(key);
  if (existingEntry && isExpiredUnlockedEntry(existingEntry, policy, now)) {
    lockouts.delete(key);
    existingEntry = undefined;
  }

  if (!existingEntry) {
    makeTrackedIdentityCapacity(lockouts, policy, now);
    lockouts.set(key, {
      failedAttempts: 1,
      windowStartAt: now,
      lockedUntil: 0,
      lastAttemptAt: now,
    });
    scheduleLockoutStatePersist();
    updateLockoutGaugeTotals(now);
    return undefined;
  }

  existingEntry.failedAttempts += 1;
  existingEntry.lastAttemptAt = now;
  if (existingEntry.failedAttempts >= policy.maxAttempts) {
    existingEntry.lockedUntil = now + policy.lockoutMs;
  }

  lockouts.set(key, existingEntry);
  scheduleLockoutStatePersist();
  updateLockoutGaugeTotals(now);
  return existingEntry.lockedUntil > now ? existingEntry.lockedUntil : undefined;
}

function clearLoginLockout(
  lockouts: Map<string, LoginLockoutEntry>,
  key: string | undefined,
): void {
  if (!key) {
    return;
  }
  if (lockouts.delete(key)) {
    scheduleLockoutStatePersist();
    updateLockoutGaugeTotals();
  }
}

function setRetryAfterHeader(res: Response, seconds: number): void {
  if (typeof (res as { setHeader?: unknown }).setHeader === 'function') {
    (res as { setHeader: (name: string, value: string) => void }).setHeader(
      'Retry-After',
      `${seconds}`,
    );
  }
}

function sendUnauthorized(res: Response): void {
  sendErrorResponse(res, 401, 'Unauthorized');
}

function sendLockoutResponse(
  req: AuthRequest,
  res: Response,
  lockoutUntil: number,
  now: number,
  loginIdentity: string | undefined,
): void {
  const retryAfterSeconds = Math.max(1, Math.ceil((lockoutUntil - now) / 1000));
  setRetryAfterHeader(res, retryAfterSeconds);
  recordAuthLogin('locked', 'basic');
  recordLoginAuditEvent(
    req,
    'error',
    `${LOGIN_LOCKOUT_ERROR_MESSAGE}; retry_after=${retryAfterSeconds}s`,
    loginIdentity,
  );
  sendErrorResponse(res, 423, LOGIN_LOCKOUT_ERROR_MESSAGE);
}

export async function authenticateLogin(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const loginIdentity = getLoginIdentity(req);
  const accountLockoutKey = normalizeIdentity(loginIdentity);
  const ipLockoutKey = normalizeIdentity(req.ip);
  const now = Date.now();
  const accountLockoutUntil = getLockoutUntil(
    accountLoginLockouts,
    accountLockoutPolicy,
    accountLockoutKey,
    now,
  );
  const ipLockoutUntil = getLockoutUntil(ipLoginLockouts, ipLockoutPolicy, ipLockoutKey, now);
  const activeLockoutUntil = Math.max(accountLockoutUntil ?? 0, ipLockoutUntil ?? 0);
  if (activeLockoutUntil > now) {
    sendLockoutResponse(req, res, activeLockoutUntil, now, loginIdentity);
    return;
  }

  if (activeLoginAttempts >= maxConcurrentLoginAttempts) {
    setRetryAfterHeader(res, 1);
    recordLoginAuditEvent(req, 'error', LOGIN_CONCURRENCY_ERROR_MESSAGE, loginIdentity);
    sendErrorResponse(res, 429, LOGIN_CONCURRENCY_ERROR_MESSAGE);
    return;
  }

  activeLoginAttempts += 1;
  const finishAttempt = (): void => {
    activeLoginAttempts = Math.max(0, activeLoginAttempts - 1);
  };

  const authorization = getFirstHeaderValue(req.headers?.authorization);
  const hasAuthorizationHeader = typeof authorization === 'string' && authorization.trim() !== '';
  const isBasicAuthorization =
    hasAuthorizationHeader && authorization.toLowerCase().startsWith('basic ');

  const rejectFailedLogin = (): void => {
    const failedAt = Date.now();
    const accountLockoutAfterFailure = registerFailedLoginAttempt(
      accountLoginLockouts,
      accountLockoutPolicy,
      accountLockoutKey,
      failedAt,
    );
    const ipLockoutAfterFailure = registerFailedLoginAttempt(
      ipLoginLockouts,
      ipLockoutPolicy,
      ipLockoutKey,
      failedAt,
    );
    const lockoutUntil = Math.max(accountLockoutAfterFailure ?? 0, ipLockoutAfterFailure ?? 0);
    if (lockoutUntil > failedAt) {
      sendLockoutResponse(req, res, lockoutUntil, failedAt, loginIdentity);
      return;
    }

    recordLoginAuditEvent(
      req,
      'error',
      'Authentication failed (invalid credentials)',
      loginIdentity,
    );
    sendUnauthorized(res);
  };

  if (hasAuthorizationHeader && !isBasicAuthorization) {
    finishAttempt();
    rejectFailedLogin();
    return;
  }

  // The chain leaves the principal on the request, so there is nothing to hand
  // forward here and nothing that could persist a session on the way past:
  // the login route establishes the session itself, once, after the concurrent
  // session limit has been enforced.
  let principal: AuthenticatedPrincipal | undefined;
  try {
    principal = await authenticateRequest(req);
  } catch (error: unknown) {
    finishAttempt();
    next(error);
    return;
  }

  finishAttempt();
  if (principal === undefined) {
    rejectFailedLogin();
    return;
  }

  if (
    !isLoginSessionEligible(principal) ||
    (hasAuthorizationHeader && principal.kind !== 'basic')
  ) {
    rejectFailedLogin();
    return;
  }

  clearLoginLockout(accountLoginLockouts, accountLockoutKey);
  clearLoginLockout(ipLoginLockouts, ipLockoutKey);
  next();
}

export function resetLoginLockoutStateForTests(): void {
  accountLoginLockouts.clear();
  ipLoginLockouts.clear();
  activeLoginAttempts = 0;
  if (maintenanceTimer) {
    clearInterval(maintenanceTimer);
    maintenanceTimer = undefined;
  }
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = undefined;
  }
  persistenceInitialized = false;
  setAuthAccountLockedTotal(0);
  setAuthIpLockedTotal(0);
}

export const testable_accountLockoutPolicy = accountLockoutPolicy;
export const testable_evictOldestTrackedEntries = evictOldestTrackedEntries;
export const testable_makeTrackedIdentityCapacity = makeTrackedIdentityCapacity;
export const testable_pruneLockoutEntries = pruneLockoutEntries;
export const testable_registerFailedLoginAttempt = registerFailedLoginAttempt;
