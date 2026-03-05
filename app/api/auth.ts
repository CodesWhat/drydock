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
import { recordAuditEvent } from './audit-events.js';

const router = express.Router();

// The configured strategy ids.
const STRATEGY_IDS: string[] = [];

const DEFAULT_SESSION_DAYS = 7;
const REMEMBER_ME_DAYS = 30;
let generatedSessionSecret: string | undefined;
const sessionUserSchema = joi
  .object({
    username: joi.string().required(),
  })
  .required()
  .unknown(false);

interface SessionUser {
  username: string;
}

type UserWithUsername = Express.User & { username?: string };
type SessionWithRememberMe = Session & Partial<SessionData> & { rememberMe?: boolean };
type AuthRequest = Request & {
  body?: { remember?: boolean };
  session?: SessionWithRememberMe;
  user?: UserWithUsername;
};

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
  return STRATEGY_IDS;
}

export function requireAuthentication(req: AuthRequest, res: Response, next: NextFunction): void {
  if (req.isAuthenticated()) {
    next();
    return;
  }

  if (req.method === 'POST' && req.path === '/login') {
    authenticateLogin(req, res, next);
    return;
  }

  passport.authenticate(getAllIds(), { session: true })(req, res, next);
}

function sendUnauthorized(res: Response): void {
  res.sendStatus(401);
}

function authenticateLogin(req: AuthRequest, res: Response, next: NextFunction): void {
  passport.authenticate(
    getAllIds(),
    { session: false },
    (error: unknown, user: UserWithUsername | false | null) => {
      if (error) {
        next(error);
        return;
      }

      if (!user) {
        recordLoginAuditEvent(req, 'error', 'Authentication failed (invalid credentials)');
        sendUnauthorized(res);
        return;
      }

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

function shouldParseJsonBody(method: string): boolean {
  return method === 'POST' || method === 'PUT' || method === 'PATCH';
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
): void {
  recordAuditEvent({
    action: 'auth-login',
    status,
    containerName: 'authentication',
    details: `${details}; user=${getAuditUsername(req)}`,
  });
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
    res.status(500).json({ error: 'Unable to access session' });
    return;
  }
  req.session.rememberMe = req.body?.remember === true;
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
    res.status(500).json({ error: 'Unable to establish session' });
    return;
  }

  req.session.regenerate((regenerateError: unknown) => {
    if (regenerateError) {
      const errorMessage = `Unable to regenerate session during login (${getErrorMessage(regenerateError)})`;
      log.warn(errorMessage);
      recordLoginAuditEvent(req, 'error', errorMessage);
      res.status(500).json({ error: 'Unable to establish session' });
      return;
    }

    if (!req.session) {
      const errorMessage = 'Unable to persist session after regeneration';
      log.warn(errorMessage);
      recordLoginAuditEvent(req, 'error', errorMessage);
      res.status(500).json({ error: 'Unable to establish session' });
      return;
    }

    req.session.rememberMe = rememberMe;
    applyRememberMe(req);

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
        res.status(500).json({ error: 'Unable to establish session' });
        return;
      }

      recordLoginAuditEvent(req, 'success', 'Login succeeded');
      getUser(req, res);
    });
  });
}

/**
 * Logout current user.
 * @param req
 * @param res
 */
function logout(req: AuthRequest, res: Response): void {
  req.logout(() => {});
  res.status(200).json({
    logoutUrl: getLogoutRedirectUrl(),
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
  const sessionCookieSameSite = serverConfiguration.cookie?.samesite || 'lax';
  const hasHttpsConfiguration =
    serverConfiguration.tls?.enabled === true ||
    isTrustProxyEnabled(serverConfiguration.trustproxy);

  if (sessionCookieSameSite === 'none' && !hasHttpsConfiguration) {
    throw new Error(
      'DD_SERVER_COOKIE_SAMESITE=none requires HTTPS. Enable DD_SERVER_TLS_ENABLED=true or configure DD_SERVER_TRUSTPROXY for HTTPS reverse proxies.',
    );
  }

  const sessionCookieSecure = sessionCookieSameSite === 'none' ? true : 'auto';
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

  // Routes to protect after this line
  router.use(requireAuthentication);

  // Store remember-me preference for authenticated sessions
  router.post('/remember', setRememberMe);

  // Add login/logout routes
  router.post('/login', login);

  router.get('/user', getUser);

  router.post('/logout', logout);

  app.use('/auth', router);
}
