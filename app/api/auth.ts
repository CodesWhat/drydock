import ConnectLoki from 'connect-loki';
import express, { type Application, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import passport from 'passport';
import { getServerConfiguration } from '../configuration/index.js';
import log from '../log/index.js';
import * as store from '../store/index.js';
import { getErrorMessage } from '../util/error.js';
import { recordLoginAuditEvent } from './auth-audit.js';
import {
  authenticateLogin,
  initializeLoginLockoutState,
  resetLoginLockoutStateForTests,
} from './auth-lockout.js';
import { applyRememberMe, setRememberMe } from './auth-remember-me.js';
import {
  configureSessionLimits,
  DEFAULT_SESSION_DAYS,
  deserializeSessionUser,
  enforceSessionLimitBeforeLogin,
  getCookieMaxAge,
  getSessionSecretKey,
  REMEMBER_ME_DAYS,
} from './auth-session.js';
import {
  getAllIds,
  getAuthStatus,
  getLogoutRedirectUrl,
  getStrategies,
  registerStrategies,
  resetStrategyIdsForTests,
} from './auth-strategies.js';
import type { AuthRequest, SessionUser, UserWithUsername } from './auth-types.js';
import { requireSameOriginForMutations } from './csrf.js';
import { sendErrorResponse } from './error-response.js';
import { requireJsonContentTypeForMutations, shouldParseJsonBody } from './json-content-type.js';
import {
  createAuthenticatedRouteRateLimitKeyGenerator,
  isIdentityAwareRateLimitKeyingEnabled,
} from './rate-limit-key.js';

const LokiStore = ConnectLoki(session);
const router = express.Router();

const AUTH_USER_CACHE_CONTROL = 'private, no-cache, no-store, must-revalidate';
const LOGIN_SESSION_ERROR_RESPONSE = 'Unable to establish session';
const LOGIN_SUCCESS_AUDIT_MESSAGE = 'Login succeeded';
const DEPRECATED_AUTH_METHODS_WARNING =
  'GET /api/auth/methods is deprecated and will be removed in v1.7.0. Use GET /api/v1/auth/status instead.';
const DEPRECATED_AUTH_STRATEGIES_WARNING =
  'GET /auth/strategies is deprecated and will be removed in v1.8.0. Use GET /api/v1/auth/status instead.';
// '@1783123200' = 2026-07-04T00:00:00Z, the date this endpoint actually
// started sending the deprecation signal (v1.6.0) — the RFC 9745
// Deprecation value must be the instant the resource became deprecated, a
// past/current date, never the same instant as the future Sunset removal
// date below.
const DEPRECATED_AUTH_METHODS_DEPRECATION = '@1783123200';
const DEPRECATED_AUTH_METHODS_SUNSET = 'Thu, 01 Jul 2027 00:00:00 GMT';
const DEPRECATED_AUTH_STRATEGIES_SUNSET = 'Sat, 01 Jul 2028 00:00:00 GMT';
let sessionMiddleware: ReturnType<typeof session> | undefined;

type LoginFinish = () => void;
type LoginErrorHandler = (errorMessage: string, options?: { logWarning?: boolean }) => void;

export { getAllIds };

export function getSessionMiddleware() {
  return sessionMiddleware;
}

export function _resetLoginLockoutStateForTests(): void {
  resetLoginLockoutStateForTests();
}

export function _resetStrategyIdsForTests(): void {
  resetStrategyIdsForTests();
}

export function requireAuthentication(req: AuthRequest, res: Response, next: NextFunction): void {
  if (req.isAuthenticated()) {
    next();
    return;
  }

  passport.authenticate(getAllIds(), { session: true })(req, res, next);
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

function getRememberMePreference(req: AuthRequest): boolean {
  return req.body?.remember !== undefined
    ? req.body.remember === true
    : req.session?.rememberMe === true;
}

function getAuthenticatedUsername(req: AuthRequest): string {
  return typeof req.user?.username === 'string' ? req.user.username.trim() : '';
}

function createLoginFinish(resolve: () => void): LoginFinish {
  let completed = false;
  return () => {
    if (completed) {
      return;
    }
    completed = true;
    resolve();
  };
}

function handleLoginSuccess(req: AuthRequest, res: Response, finish: LoginFinish): void {
  recordLoginAuditEvent(req, 'success', LOGIN_SUCCESS_AUDIT_MESSAGE);
  getUser(req, res);
  finish();
}

function handleLoginError(
  req: AuthRequest,
  res: Response,
  finish: LoginFinish,
  errorMessage: string,
  options?: { logWarning?: boolean },
): void {
  if (options?.logWarning !== false) {
    log.warn(errorMessage);
  }
  recordLoginAuditEvent(req, 'error', errorMessage);
  sendErrorResponse(res, 500, LOGIN_SESSION_ERROR_RESPONSE);
  finish();
}

function proceedWithLogin(
  req: AuthRequest,
  res: Response,
  finish: LoginFinish,
  failLogin: LoginErrorHandler,
): Promise<void> {
  return new Promise((resolveProceed) => {
    if (typeof req.login !== 'function') {
      handleLoginSuccess(req, res, finish);
      resolveProceed();
      return;
    }

    try {
      req.login(req.user as UserWithUsername, (loginError: unknown) => {
        if (loginError) {
          failLogin(`Unable to persist login session (${getErrorMessage(loginError)})`);
          resolveProceed();
          return;
        }

        handleLoginSuccess(req, res, finish);
        resolveProceed();
      });
    } catch (loginError: unknown) {
      failLogin(`Unable to persist login session (${getErrorMessage(loginError)})`);
      resolveProceed();
    }
  });
}

function enforceLoginSessionLimit(
  req: AuthRequest,
  res: Response,
  finish: LoginFinish,
  proceed: () => Promise<void>,
  failLogin: LoginErrorHandler,
): void {
  const authenticatedUsername = getAuthenticatedUsername(req);
  if (authenticatedUsername.length === 0) {
    void proceed();
    return;
  }

  try {
    enforceSessionLimitBeforeLogin(req, authenticatedUsername, proceed, (errorMessage) => {
      handleLoginError(req, res, finish, errorMessage, { logWarning: false });
    });
  } catch (enforceError: unknown) {
    failLogin(`Unable to enforce session limit (${getErrorMessage(enforceError)})`);
  }
}

function regenerateSessionForLogin(
  req: AuthRequest,
  onSuccess: () => void,
  failLogin: LoginErrorHandler,
): void {
  if (!req.session || typeof req.session.regenerate !== 'function') {
    failLogin('Unable to regenerate session during login (session unavailable)');
    return;
  }

  let settled = false;
  const settle = (callback: () => void): void => {
    if (settled) {
      return;
    }
    settled = true;
    callback();
  };

  try {
    req.session.regenerate((regenerateError: unknown) => {
      if (regenerateError) {
        settle(() =>
          failLogin(
            `Unable to regenerate session during login (${getErrorMessage(regenerateError)})`,
          ),
        );
        return;
      }

      settle(onSuccess);
    });
  } catch (regenerateError: unknown) {
    settle(() =>
      failLogin(`Unable to regenerate session during login (${getErrorMessage(regenerateError)})`),
    );
  }
}

/**
 * Login user (and return it).
 * @param req
 * @param res
 */
function login(req: AuthRequest, res: Response): Promise<void> {
  const rememberMe = getRememberMePreference(req);

  return new Promise((resolve) => {
    const finish = createLoginFinish(resolve);
    const failLogin: LoginErrorHandler = (errorMessage, options) =>
      handleLoginError(req, res, finish, errorMessage, options);

    regenerateSessionForLogin(
      req,
      () => {
        if (!req.session) {
          failLogin('Unable to persist session after regeneration');
          return;
        }

        req.session.rememberMe = rememberMe;
        applyRememberMe(req);

        const proceed = (): Promise<void> => proceedWithLogin(req, res, finish, failLogin);
        enforceLoginSessionLimit(req, res, finish, proceed, failLogin);
      },
      failLogin,
    );
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

/**
 * Return auth strategies via the deprecated, unversioned /api/auth/methods
 * alias. Logs a deprecation warning on every request per DEPRECATIONS.md and
 * sets the RFC 9745 Deprecation / RFC 8594 Sunset headers (same treatment as
 * PUT /api/settings), then delegates to getStrategies for the actual
 * (unchanged) response body.
 * @param req
 * @param res
 */
function getStrategiesDeprecatedMethodsAlias(req: Request, res: Response): void {
  log.warn(DEPRECATED_AUTH_METHODS_WARNING);
  res.setHeader('Deprecation', DEPRECATED_AUTH_METHODS_DEPRECATION);
  res.setHeader('Sunset', DEPRECATED_AUTH_METHODS_SUNSET);
  getStrategies(req, res);
}

function getStrategiesDeprecatedResponse(req: Request, res: Response): void {
  log.warn(DEPRECATED_AUTH_STRATEGIES_WARNING);
  res.setHeader('Deprecation', DEPRECATED_AUTH_METHODS_DEPRECATION);
  res.setHeader('Sunset', DEPRECATED_AUTH_STRATEGIES_SUNSET);
  getStrategies(req, res);
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
  configureSessionLimits(serverConfiguration as Record<string, unknown>);
  initializeLoginLockoutState();
  const identityAwareRateLimitKeyGenerator = createAuthenticatedRouteRateLimitKeyGenerator(
    isIdentityAwareRateLimitKeyingEnabled(serverConfiguration as Record<string, unknown>),
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
  sessionMiddleware = session({
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
  });
  app.use(sessionMiddleware);

  // Init passport middleware
  app.use(passport.initialize());
  app.use(passport.session());

  // Register all authentications
  registerStrategies(app);

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
    // Authenticated UI navigations re-read the current user. Keep that safe
    // probe from exhausting the public discovery and login budget for clients
    // behind the same address; every other auth route remains capped.
    skip: (req: Request) =>
      req.method === 'GET' &&
      req.path === '/user' &&
      typeof req.isAuthenticated === 'function' &&
      req.isAuthenticated(),
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    ...(identityAwareRateLimitKeyGenerator
      ? { keyGenerator: identityAwareRateLimitKeyGenerator }
      : {}),
  });
  router.use(authLimiter);

  const mutationJsonBodyParser = express.json({ limit: '64kb' });
  router.use(requireJsonContentTypeForMutations);
  router.use((req: Request, res: Response, next: NextFunction) => {
    if (shouldParseJsonBody(req.method)) {
      return mutationJsonBodyParser(req, res, next);
    }
    return next();
  });

  // Return strategies
  router.get('/strategies', getStrategiesDeprecatedResponse);
  router.get('/status', getAuthStatus);

  // Compatibility alias for clients that still call the legacy API path.
  // This endpoint must stay unauthenticated so the login screen can render.
  // Deprecated in v1.6.0, scheduled for removal in v1.7.0 — see DEPRECATIONS.md.
  app.get('/api/auth/methods', authLimiter, getStrategiesDeprecatedMethodsAlias);
  app.get('/api/v1/auth/status', authLimiter, getAuthStatus);
  app.get('/api/auth/status', authLimiter, getAuthStatus);

  // Login route with its own authentication middleware (before global auth guard)
  router.post('/login', authenticateLogin, login);

  // Routes to protect after this line
  router.use(requireAuthentication);
  router.use(requireSameOriginForMutations);

  // Store remember-me preference for authenticated sessions
  router.post('/remember', setRememberMe);

  router.get('/user', getUser);

  router.post('/logout', logout);

  app.use('/auth', router);
}
