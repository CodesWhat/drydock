import { STATUS_CODES } from 'node:http';
import ConnectLoki from 'connect-loki';
import express, { type Application, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
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
  enforceSessionLimitBeforeLogin,
  getCookieMaxAge,
  getSessionSecretKey,
  REMEMBER_ME_DAYS,
} from './auth-session.js';
import {
  getAuthStatus,
  getLogoutRedirectUrl,
  getStrategies,
  isAuthenticationReady,
  registerAuthenticators,
  resetAuthenticatorsForTests,
} from './auth-strategies.js';
import type { AuthRequest } from './auth-types.js';
import { authenticateRequest, getAuthenticationFailureStatus } from './authenticator-chain.js';
import { requireSameOriginForMutations } from './csrf.js';
import { sendErrorResponse } from './error-response.js';
import { requireJsonContentTypeForMutations, shouldParseJsonBody } from './json-content-type.js';
import {
  ANONYMOUS_USERNAME,
  type AuthenticatedPrincipal,
  getIdentityUsername,
  getPrincipal,
  isAuthenticated,
  isLoginSessionEligible,
} from './principal.js';
import {
  createAuthenticatedRouteRateLimitKeyGenerator,
  isIdentityAwareRateLimitKeyingEnabled,
  isRequestAuthenticated,
} from './rate-limit-key.js';
import { SESSION_COOKIE_NAME } from './session-cookie.js';
import {
  clearSessionPrincipal,
  restoreSessionPrincipal,
  writeSessionPrincipal,
} from './session-principal.js';

const LokiStore = ConnectLoki(session);
const router = express.Router();

const AUTH_USER_CACHE_CONTROL = 'private, no-cache, no-store, must-revalidate';
const LOGIN_SESSION_ERROR_RESPONSE = 'Unable to establish session';
const LOGIN_SUCCESS_AUDIT_MESSAGE = 'Login succeeded';
const DEPRECATED_AUTH_STRATEGIES_WARNING =
  'GET /auth/strategies is deprecated and will be removed in v1.8.0. Use GET /api/v1/auth/status instead.';
// '@1783123200' = 2026-07-04T00:00:00Z, the date the /auth/strategies alias
// started sending the deprecation signal (v1.6.0) — the RFC 9745
// Deprecation value must be the instant the resource became deprecated, a
// past/current date, never the same instant as the future Sunset removal
// date below. This same instant used to double as the Deprecation value for
// the now-removed GET /api/auth/methods alias (both were deprecated in the
// same v1.6.0 release); it stays here for /auth/strategies alone.
const DEPRECATED_AUTH_METHODS_DEPRECATION = '@1783123200';
const DEPRECATED_AUTH_STRATEGIES_SUNSET = 'Sat, 01 Jul 2028 00:00:00 GMT';
let sessionMiddleware: ReturnType<typeof session> | undefined;

type LoginFinish = () => void;
type LoginErrorHandler = (errorMessage: string, options?: { logWarning?: boolean }) => void;

export { isAuthenticationReady };

export function getSessionMiddleware() {
  return sessionMiddleware;
}

export function _resetLoginLockoutStateForTests(): void {
  resetLoginLockoutStateForTests();
}

export function _resetAuthenticatorsForTests(): void {
  resetAuthenticatorsForTests();
}

/**
 * Reject a request nothing in the chain accepted.
 *
 * Reproduces passport's allFailed(): the status an authenticator named or 401,
 * and the bare status text as the body, with no JSON envelope and no
 * Content-Type. Drydock suppressed Basic's WWW-Authenticate challenge so
 * browsers never raised the native credential prompt, and no authenticator
 * names one, so no challenge header is sent either.
 */
function rejectUnauthenticated(req: AuthRequest, res: Response): void {
  const status = getAuthenticationFailureStatus(req);
  res.statusCode = status;
  res.end(STATUS_CODES[status]);
}

export async function requireAuthentication(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (isAuthenticated(req)) {
    next();
    return;
  }

  let principal: AuthenticatedPrincipal | undefined;
  try {
    principal = await authenticateRequest(req);
  } catch (error: unknown) {
    next(error);
    return;
  }

  if (principal === undefined) {
    rejectUnauthenticated(req, res);
    return;
  }

  next();
}

/**
 * Get current user.
 * @param req
 * @param res
 */
function getUser(req: AuthRequest, res: Response): void {
  const user = { username: getPrincipal(req)?.username ?? ANONYMOUS_USERNAME };
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
  return getIdentityUsername(req)?.trim() ?? '';
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
    try {
      const principal = getPrincipal(req);
      if (principal !== undefined) {
        writeSessionPrincipal(req, principal);
      }
      handleLoginSuccess(req, res, finish);
    } catch (loginError: unknown) {
      failLogin(`Unable to persist login session (${getErrorMessage(loginError)})`);
    }
    resolveProceed();
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

    if (!isLoginSessionEligible(getPrincipal(req))) {
      rejectUnauthenticated(req, res);
      finish();
      resolve();
      return;
    }

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
  const failLogout = (errorMessage: string): void => {
    log.warn(errorMessage);
    sendErrorResponse(res, 500, 'Unable to clear session');
  };

  try {
    clearSessionPrincipal(req);
  } catch (logoutError: unknown) {
    failLogout(
      `Unable to clear authentication state during logout (${getErrorMessage(logoutError)})`,
    );
    return;
  }

  if (typeof req.session?.regenerate !== 'function') {
    failLogout('Unable to regenerate session during logout (session unavailable)');
    return;
  }

  req.session.regenerate((regenerateError: unknown) => {
    if (regenerateError) {
      failLogout(
        `Unable to regenerate session during logout (${getErrorMessage(regenerateError)})`,
      );
      return;
    }

    res.status(200).json({
      logoutUrl: getLogoutRedirectUrl(),
    });
  });
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
 * Init auth: session middleware, the authenticator chain, and the /auth routes.
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
    name: SESSION_COOKIE_NAME,
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

  // Publish the session identity as req.principal before anything downstream
  // reads it — the outer API rate limiter keys on it and runs ahead of the
  // authentication guard, exactly as it did behind passport.session().
  app.use(restoreSessionPrincipal);

  // Register all authentications
  registerAuthenticators(app);

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    // Authenticated UI navigations re-read the current user. Keep that safe
    // probe from exhausting the public discovery and login budget for clients
    // behind the same address; every other auth route remains capped. Check
    // authentication before request-controlled route data so the request
    // cannot decide whether the security check runs.
    skip: (req: Request) =>
      isRequestAuthenticated(req) && req.method === 'GET' && req.path === '/user',
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

  // GET /api/auth/methods was a compatibility alias for clients that still
  // called the legacy API path. Deprecated in v1.6.0, removed in v1.7.0 — see
  // DEPRECATIONS.md. It is no longer registered here, so requests now fall
  // through to the unversioned /api/* tombstone in app/api/index.ts.
  app.get('/api/v1/auth/status', authLimiter, getAuthStatus);
  app.get('/api/auth/status', authLimiter, getAuthStatus);

  // Login route with its own authentication middleware (before global auth guard)
  router.post('/login', authenticateLogin, login);

  // OIDC login flows set this preference before the provider redirects away.
  // Keep same-origin protection on the unauthenticated pre-auth session.
  router.post('/remember', requireSameOriginForMutations, setRememberMe);

  // Routes to protect after this line
  router.use(requireAuthentication);
  router.use(requireSameOriginForMutations);

  router.get('/user', getUser);

  router.post('/logout', logout);

  app.use('/auth', router);
}
