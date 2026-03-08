import ConnectLoki from 'connect-loki';
import { randomBytes } from 'crypto';
import express, { type Application, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import session, { type Session, type SessionData } from 'express-session';
import joi from 'joi';

const LokiStore = ConnectLoki(session);

import passport from 'passport';
import type Authentication from '../authentications/providers/Authentication.js';
import type { StrategyDescription } from '../authentications/providers/Authentication.js';
import { getServerConfiguration } from '../configuration/index.js';
import log from '../log/index.js';
import * as registry from '../registry/index.js';
import * as store from '../store/index.js';
import { getErrorMessage } from '../util/error.js';
import { enforceConcurrentSessionLimit } from '../util/session-limit.js';
import { recordAuditEvent } from './audit-events.js';
import { sendErrorResponse } from './error-response.js';
import { getFirstHeaderValue } from './header-value.js';
import { requireJsonContentTypeForMutations, shouldParseJsonBody } from './json-content-type.js';

const router = express.Router();

// The configured strategy ids.
const STRATEGY_IDS: string[] = [];

const DEFAULT_SESSION_DAYS = 7;
const REMEMBER_ME_DAYS = 30;
const DEFAULT_MAX_CONCURRENT_SESSIONS_PER_USER = 5;
const AUTH_USER_CACHE_CONTROL = 'private, no-cache, no-store, must-revalidate';
const DEFAULT_ACCOUNT_LOCKOUT_MAX_ATTEMPTS = 5;
const DEFAULT_IP_LOCKOUT_MAX_ATTEMPTS = 25;
const DEFAULT_LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_LOCKOUT_DURATION_MS = 15 * 60 * 1000;
const MAX_LOCKOUT_TRACKED_IDENTITIES = 5000;
const LOGIN_LOCKOUT_ERROR_MESSAGE =
  'Account temporarily locked due to repeated failed login attempts';
let generatedSessionSecret: string | undefined;
let maxConcurrentSessionsPerUser = DEFAULT_MAX_CONCURRENT_SESSIONS_PER_USER;
const sessionUserSchema = joi
  .object({
    username: joi.string().required(),
  })
  .required()
  .unknown(false);

interface SessionUser {
  username: string;
}

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

type UserWithUsername = Express.User & { username?: string };
type SessionWithRememberMe = Session & Partial<SessionData> & { rememberMe?: boolean };
type AuthRequest = Request & {
  body?: { remember?: boolean };
  session?: SessionWithRememberMe;
  user?: UserWithUsername;
  sessionID?: string;
  sessionStore?: {
    all?: (callback: (error: unknown, sessions?: unknown) => void) => void;
    destroy?: (sid: string, callback: (error?: unknown) => void) => void;
  };
};

const accountLoginLockouts = new Map<string, LoginLockoutEntry>();
const ipLoginLockouts = new Map<string, LoginLockoutEntry>();

function parsePositiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
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

  if (lockouts.size <= MAX_LOCKOUT_TRACKED_IDENTITIES) {
    return;
  }

  const orderedEntries = [...lockouts.entries()].sort(
    (a, b) => a[1].lastAttemptAt - b[1].lastAttemptAt,
  );
  const overflowCount = orderedEntries.length - MAX_LOCKOUT_TRACKED_IDENTITIES;
  for (let index = 0; index < overflowCount; index += 1) {
    lockouts.delete(orderedEntries[index][0]);
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

  pruneLockoutEntries(lockouts, policy, now);

  const existingEntry = lockouts.get(key);
  if (!existingEntry) {
    lockouts.set(key, {
      failedAttempts: 1,
      windowStartAt: now,
      lockedUntil: 0,
      lastAttemptAt: now,
    });
    return undefined;
  }

  existingEntry.failedAttempts += 1;
  existingEntry.lastAttemptAt = now;
  if (existingEntry.failedAttempts >= policy.maxAttempts) {
    existingEntry.lockedUntil = now + policy.lockoutMs;
  }

  lockouts.set(key, existingEntry);
  return existingEntry.lockedUntil > now ? existingEntry.lockedUntil : undefined;
}

function clearLoginLockout(
  lockouts: Map<string, LoginLockoutEntry>,
  key: string | undefined,
): void {
  if (!key) {
    return;
  }
  lockouts.delete(key);
}

function setRetryAfterHeader(res: Response, seconds: number): void {
  if (typeof (res as { setHeader?: unknown }).setHeader === 'function') {
    (res as { setHeader: (name: string, value: string) => void }).setHeader(
      'Retry-After',
      `${seconds}`,
    );
  }
}

function deserializeSessionUser(serializedUser: unknown): SessionUser {
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

/**
 * Get all strategies id.
 * @returns {[]}
 */
export function getAllIds(): string[] {
  return [...STRATEGY_IDS];
}

export function requireAuthentication(req: AuthRequest, res: Response, next: NextFunction): void {
  if (req.isAuthenticated()) {
    next();
    return;
  }

  passport.authenticate(getAllIds(), { session: true })(req, res, next);
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
  recordLoginAuditEvent(
    req,
    'error',
    `${LOGIN_LOCKOUT_ERROR_MESSAGE}; retry_after=${retryAfterSeconds}s`,
    loginIdentity,
  );
  sendErrorResponse(res, 423, LOGIN_LOCKOUT_ERROR_MESSAGE);
}

function authenticateLogin(req: AuthRequest, res: Response, next: NextFunction): void {
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

  passport.authenticate(
    getAllIds(),
    { session: false },
    (error: unknown, user: UserWithUsername | false | null) => {
      if (error) {
        next(error);
        return;
      }

      if (!user) {
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
        return;
      }

      clearLoginLockout(accountLoginLockouts, accountLockoutKey);
      clearLoginLockout(ipLoginLockouts, ipLockoutKey);

      const continueWithUser = (authenticatedUser: UserWithUsername): void => {
        req.user = authenticatedUser;
        next();
      };

      if (typeof req.login !== 'function') {
        continueWithUser(user);
        return;
      }

      req.login(user, { session: false }, (loginError: unknown) => {
        if (loginError) {
          next(loginError);
          return;
        }
        continueWithUser(user);
      });
    },
  )(req, res, next);
}

/**
 * Get cookie max age.
 * @param days
 * @returns {number}
 */
function getCookieMaxAge(days: number): number {
  return 3600 * 1000 * 24 * days;
}

/**
 * Get session secret key.
 * Uses DD_SESSION_SECRET env var if set, otherwise falls back to a
 * process-local cryptographic secret.
 * @returns {string}
 */
function getSessionSecretKey(): string {
  const envSecret = process.env.DD_SESSION_SECRET;
  if (envSecret) {
    log.info('Using session secret from DD_SESSION_SECRET environment variable');
    return envSecret;
  }
  if (!generatedSessionSecret) {
    generatedSessionSecret = randomBytes(64).toString('hex');
    const missingSessionSecretMessage =
      'DD_SESSION_SECRET is not set; using an ephemeral session secret. Set DD_SESSION_SECRET to a strong persistent value.';
    if (process.env.NODE_ENV === 'production') {
      log.error(missingSessionSecretMessage);
    } else {
      log.warn(missingSessionSecretMessage);
    }
  }
  return generatedSessionSecret;
}

function getAuditUsername(req: AuthRequest): string {
  return typeof req.user?.username === 'string' ? req.user.username : 'unknown';
}

function recordLoginAuditEvent(
  req: AuthRequest,
  status: 'success' | 'error',
  details: string,
  loginIdentity?: string,
): void {
  const auditUser =
    typeof loginIdentity === 'string' && loginIdentity.trim() !== ''
      ? loginIdentity
      : getAuditUsername(req);
  recordAuditEvent({
    action: 'auth-login',
    status,
    containerName: 'authentication',
    details: `${details}; user=${auditUser}`,
  });
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

function enforceSessionLimitBeforeLogin(
  req: AuthRequest,
  username: string,
  onSuccess: () => void,
  onFailure: (errorMessage: string) => void,
): void {
  if (
    !req.sessionStore ||
    typeof req.sessionStore.all !== 'function' ||
    typeof req.sessionStore.destroy !== 'function'
  ) {
    onSuccess();
    return;
  }

  void enforceConcurrentSessionLimit({
    username,
    maxConcurrentSessions: maxConcurrentSessionsPerUser,
    sessionStore: req.sessionStore,
    currentSessionId: req.sessionID,
  })
    .then(() => {
      onSuccess();
    })
    .catch((error: unknown) => {
      const errorMessage = `Unable to enforce session limit before login (${getErrorMessage(error)})`;
      log.warn(errorMessage);
      onFailure(errorMessage);
    });
}

export function _resetLoginLockoutStateForTests(): void {
  accountLoginLockouts.clear();
  ipLoginLockouts.clear();
}

export function _resetStrategyIdsForTests(): void {
  STRATEGY_IDS.length = 0;
}

/**
 * Register a strategy to passport.
 * @param authentication
 * @param app
 */
function useStrategy(authentication: Authentication, app: Application): void {
  try {
    const strategy = authentication.getStrategy(app);
    passport.use(authentication.getId(), strategy);
    STRATEGY_IDS.push(authentication.getId());
  } catch (error: unknown) {
    log.warn(
      `Unable to apply authentication ${authentication.getId()} (${getErrorMessage(error)})`,
    );
  }
}

function getUniqueStrategies(): StrategyDescription[] {
  const strategies = Object.values(registry.getState().authentication).map(
    (authentication: Authentication): StrategyDescription =>
      authentication.getStrategyDescription(),
  );
  const seenStrategies = new Set<string>();
  const uniqueStrategies = strategies.filter((strategy: StrategyDescription) => {
    const key = JSON.stringify([strategy.type, strategy.name]);
    if (seenStrategies.has(key)) {
      return false;
    }
    seenStrategies.add(key);
    return true;
  });
  return uniqueStrategies.sort((s1: StrategyDescription, s2: StrategyDescription) =>
    s1.name.localeCompare(s2.name),
  );
}

/**
 * Return the registered strategies from the registry.
 * @param req
 * @param res
 */
function getStrategies(_req: Request, res: Response): void {
  res.json(getUniqueStrategies());
}

function getLogoutRedirectUrl(): string | undefined {
  const strategyWithRedirectUrl = getUniqueStrategies().find(
    (strategy: StrategyDescription): boolean => !!strategy.logoutUrl,
  );
  if (strategyWithRedirectUrl) {
    return strategyWithRedirectUrl.logoutUrl;
  }
  return undefined;
}

/**
 * Get current user.
 * @param req
 * @param res
 */
function getUser(req: AuthRequest, res: Response): void {
  const user = req.user || { username: 'anonymous' };
  res.set('Cache-Control', AUTH_USER_CACHE_CONTROL);
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.status(200).json(user);
}

/**
 * Apply the "remember me" preference stored in the session.
 * When remember is true, extend the cookie to 30 days.
 * When false, make it a session cookie that expires on browser close.
 */
function applyRememberMe(req: AuthRequest): void {
  if (!req.session?.cookie) return;
  if (req.session.rememberMe) {
    req.session.cookie.maxAge = getCookieMaxAge(REMEMBER_ME_DAYS);
  } else {
    req.session.cookie.expires = false as unknown as Date;
    req.session.cookie.maxAge = null;
  }
}

/**
 * Store the "remember me" preference in the session.
 * Called before any auth flow (basic or OIDC redirect).
 * @param req
 * @param res
 */
function setRememberMe(req: AuthRequest, res: Response): void {
  if (!req.session) {
    sendErrorResponse(res, 500, 'Unable to access session');
    return;
  }
  req.session.rememberMe = req.body?.remember === true;
  applyRememberMe(req);
  res.status(200).json({ ok: true });
}

/**
 * Login user (and return it).
 * @param req
 * @param res
 */
function login(req: AuthRequest, res: Response): void {
  const rememberMe =
    req.body?.remember !== undefined
      ? req.body.remember === true
      : req.session?.rememberMe === true;

  if (!req.session || typeof req.session.regenerate !== 'function') {
    const errorMessage = 'Unable to regenerate session during login (session unavailable)';
    log.warn(errorMessage);
    recordLoginAuditEvent(req, 'error', errorMessage);
    sendErrorResponse(res, 500, 'Unable to establish session');
    return;
  }

  req.session.regenerate((regenerateError: unknown) => {
    if (regenerateError) {
      const errorMessage = `Unable to regenerate session during login (${getErrorMessage(regenerateError)})`;
      log.warn(errorMessage);
      recordLoginAuditEvent(req, 'error', errorMessage);
      sendErrorResponse(res, 500, 'Unable to establish session');
      return;
    }

    if (!req.session) {
      const errorMessage = 'Unable to persist session after regeneration';
      log.warn(errorMessage);
      recordLoginAuditEvent(req, 'error', errorMessage);
      sendErrorResponse(res, 500, 'Unable to establish session');
      return;
    }

    req.session.rememberMe = rememberMe;
    applyRememberMe(req);

    const proceedWithLogin = (): void => {
      if (typeof req.login !== 'function') {
        recordLoginAuditEvent(req, 'success', 'Login succeeded');
        getUser(req, res);
        return;
      }

      req.login(req.user as UserWithUsername, (loginError: unknown) => {
        if (loginError) {
          const errorMessage = `Unable to persist login session (${getErrorMessage(loginError)})`;
          log.warn(errorMessage);
          recordLoginAuditEvent(req, 'error', errorMessage);
          sendErrorResponse(res, 500, 'Unable to establish session');
          return;
        }

        recordLoginAuditEvent(req, 'success', 'Login succeeded');
        getUser(req, res);
      });
    };

    const authenticatedUsername =
      typeof req.user?.username === 'string' ? req.user.username.trim() : '';
    if (authenticatedUsername.length > 0) {
      enforceSessionLimitBeforeLogin(
        req,
        authenticatedUsername,
        proceedWithLogin,
        (errorMessage: string) => {
          recordLoginAuditEvent(req, 'error', errorMessage);
          sendErrorResponse(res, 500, 'Unable to establish session');
        },
      );
      return;
    }

    proceedWithLogin();
  });
}

/**
 * Logout current user.
 * @param req
 * @param res
 */
function logout(req: AuthRequest, res: Response): void {
  req.logout((logoutError: unknown) => {
    if (logoutError) {
      log.warn(
        `Unable to clear authentication state during logout (${getErrorMessage(logoutError)})`,
      );
      sendErrorResponse(res, 500, 'Unable to clear session');
      return;
    }

    if (!req.session || typeof req.session.regenerate !== 'function') {
      const errorMessage = 'Unable to regenerate session during logout (session unavailable)';
      log.warn(errorMessage);
      sendErrorResponse(res, 500, 'Unable to clear session');
      return;
    }

    req.session.regenerate((regenerateError: unknown) => {
      if (regenerateError) {
        const errorMessage = `Unable to regenerate session during logout (${getErrorMessage(regenerateError)})`;
        log.warn(errorMessage);
        sendErrorResponse(res, 500, 'Unable to clear session');
        return;
      }

      res.status(200).json({
        logoutUrl: getLogoutRedirectUrl(),
      });
    });
  });
}

function isTrustProxyEnabled(trustproxy: boolean | number | string): boolean {
  if (trustproxy === true) {
    return true;
  }
  if (typeof trustproxy === 'number') {
    return trustproxy > 0;
  }
  if (typeof trustproxy === 'string') {
    const normalized = trustproxy.trim().toLowerCase();
    return normalized !== '' && normalized !== '0' && normalized !== 'false';
  }
  return false;
}

/**
 * Init auth (passport.js).
 * @returns {*}
 */
export function init(app: Application): void {
  const serverConfiguration = getServerConfiguration();
  maxConcurrentSessionsPerUser = getMaxConcurrentSessionsPerUser(
    serverConfiguration as Record<string, unknown>,
  );
  const sessionCookieSameSite = serverConfiguration.cookie?.samesite || 'lax';
  const hasTlsEnabled = serverConfiguration.tls?.enabled === true;
  const hasHttpsConfiguration =
    hasTlsEnabled || isTrustProxyEnabled(serverConfiguration.trustproxy);

  if (sessionCookieSameSite === 'none' && !hasHttpsConfiguration) {
    throw new Error(
      'DD_SERVER_COOKIE_SAMESITE=none requires HTTPS. Enable DD_SERVER_TLS_ENABLED=true or configure DD_SERVER_TRUSTPROXY for HTTPS reverse proxies.',
    );
  }

  const sessionCookieSecure = hasTlsEnabled || sessionCookieSameSite === 'none' ? true : 'auto';
  if (sessionCookieSameSite === 'none') {
    log.warn('DD_SERVER_COOKIE_SAMESITE=none requires HTTPS; forcing secure session cookie');
  }

  // Init express session
  app.use(
    session({
      store: new LokiStore({
        path: `${store.getConfiguration().path}/${store.getConfiguration().file}`,
        // Keep store retention >= longest auth cookie lifespan (remember-me).
        ttl: getCookieMaxAge(REMEMBER_ME_DAYS) / 1000,
      }),
      secret: getSessionSecretKey(),
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: sessionCookieSameSite,
        secure: sessionCookieSecure,
        maxAge: getCookieMaxAge(DEFAULT_SESSION_DAYS),
      },
    }),
  );

  // Init passport middleware
  app.use(passport.initialize());
  app.use(passport.session());

  // Register all authentications
  Object.values(registry.getState().authentication).forEach((authentication: Authentication) => {
    useStrategy(authentication, app);
  });

  passport.serializeUser(
    (user: UserWithUsername, done: (error: unknown, payload?: string) => void) => {
      done(null, JSON.stringify(user));
    },
  );

  passport.deserializeUser(
    (user: unknown, done: (error: unknown, payload?: SessionUser | false) => void) => {
      try {
        done(null, deserializeSessionUser(user));
      } catch (error: unknown) {
        log.warn(`Unable to deserialize session user (${getErrorMessage(error)})`);
        done(null, false);
      }
    },
  );

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
  });
  router.use(authLimiter);

  const mutationJsonBodyParser = express.json();
  router.use(requireJsonContentTypeForMutations);
  router.use((req: Request, res: Response, next: NextFunction) => {
    if (shouldParseJsonBody(req.method)) {
      return mutationJsonBodyParser(req, res, next);
    }
    return next();
  });

  // Return strategies
  router.get('/strategies', getStrategies);

  // Compatibility alias for clients that still call the legacy API path.
  // This endpoint must stay unauthenticated so the login screen can render.
  app.get('/api/auth/methods', authLimiter, getStrategies);

  // Login route with its own authentication middleware (before global auth guard)
  router.post('/login', authenticateLogin, login);

  // Routes to protect after this line
  router.use(requireAuthentication);

  // Store remember-me preference for authenticated sessions
  router.post('/remember', setRememberMe);

  router.get('/user', getUser);

  router.post('/logout', logout);

  app.use('/auth', router);
}
