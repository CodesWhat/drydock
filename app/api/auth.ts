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
  getLogoutRedirectUrl,
  getStrategies,
  registerStrategies,
  resetStrategyIdsForTests,
} from './auth-strategies.js';
import type { AuthRequest, SessionUser, UserWithUsername } from './auth-types.js';
import { sendErrorResponse } from './error-response.js';
import { requireJsonContentTypeForMutations, shouldParseJsonBody } from './json-content-type.js';

const LokiStore = ConnectLoki(session);
const router = express.Router();

const AUTH_USER_CACHE_CONTROL = 'private, no-cache, no-store, must-revalidate';

export { getAllIds };

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

/**
 * Login user (and return it).
 * @param req
 * @param res
 */
function login(req: AuthRequest, res: Response): Promise<void> {
  const rememberMe =
    req.body?.remember !== undefined
      ? req.body.remember === true
      : req.session?.rememberMe === true;

  if (!req.session || typeof req.session.regenerate !== 'function') {
    const errorMessage = 'Unable to regenerate session during login (session unavailable)';
    log.warn(errorMessage);
    recordLoginAuditEvent(req, 'error', errorMessage);
    sendErrorResponse(res, 500, 'Unable to establish session');
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let completed = false;
    const finish = (): void => {
      if (completed) {
        return;
      }
      completed = true;
      resolve();
    };

    req.session?.regenerate((regenerateError: unknown) => {
      if (regenerateError) {
        const errorMessage = `Unable to regenerate session during login (${getErrorMessage(regenerateError)})`;
        log.warn(errorMessage);
        recordLoginAuditEvent(req, 'error', errorMessage);
        sendErrorResponse(res, 500, 'Unable to establish session');
        finish();
        return;
      }

      if (!req.session) {
        const errorMessage = 'Unable to persist session after regeneration';
        log.warn(errorMessage);
        recordLoginAuditEvent(req, 'error', errorMessage);
        sendErrorResponse(res, 500, 'Unable to establish session');
        finish();
        return;
      }

      req.session.rememberMe = rememberMe;
      applyRememberMe(req);

      const proceedWithLogin = (): Promise<void> =>
        new Promise((resolveProceed) => {
          if (typeof req.login !== 'function') {
            recordLoginAuditEvent(req, 'success', 'Login succeeded');
            getUser(req, res);
            finish();
            resolveProceed();
            return;
          }

          try {
            req.login(req.user as UserWithUsername, (loginError: unknown) => {
              if (loginError) {
                const errorMessage = `Unable to persist login session (${getErrorMessage(loginError)})`;
                log.warn(errorMessage);
                recordLoginAuditEvent(req, 'error', errorMessage);
                sendErrorResponse(res, 500, 'Unable to establish session');
                finish();
                resolveProceed();
                return;
              }

              recordLoginAuditEvent(req, 'success', 'Login succeeded');
              getUser(req, res);
              finish();
              resolveProceed();
            });
          } catch (loginError: unknown) {
            const errorMessage = `Unable to persist login session (${getErrorMessage(loginError)})`;
            log.warn(errorMessage);
            recordLoginAuditEvent(req, 'error', errorMessage);
            sendErrorResponse(res, 500, 'Unable to establish session');
            finish();
            resolveProceed();
          }
        });

      const authenticatedUsername =
        typeof req.user?.username === 'string' ? req.user.username.trim() : '';
      if (authenticatedUsername.length > 0) {
        try {
          enforceSessionLimitBeforeLogin(
            req,
            authenticatedUsername,
            proceedWithLogin,
            (errorMessage) => {
              recordLoginAuditEvent(req, 'error', errorMessage);
              sendErrorResponse(res, 500, 'Unable to establish session');
              finish();
            },
          );
        } catch (enforceError: unknown) {
          const errorMessage = `Unable to enforce session limit (${getErrorMessage(enforceError)})`;
          log.warn(errorMessage);
          recordLoginAuditEvent(req, 'error', errorMessage);
          sendErrorResponse(res, 500, 'Unable to establish session');
          finish();
        }
        return;
      }

      void proceedWithLogin();
    });
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
  configureSessionLimits(serverConfiguration as Record<string, unknown>);
  initializeLoginLockoutState();
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
