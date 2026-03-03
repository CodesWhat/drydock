import ConnectLoki from 'connect-loki';
import { randomBytes } from 'crypto';
import express from 'express';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import joi from 'joi';

const LokiStore = ConnectLoki(session);

import passport from 'passport';
import { getServerConfiguration } from '../configuration/index.js';
import log from '../log/index.js';
import * as registry from '../registry/index.js';
import * as store from '../store/index.js';
import { recordAuditEvent } from './audit-events.js';

const router = express.Router();

// The configured strategy ids.
const STRATEGY_IDS = [];

const DEFAULT_SESSION_DAYS = 7;
const REMEMBER_ME_DAYS = 30;
let generatedSessionSecret: string | undefined;
const sessionUserSchema = joi
  .object({
    username: joi.string().required(),
  })
  .required()
  .unknown(false);

function deserializeSessionUser(serializedUser) {
  if (typeof serializedUser !== 'string') {
    throw new Error('Serialized user must be a JSON string');
  }

  let parsedUser;
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

  return validatedUser.value;
}

/**
 * Get all strategies id.
 * @returns {[]}
 */
export function getAllIds() {
  return STRATEGY_IDS;
}

/**
 * Express middleware to protect routes.
 * @param req
 * @param res
 * @param next
 * @returns {*}
 */
export function requireAuthentication(req, res, next): any {
  if (req.isAuthenticated()) {
    return next();
  }

  if (req.method === 'POST' && req.path === '/login') {
    return authenticateLogin(req, res, next);
  }

  return passport.authenticate(getAllIds(), { session: true })(req, res, next);
}

function sendUnauthorized(res) {
  if (typeof res.sendStatus === 'function') {
    res.sendStatus(401);
    return;
  }

  if (typeof res.status === 'function') {
    const statusResponse = res.status(401);
    if (typeof statusResponse?.end === 'function') {
      statusResponse.end();
      return;
    }
  }

  if (typeof res.end === 'function') {
    res.statusCode = 401;
    res.end();
    return;
  }

  res.statusCode = 401;
}

function authenticateLogin(req, res, next) {
  return passport.authenticate(getAllIds(), { session: false }, (error, user) => {
    if (error) {
      next(error);
      return;
    }

    if (!user) {
      recordLoginAuditEvent(req, 'error', 'Authentication failed (invalid credentials)');
      sendUnauthorized(res);
      return;
    }

    const continueWithUser = () => {
      req.user = user;
      next();
    };

    if (typeof req.login !== 'function') {
      continueWithUser();
      return;
    }

    req.login(user, { session: false }, (loginError) => {
      if (loginError) {
        next(loginError);
        return;
      }
      continueWithUser();
    });
  })(req, res, next);
}

/**
 * Get cookie max age.
 * @param days
 * @returns {number}
 */
function getCookieMaxAge(days) {
  return 3600 * 1000 * 24 * days;
}

/**
 * Get session secret key.
 * Uses DD_SESSION_SECRET env var if set, otherwise falls back to a
 * process-local cryptographic secret.
 * @returns {string}
 */
function getSessionSecretKey() {
  const envSecret = process.env.DD_SESSION_SECRET;
  if (envSecret) {
    log.info('Using session secret from DD_SESSION_SECRET environment variable');
    return envSecret;
  }
  if (!generatedSessionSecret) {
    generatedSessionSecret = randomBytes(64).toString('hex');
    log.warn(
      'DD_SESSION_SECRET is not set; using an ephemeral session secret. Set DD_SESSION_SECRET to a strong persistent value.',
    );
  }
  return generatedSessionSecret;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : `${error}`;
}

function getAuditUsername(req): string {
  return typeof req.user?.username === 'string' ? req.user.username : 'unknown';
}

function recordLoginAuditEvent(req, status: 'success' | 'error', details: string) {
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
function useStrategy(authentication, app) {
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

function getUniqueStrategies() {
  const strategies = Object.values(registry.getState().authentication).map((authentication) =>
    authentication.getStrategyDescription(),
  );
  const seenStrategies = new Set<string>();
  const uniqueStrategies = strategies.filter((strategy) => {
    const key = JSON.stringify([strategy.type, strategy.name]);
    if (seenStrategies.has(key)) {
      return false;
    }
    seenStrategies.add(key);
    return true;
  });
  return uniqueStrategies.sort((s1, s2) => s1.name.localeCompare(s2.name));
}

/**
 * Return the registered strategies from the registry.
 * @param req
 * @param res
 */
function getStrategies(req, res) {
  res.json(getUniqueStrategies());
}

function getLogoutRedirectUrl() {
  const strategyWithRedirectUrl = getUniqueStrategies().find((strategy) => strategy.logoutUrl);
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
function getUser(req, res) {
  const user = req.user || { username: 'anonymous' };
  res.status(200).json(user);
}

/**
 * Apply the "remember me" preference stored in the session.
 * When remember is true, extend the cookie to 30 days.
 * When false, make it a session cookie that expires on browser close.
 */
function applyRememberMe(req) {
  if (!req.session?.cookie) return;
  if (req.session.rememberMe) {
    req.session.cookie.maxAge = getCookieMaxAge(REMEMBER_ME_DAYS);
  } else {
    req.session.cookie.expires = false;
    req.session.cookie.maxAge = null;
  }
}

/**
 * Store the "remember me" preference in the session.
 * Called before any auth flow (basic or OIDC redirect).
 * @param req
 * @param res
 */
function setRememberMe(req, res) {
  req.session.rememberMe = req.body?.remember === true;
  res.status(200).json({ ok: true });
}

/**
 * Login user (and return it).
 * @param req
 * @param res
 */
function login(req, res) {
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

  req.session.regenerate((regenerateError) => {
    if (regenerateError) {
      const errorMessage = `Unable to regenerate session during login (${getErrorMessage(regenerateError)})`;
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

    req.login(req.user, (loginError) => {
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
function logout(req, res) {
  req.logout(() => {});
  res.status(200).json({
    logoutUrl: getLogoutRedirectUrl(),
  });
}

/**
 * Init auth (passport.js).
 * @returns {*}
 */
export function init(app) {
  const sessionCookieSameSite = getServerConfiguration().cookie?.samesite || 'lax';
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
  Object.values(registry.getState().authentication).forEach((authentication) =>
    useStrategy(authentication, app),
  );

  passport.serializeUser((user, done) => {
    done(null, JSON.stringify(user));
  });

  passport.deserializeUser((user, done) => {
    try {
      done(null, deserializeSessionUser(user));
    } catch (error: unknown) {
      log.warn(`Unable to deserialize session user (${getErrorMessage(error)})`);
      done(null, false);
    }
  });

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
  });
  router.use(authLimiter);

  // Return strategies
  router.get('/strategies', getStrategies);

  // Store remember-me preference before auth flow starts
  router.post('/remember', setRememberMe);

  // Routes to protect after this line
  router.use(requireAuthentication);

  // Add login/logout routes
  router.post('/login', login);

  router.get('/user', getUser);

  router.post('/logout', logout);

  app.use('/auth', router);
}
