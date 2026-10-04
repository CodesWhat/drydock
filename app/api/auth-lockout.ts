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
import {
  clearFactorFailures,
  getFactorBySubject,
  getFactorFailureState,
  recordFactorFailure,
  type TotpFactorRecord,
} from '../store/totp.js';
import { getErrorMessage } from '../util/error.js';
import { toPositiveInteger } from '../util/parse.js';
import { recordLoginAuditEvent } from './auth-audit.js';
import type { AuthRequest } from './auth-types.js';
import {
  type AuthenticationOutcome,
  authenticateLoginRequest,
  isAuthenticationRejection,
} from './authenticator-chain.js';
import { sendErrorResponse } from './error-response.js';
import { getFirstHeaderValue } from './header-value.js';
import { type AuthenticatedPrincipal, isLoginSessionEligible } from './principal.js';
import { issueLoginChallenge } from './totp-challenge.js';

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
/**
 * Ceiling on the escalating second-factor lock. From the account threshold on,
 * every wrong proof doubles the lock (15 minutes, 30, 60, ... by default) up to
 * this, and only a successful proof starts the count over.
 */
const FACTOR_LOCK_MAX_MS = 24 * 60 * MS_PER_MINUTE;
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

/**
 * Who a login attempt is aimed at, for the failure budget. A Basic header is
 * the credential being checked, so its username is the identity whenever one is
 * present: a body field is attacker-chosen text that names no credential, and
 * keying on it would let a caller dodge a locked account's check, spread
 * guesses across decoy names, or forgive an enrolled user's failures by naming
 * them. The body only speaks for a request that carries no Authorization header.
 */
function getLoginIdentity(req: AuthRequest): string | undefined {
  const authorization = getFirstHeaderValue(req.headers?.authorization);
  if (authorization !== undefined && authorization.trim() !== '') {
    return getBasicHeaderUsername(authorization);
  }

  const requestBody = req.body as { username?: unknown } | undefined;
  if (typeof requestBody?.username === 'string') {
    const username = requestBody.username.trim();
    if (username.length > 0) {
      return username;
    }
  }
  return undefined;
}

function getBasicHeaderUsername(authorization: string): string | undefined {
  if (!authorization.toLowerCase().startsWith('basic ')) {
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

  // A live lock is the one thing the cap must never drop: flooding the table
  // with new identities would otherwise unlock whoever was locked longest ago.
  const evictableEntries = [...lockouts.entries()]
    .filter(([, entry]) => entry.lockedUntil <= now)
    .sort((a, b) => a[1].lastAttemptAt - b[1].lastAttemptAt);
  const overflowCount = Math.min(
    lockouts.size - maxTrackedLockoutIdentities,
    evictableEntries.length,
  );
  for (let index = 0; index < overflowCount; index += 1) {
    lockouts.delete(evictableEntries[index][0]);
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
  now: number = Date.now(),
): void {
  for (let remaining = entriesToEvict; remaining > 0; remaining -= 1) {
    let oldestKey: string | undefined;
    let oldestLastAttemptAt = Number.POSITIVE_INFINITY;

    lockouts.forEach((entry, key) => {
      if (entry.lockedUntil <= now && entry.lastAttemptAt < oldestLastAttemptAt) {
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
    evictOldestTrackedEntries(lockouts, entriesToEvict, now);
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

/**
 * Count one failed attempt (password or second factor) against the account and
 * IP budgets and answer it: 423 when that attempt locked the account or IP,
 * otherwise the same bare 401 every wrong credential gets.
 */
function rejectFailedAttempt(
  req: AuthRequest,
  res: Response,
  loginIdentity: string | undefined,
  auditMessage: string,
  persistedLockoutUntil = 0,
): void {
  const failedAt = Date.now();
  const accountLockoutAfterFailure = registerFailedLoginAttempt(
    accountLoginLockouts,
    accountLockoutPolicy,
    normalizeIdentity(loginIdentity),
    failedAt,
  );
  const ipLockoutAfterFailure = registerFailedLoginAttempt(
    ipLoginLockouts,
    ipLockoutPolicy,
    normalizeIdentity(req.ip),
    failedAt,
  );
  const lockoutUntil = Math.max(
    accountLockoutAfterFailure ?? 0,
    ipLockoutAfterFailure ?? 0,
    persistedLockoutUntil,
  );
  if (lockoutUntil > failedAt) {
    sendLockoutResponse(req, res, lockoutUntil, failedAt, loginIdentity);
    return;
  }

  recordLoginAuditEvent(req, 'error', auditMessage, loginIdentity);
  sendUnauthorized(res);
}

/**
 * Answer 423 when the account (when known) or the caller's IP is locked out.
 * Returns whether it answered. Shared with the login challenge so password and
 * second-factor failures draw on one budget.
 */
export function rejectIfLockedOut(
  req: AuthRequest,
  res: Response,
  loginIdentity: string | undefined,
): boolean {
  const now = Date.now();
  const accountLockoutUntil = getLockoutUntil(
    accountLoginLockouts,
    accountLockoutPolicy,
    normalizeIdentity(loginIdentity),
    now,
  );
  const ipLockoutUntil = getLockoutUntil(
    ipLoginLockouts,
    ipLockoutPolicy,
    normalizeIdentity(req.ip),
    now,
  );
  const activeLockoutUntil = Math.max(accountLockoutUntil ?? 0, ipLockoutUntil ?? 0);
  if (activeLockoutUntil > now) {
    sendLockoutResponse(req, res, activeLockoutUntil, now, loginIdentity);
    return true;
  }
  return false;
}

/**
 * The subject's persisted second-factor lock: 423 while one is running. It
 * outlives the in-memory budget on purpose (restarts and lapsed windows do not
 * reset it), so it is read from the store, and a store fault propagates rather
 * than reading as unlocked.
 */
export function rejectIfFactorLocked(
  req: AuthRequest,
  res: Response,
  subjectId: string,
  loginIdentity: string | undefined,
): boolean {
  const now = Date.now();
  const { lockedUntil } = getFactorFailureState(subjectId);
  if (lockedUntil > now) {
    sendLockoutResponse(req, res, lockedUntil, now, loginIdentity);
    return true;
  }
  return false;
}

/**
 * Count a wrong proof against the subject's persisted budget. A store fault
 * leaves the in-memory budget as the only limit for this one attempt rather
 * than turning a wrong code into a server error.
 */
function recordPersistedFactorFailure(
  subjectId: string,
  loginIdentity: string | undefined,
  now: number,
): number {
  try {
    return recordFactorFailure({
      subjectId,
      username: loginIdentity ?? '',
      now,
      threshold: accountLockoutPolicy.maxAttempts,
      baseLockMs: accountLockoutPolicy.lockoutMs,
      maxLockMs: FACTOR_LOCK_MAX_MS,
    }).lockedUntil;
  } catch (error: unknown) {
    log.warn(`Unable to record second-factor failure (${getErrorMessage(error)})`);
    return 0;
  }
}

/**
 * A second factor failed: count it against the shared budget and, when the
 * subject is known, against its persisted escalating one; answer 401 or 423.
 */
export function rejectFailedSecondFactor(
  req: AuthRequest,
  res: Response,
  loginIdentity: string | undefined,
  subjectId?: string,
): void {
  const persistedLockoutUntil =
    subjectId === undefined
      ? 0
      : recordPersistedFactorFailure(subjectId, loginIdentity, Date.now());
  rejectFailedAttempt(
    req,
    res,
    loginIdentity,
    'Authentication failed (invalid second factor)',
    persistedLockoutUntil,
  );
}

/**
 * A login fully succeeded (password, plus factor when one is due): forgive the
 * budget. Passing the subject also clears its persisted second-factor count,
 * which only a successful factor proof may do.
 */
export function clearLoginLockoutsAfterSuccess(
  req: AuthRequest,
  loginIdentity: string | undefined,
  subjectId?: string,
): void {
  clearLoginLockout(accountLoginLockouts, normalizeIdentity(loginIdentity));
  clearLoginLockout(ipLoginLockouts, normalizeIdentity(req.ip));
  if (subjectId !== undefined) {
    try {
      clearFactorFailures(subjectId);
    } catch (error: unknown) {
      log.warn(`Unable to clear second-factor failure count (${getErrorMessage(error)})`);
    }
  }
}

export async function authenticateLogin(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const loginIdentity = getLoginIdentity(req);
  if (rejectIfLockedOut(req, res, loginIdentity)) {
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

  const rejectFailedLogin = (): void =>
    rejectFailedAttempt(req, res, loginIdentity, 'Authentication failed (invalid credentials)');

  if (hasAuthorizationHeader && !isBasicAuthorization) {
    finishAttempt();
    rejectFailedLogin();
    return;
  }

  // The chain leaves the principal on the request, so there is nothing to hand
  // forward here and nothing that could persist a session on the way past:
  // the login route establishes the session itself, once, after the concurrent
  // session limit has been enforced.
  let outcome: AuthenticationOutcome;
  try {
    outcome = await authenticateLoginRequest(req);
  } catch (error: unknown) {
    finishAttempt();
    next(error);
    return;
  }

  finishAttempt();
  // A terminal rejection is a failed login like any other. Logging in with an
  // API key is not a thing: the login route mints a session, and a key must
  // never be able to trade itself for one.
  if (outcome === undefined || isAuthenticationRejection(outcome)) {
    rejectFailedLogin();
    return;
  }
  const principal: AuthenticatedPrincipal = outcome;

  if (!isLoginSessionEligible(principal)) {
    rejectFailedLogin();
    return;
  }

  // A correct password for a subject with an active factor is only half a
  // login. It starts a challenge and leaves the failure budget untouched, so
  // password-then-guess cycles cannot reset the counter that bounds the guesses.
  let factor: TotpFactorRecord | undefined;
  try {
    factor = getFactorBySubject(principal.identity.subjectId);
  } catch (error: unknown) {
    req.principal = undefined;
    next(error);
    return;
  }
  if (factor !== undefined) {
    req.principal = undefined;
    issueLoginChallenge(req, res, principal, factor);
    return;
  }

  // Forgive only what this principal proved: its own username.
  clearLoginLockoutsAfterSuccess(req, principal.username);
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
