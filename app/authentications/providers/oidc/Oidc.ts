import { readFile } from 'node:fs/promises';
import type { ConnectionOptions } from 'node:tls';
import type { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import * as openidClientLibrary from 'openid-client';
import { Agent } from 'undici';
import { v4 as uuid } from 'uuid';
import { ddEnvVars, getPublicUrl, getServerConfiguration } from '../../../configuration/index.js';
import { observeAuthLoginDuration, recordAuthLogin } from '../../../prometheus/auth.js';
import { resolveConfiguredPath } from '../../../runtime/paths.js';
import { getErrorMessage } from '../../../util/error.js';
import { enforceConcurrentSessionLimit } from '../../../util/session-limit.js';
import Authentication from '../Authentication.js';
import OidcStrategy from './OidcStrategy.js';

const OIDC_CHECKS_TTL_MS = 5 * 60 * 1000;
const OIDC_MAX_PENDING_CHECKS = 5;
const OIDC_SESSION_LOCK_WAIT_TIMEOUT_MS = 10 * 1000;
const OIDC_SESSION_LOCK_STALE_TTL_MS = 60 * 1000;
const DEFAULT_MAX_CONCURRENT_SESSIONS_PER_USER = 5;
const oidcSessionLocks = new Map<string, Promise<void>>();
const OIDC_STATE_PATTERN = /^[A-Za-z0-9._~-]{8,256}$/;
const SENSITIVE_OIDC_PARAMS = new Set([
  'client_id',
  'client_secret',
  'code_challenge',
  'state',
  'nonce',
  'code',
]);

interface OidcAppLike {
  use: (path: string, middleware: unknown) => void;
  get: (path: string, handler: (req: Request, res: Response) => void) => void;
}

interface OidcPendingCheck {
  state: string;
  codeVerifier: string;
  createdAt: number;
}

type OidcPendingChecks = Record<string, OidcPendingCheck>;

interface OidcSessionEntry {
  pending?: Record<string, unknown>;
  state?: unknown;
  codeVerifier?: unknown;
}

interface OidcSessionLike {
  oidc?: Record<string, OidcSessionEntry>;
  rememberMe?: boolean;
  cookie?: {
    maxAge?: number | null;
    expires?: boolean | Date;
  };
  reload?: (callback: (error?: unknown) => void) => void;
  regenerate?: (callback: (error?: unknown) => void) => void;
  save?: (callback: (error?: unknown) => void) => void;
}

interface OidcAuthenticatedUser {
  username: string;
}

type OidcVerifyDone = (error: unknown, user?: OidcAuthenticatedUser | false) => void;

type OidcRedirectRequest = Request & {
  session?: OidcSessionLike;
  sessionID?: string;
};

type OidcCallbackRequest = Request & {
  session?: OidcSessionLike;
  sessionID?: string;
  sessionStore?: {
    all?: (callback: (error: unknown, sessions?: unknown) => void) => void;
    destroy?: (sid: string, callback: (error?: unknown) => void) => void;
  };
  originalUrl?: string;
  url: string;
  login: (user: OidcAuthenticatedUser, done: (error?: unknown) => void) => void;
};

interface OidcCallbackValidationResult {
  callbackUrl: URL;
  callbackState: string;
  pendingChecks: OidcPendingChecks;
  oidcCheck: OidcPendingCheck;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isValidStateToken(value: unknown): value is string {
  return isNonEmptyString(value) && OIDC_STATE_PATTERN.test(value);
}

function redactUrlParams(url: string): string {
  try {
    const parsed = new URL(url);
    let result = url;
    for (const [key, value] of parsed.searchParams) {
      if (SENSITIVE_OIDC_PARAMS.has(key) && value) {
        result = result.replace(`${key}=${encodeURIComponent(value)}`, `${key}=[REDACTED]`);
      }
    }
    return result;
  } catch {
    return '[unparseable URL]';
  }
}

function parseHttpUrl(value: unknown): URL | undefined {
  if (!isNonEmptyString(value)) {
    return undefined;
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

function normalizePathname(pathname: string): string {
  const normalized = pathname.replace(/\/+$/, '');
  return normalized.length > 0 ? normalized : '/';
}

function toEndpointKey(url: URL): string {
  return `${url.origin}${normalizePathname(url.pathname)}`;
}

function getElapsedSeconds(startedAt: bigint): number {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
}

function createPendingChecksRecord(): OidcPendingChecks {
  return Object.create(null) as OidcPendingChecks;
}

function isValidCheckEntry(state: unknown, check: unknown): check is OidcPendingCheck {
  return (
    isValidStateToken(state) &&
    !!check &&
    typeof check === 'object' &&
    isNonEmptyString((check as OidcPendingCheck).codeVerifier)
  );
}

function collectValidChecks(pending: Record<string, unknown>, now: number): OidcPendingChecks {
  const result = createPendingChecksRecord();
  Object.entries(pending).forEach(([state, check]) => {
    if (!isValidCheckEntry(state, check)) {
      return;
    }
    const normalizedState = isNonEmptyString(check.state) ? check.state : state;
    if (normalizedState !== state) {
      return;
    }
    const createdAt = typeof check.createdAt === 'number' ? check.createdAt : now;
    if (now - createdAt <= OIDC_CHECKS_TTL_MS) {
      result[state] = { state, codeVerifier: check.codeVerifier, createdAt };
    }
  });
  return result;
}

function convertLegacyFormat(rawChecks: OidcSessionEntry, now: number): OidcPendingChecks {
  if (isValidStateToken(rawChecks.state) && isNonEmptyString(rawChecks.codeVerifier)) {
    return {
      [rawChecks.state]: {
        state: rawChecks.state,
        codeVerifier: rawChecks.codeVerifier,
        createdAt: now,
      },
    };
  }
  return createPendingChecksRecord();
}

function limitToMostRecent(pendingChecks: OidcPendingChecks): OidcPendingChecks {
  const mostRecent = Object.entries(pendingChecks)
    .sort(([, c1], [, c2]) => c2.createdAt - c1.createdAt)
    .slice(0, OIDC_MAX_PENDING_CHECKS);
  const limited = createPendingChecksRecord();
  mostRecent.forEach(([state, check]) => {
    limited[state] = check;
  });
  return limited;
}

function normalizePendingChecks(rawChecks: unknown): OidcPendingChecks {
  const now = Date.now();

  if (rawChecks === null || typeof rawChecks !== 'object') {
    return createPendingChecksRecord();
  }

  let pendingChecks = createPendingChecksRecord();
  const pendingFromSession = (rawChecks as OidcSessionEntry).pending;
  if (pendingFromSession !== null && typeof pendingFromSession === 'object') {
    pendingChecks = collectValidChecks(pendingFromSession, now);
  }

  // Backward compatibility with previously persisted single-check shape.
  if (Object.keys(pendingChecks).length === 0) {
    pendingChecks = convertLegacyFormat(rawChecks, now);
  }

  return limitToMostRecent(pendingChecks);
}

async function withOidcSessionLock<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
  const previousLock = oidcSessionLocks.get(sessionId) || Promise.resolve();
  let releaseLock: (() => void) | undefined;
  const currentLock = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  const nextLock = previousLock.catch(() => undefined).then(() => currentLock);
  oidcSessionLocks.set(sessionId, nextLock);

  const staleLockCleanupTimer = setTimeout(() => {
    /* v8 ignore start -- false branch unreachable: no concurrent lock replacement in tests */
    if (oidcSessionLocks.get(sessionId) === nextLock) {
      oidcSessionLocks.delete(sessionId);
    }
    /* v8 ignore stop */
  }, OIDC_SESSION_LOCK_STALE_TTL_MS);
  staleLockCleanupTimer.unref?.();

  let previousLockWaitTimer: ReturnType<typeof setTimeout> | undefined;

  try {
    await Promise.race([
      previousLock.catch(() => undefined),
      new Promise<void>((resolve) => {
        previousLockWaitTimer = setTimeout(resolve, OIDC_SESSION_LOCK_WAIT_TIMEOUT_MS);
        previousLockWaitTimer.unref?.();
      }),
    ]);
    return await operation();
  } finally {
    /* v8 ignore start -- always assigned: Promise executor runs synchronously */
    if (previousLockWaitTimer !== undefined) {
      clearTimeout(previousLockWaitTimer);
    }
    /* v8 ignore stop */
    clearTimeout(staleLockCleanupTimer);
    releaseLock?.();
    if (oidcSessionLocks.get(sessionId) === nextLock) {
      oidcSessionLocks.delete(sessionId);
    }
  }
}

async function reloadSessionIfPossible(session: OidcSessionLike | undefined) {
  if (!session || typeof session.reload !== 'function') {
    return;
  }
  try {
    await new Promise((resolve, reject) => {
      session.reload((err) => {
        if (err) {
          reject(err);
        } else {
          resolve(undefined);
        }
      });
    });
  } catch {
    // Corrupt session — regenerate to self-heal (e.g. WUD migration)
    if (typeof session.regenerate === 'function') {
      await new Promise((resolve, reject) => {
        session.regenerate((err) => (err ? reject(err) : resolve(undefined)));
      });
    }
  }
}

async function saveSessionIfPossible(session: OidcSessionLike | undefined) {
  if (!session || typeof session.save !== 'function') {
    return;
  }
  await new Promise((resolve, reject) => {
    session.save((err) => {
      if (err) {
        reject(err);
      } else {
        resolve(undefined);
      }
    });
  });
}

async function regenerateSessionIfPossible(session: OidcSessionLike | undefined) {
  if (!session || typeof session.regenerate !== 'function') {
    return;
  }
  await new Promise((resolve, reject) => {
    session.regenerate((err) => {
      if (err) {
        reject(err);
      } else {
        resolve(undefined);
      }
    });
  });
}

function getMaxConcurrentSessionsPerUser(): number {
  const serverConfiguration = getServerConfiguration() as Record<string, unknown>;
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

/**
 * Htpasswd authentication.
 */
class Oidc extends Authentication {
  openidClient: typeof openidClientLibrary = openidClientLibrary;
  client!: openidClientLibrary.Configuration;
  logoutUrl?: string;

  getSessionKey() {
    return this.name || 'default';
  }

  async getOpenIdClient() {
    return this.openidClient;
  }

  /**
   * Get the Trigger configuration schema.
   * @returns {*}
   */
  getConfigurationSchema() {
    return this.joi.object().keys({
      discovery: this.joi.string().uri().required(),
      clientid: this.joi.string().required(),
      clientsecret: this.joi.string().required(),
      cafile: this.joi.string(),
      insecure: this.joi.boolean().default(false),
      redirect: this.joi.boolean().default(false),
      logouturl: this.joi.string().uri({ scheme: ['http', 'https'] }),
      timeout: this.joi.number().greater(500).default(5000),
    });
  }

  validateConfiguration(configuration) {
    const validatedConfiguration = super.validateConfiguration(configuration);
    const publicUrl = ddEnvVars.DD_PUBLIC_URL;
    if (typeof publicUrl !== 'string' || publicUrl.trim().length === 0) {
      throw new Error('DD_PUBLIC_URL must be set when OIDC authentication is configured');
    }
    return validatedConfiguration;
  }

  /**
   * Sanitize sensitive data
   * @returns {*}
   */
  maskConfiguration() {
    return {
      ...this.configuration,
      discovery: this.configuration.discovery,
      clientid: Oidc.mask(this.configuration.clientid),
      clientsecret: Oidc.mask(this.configuration.clientsecret),
      ...(this.configuration.cafile ? { cafile: Oidc.mask(this.configuration.cafile) } : {}),
      ...(typeof this.configuration.insecure === 'boolean'
        ? { insecure: this.configuration.insecure }
        : {}),
      redirect: this.configuration.redirect,
      ...(this.configuration.logouturl ? { logouturl: this.configuration.logouturl } : {}),
      timeout: this.configuration.timeout,
    };
  }

  async initAuthentication() {
    this.log.debug(`Discovering configuration from ${this.configuration.discovery}`);
    const openidClient = await this.getOpenIdClient();
    const timeoutSeconds = Math.ceil(this.configuration.timeout / 1000);
    const discoveryUrl = new URL(this.configuration.discovery);
    let execute: Array<typeof openidClient.allowInsecureRequests> = [];
    if (discoveryUrl.protocol === 'http:') {
      this.log.warn(
        'HTTP OIDC discovery URL is deprecated and will be removed in v1.6.0. Update your Identity Provider to serve discovery over HTTPS.',
      );
      execute = [openidClient.allowInsecureRequests];
    }
    const discoveryOptions: openidClientLibrary.DiscoveryRequestOptions = {
      timeout: timeoutSeconds,
      execute,
    };
    if (this.configuration.cafile || this.configuration.insecure) {
      const connectOptions: ConnectionOptions = {};
      if (this.configuration.cafile) {
        const caFilePath = resolveConfiguredPath(this.configuration.cafile, {
          label: 'OIDC CA certificate path',
        });
        connectOptions.ca = await readFile(caFilePath);
      }
      if (this.configuration.insecure) {
        this.log.warn('TLS certificate verification disabled for OIDC - do not use in production');
        connectOptions.rejectUnauthorized = false;
      }
      const dispatcher = new Agent({ connect: connectOptions });
      const oidcFetch: openidClientLibrary.CustomFetch = (input, init) =>
        fetch(
          input as RequestInfo | URL,
          {
            ...(init as unknown as RequestInit),
            dispatcher,
          } as RequestInit & { dispatcher: Agent },
        );
      discoveryOptions[openidClient.customFetch] = oidcFetch;
    }
    this.client = await openidClient.discovery(
      discoveryUrl,
      this.configuration.clientid,
      this.configuration.clientsecret,
      openidClient.ClientSecretPost(this.configuration.clientsecret),
      discoveryOptions,
    );
    this.logoutUrl = this.configuration.logouturl;
    try {
      this.logoutUrl = openidClient.buildEndSessionUrl(this.client).href;
    } catch (e: unknown) {
      this.log.warn(` End session url is not supported (${getErrorMessage(e)})`);
    }
  }

  /**
   * Return passport strategy.
   * @param app
   */
  getStrategy(app?: OidcAppLike) {
    if (!app) {
      throw new Error('OIDC strategy requires an express app instance');
    }
    const oidcLimiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 50,
      standardHeaders: true,
      legacyHeaders: false,
      validate: { xForwardedForHeader: false },
    });
    app.use(`/auth/oidc/${this.name}`, oidcLimiter);
    app.get(`/auth/oidc/${this.name}/redirect`, (req, res) => {
      void this.redirect(req, res);
    });
    app.get(`/auth/oidc/${this.name}/cb`, (req, res) => {
      void this.callback(req, res);
    });
    const strategy = new OidcStrategy(
      {
        config: this.client,
        scope: 'openid email profile',
        name: 'oidc',
      },
      (accessToken, done) => {
        void this.verify(accessToken, done);
      },
      this.log,
    );
    return strategy;
  }

  getStrategyDescription() {
    return {
      type: 'oidc',
      name: this.name,
      redirect: this.configuration.redirect,
      logoutUrl: this.logoutUrl,
    };
  }

  getAllowedAuthorizationRedirects() {
    const strictEndpoints = new Set<string>();
    const allowedOrigins = new Set<string>();

    const discoveryUrl = parseHttpUrl(this.configuration.discovery);
    if (discoveryUrl) {
      allowedOrigins.add(discoveryUrl.origin);
    }

    if (this.client && typeof this.client.serverMetadata === 'function') {
      const serverMetadata = this.client.serverMetadata();
      const authorizationEndpoint = parseHttpUrl(serverMetadata.authorization_endpoint);
      if (authorizationEndpoint) {
        strictEndpoints.add(toEndpointKey(authorizationEndpoint));
        allowedOrigins.add(authorizationEndpoint.origin);
      }
      const issuerUrl = parseHttpUrl(serverMetadata.issuer);
      if (issuerUrl) {
        allowedOrigins.add(issuerUrl.origin);
      }
    }

    return { strictEndpoints, allowedOrigins };
  }

  isAllowedAuthorizationRedirect(authUrl: URL) {
    if (authUrl.protocol !== 'http:' && authUrl.protocol !== 'https:') {
      return false;
    }
    const { strictEndpoints, allowedOrigins } = this.getAllowedAuthorizationRedirects();
    if (strictEndpoints.size > 0) {
      return strictEndpoints.has(toEndpointKey(authUrl));
    }
    return allowedOrigins.has(authUrl.origin);
  }

  async redirect(req: OidcRedirectRequest, res: Response): Promise<void> {
    const openidClient = await this.getOpenIdClient();
    const codeVerifier = openidClient.randomPKCECodeVerifier();
    const codeChallenge = await openidClient.calculatePKCECodeChallenge(codeVerifier);
    const state = uuid();
    const sessionKey = this.getSessionKey();
    const sessionLockKey =
      typeof req.sessionID === 'string' && req.sessionID !== '' ? req.sessionID : undefined;

    if (!req.session) {
      this.log.warn('Unable to initialize OIDC checks because no session is available');
      res.status(500).json({ error: 'Unable to initialize OIDC session' });
      return;
    }
    const authUrl = openidClient.buildAuthorizationUrl(this.client, {
      redirect_uri: `${getPublicUrl(req)}/auth/oidc/${this.name}/cb`,
      scope: 'openid email profile',
      code_challenge_method: 'S256',
      code_challenge: codeChallenge,
      state,
    }).href;
    this.log.debug(`Build redirection url [${redactUrlParams(authUrl)}]`);
    const parsedAuthUrl = parseHttpUrl(authUrl);
    if (!parsedAuthUrl || !this.isAllowedAuthorizationRedirect(parsedAuthUrl)) {
      this.log.warn(
        `OIDC authorization redirect URL is not allowed for strategy ${sessionKey} (${redactUrlParams(authUrl)})`,
      );
      res.status(500).json({ error: 'Unable to initialize OIDC session' });
      return;
    }

    try {
      const persistOidcChecks = async () => {
        await reloadSessionIfPossible(req.session);

        if (!req.session?.oidc || typeof req.session.oidc !== 'object') {
          req.session.oidc = {};
        }
        const pendingChecks = normalizePendingChecks(req.session.oidc[sessionKey]);
        pendingChecks[state] = {
          state,
          codeVerifier,
          createdAt: Date.now(),
        };
        req.session.oidc[sessionKey] = {
          pending: normalizePendingChecks({ pending: pendingChecks }),
        };

        await saveSessionIfPossible(req.session);
      };

      if (sessionLockKey) {
        await withOidcSessionLock(sessionLockKey, persistOidcChecks);
      } else {
        await persistOidcChecks();
      }
    } catch (e: unknown) {
      this.log.warn(`Unable to persist OIDC session checks (${getErrorMessage(e)})`);
      res.status(500).json({ error: 'Unable to initialize OIDC session' });
      return;
    }

    res.json({
      url: authUrl,
    });
  }

  async callback(req: OidcCallbackRequest, res: Response): Promise<void> {
    const loginVerificationStartedAt = process.hrtime.bigint();
    try {
      this.log.debug('Validate callback data');
      const openidClient = await this.getOpenIdClient();
      const sessionKey = this.getSessionKey();
      await reloadSessionIfPossible(req.session);
      const callbackData = this.validateCallbackData(req, res, sessionKey);
      if (!callbackData) {
        this.recordLoginMetrics('invalid', loginVerificationStartedAt);
        return;
      }

      const tokenSet = await openidClient.authorizationCodeGrant(
        this.client,
        callbackData.callbackUrl,
        {
          pkceCodeVerifier: callbackData.oidcCheck.codeVerifier,
          expectedState: callbackData.oidcCheck.state,
        },
      );
      if (!tokenSet.access_token) {
        throw new Error('Access token is missing from OIDC authorization response');
      }

      const rememberMePreference = req.session?.rememberMe;
      await this.persistCallbackSession(
        req,
        sessionKey,
        callbackData.pendingChecks,
        callbackData.callbackState,
        rememberMePreference,
      );
      this.log.debug('Get user info');
      const user = await this.getUserFromAccessToken(tokenSet.access_token);

      await enforceConcurrentSessionLimit({
        username: user.username,
        maxConcurrentSessions: getMaxConcurrentSessionsPerUser(),
        sessionStore: req.sessionStore,
        currentSessionId: req.sessionID,
      });

      this.completePassportLogin(req, res, user, loginVerificationStartedAt);
    } catch (err: unknown) {
      this.log.warn(`Error when logging the user [${getErrorMessage(err)}]`);
      this.recordLoginMetrics('error', loginVerificationStartedAt);
      res.status(401).json({ error: 'Authentication failed' });
    }
  }

  respondAuthenticationError(res: Response, message: string): void {
    res.status(401).json({ error: message });
  }

  validateCallbackData(
    req: OidcCallbackRequest,
    res: Response,
    sessionKey: string,
  ): OidcCallbackValidationResult | undefined {
    const oidcChecks = req.session?.oidc?.[sessionKey];
    if (!oidcChecks) {
      this.log.warn(
        `OIDC checks are missing from session for strategy ${sessionKey}; ask user to restart authentication`,
      );
      this.respondAuthenticationError(
        res,
        'OIDC session is missing or expired. Please retry authentication.',
      );
      return undefined;
    }

    const callbackUrl = new URL(req.originalUrl || req.url, `${getPublicUrl(req)}/`);
    const callbackState = callbackUrl.searchParams.get('state');
    if (!isValidStateToken(callbackState)) {
      this.log.warn(`OIDC callback is missing state parameter for strategy ${sessionKey}`);
      this.respondAuthenticationError(
        res,
        'OIDC callback is missing state. Please retry authentication.',
      );
      return undefined;
    }

    const pendingChecks = normalizePendingChecks(oidcChecks);
    if (!Object.hasOwn(pendingChecks, callbackState)) {
      this.log.warn(`OIDC callback state not found in pending checks for strategy ${sessionKey}`);
      this.respondAuthenticationError(
        res,
        'OIDC session state mismatch or expired. Please retry authentication.',
      );
      return undefined;
    }

    const oidcCheck = pendingChecks[callbackState];
    if (!oidcCheck?.codeVerifier || oidcCheck.state !== callbackState) {
      this.log.warn(
        `OIDC callback state does not match active session checks for strategy ${sessionKey} (pending=${Object.keys(pendingChecks).length})`,
      );
      this.respondAuthenticationError(
        res,
        'OIDC session state mismatch or expired. Please retry authentication.',
      );
      return undefined;
    }

    return {
      callbackUrl,
      callbackState,
      pendingChecks,
      oidcCheck,
    };
  }

  buildNextOidcChecks(
    session: OidcSessionLike | undefined,
    sessionKey: string,
    pendingChecks: OidcPendingChecks,
    callbackState: string,
  ): Record<string, OidcSessionEntry> {
    const nextOidcChecks =
      session?.oidc && typeof session.oidc === 'object' ? { ...session.oidc } : {};
    if (Object.keys(nextOidcChecks).length === 0) {
      return nextOidcChecks;
    }

    const remainingChecks = createPendingChecksRecord();
    Object.entries(pendingChecks).forEach(([state, check]) => {
      if (state !== callbackState) {
        remainingChecks[state] = check;
      }
    });

    if (Object.keys(remainingChecks).length > 0) {
      nextOidcChecks[sessionKey] = {
        pending: remainingChecks,
      };
    } else if (Object.hasOwn(nextOidcChecks, sessionKey)) {
      delete nextOidcChecks[sessionKey];
    }

    return nextOidcChecks;
  }

  async persistCallbackSession(
    req: OidcCallbackRequest,
    sessionKey: string,
    pendingChecks: OidcPendingChecks,
    callbackState: string,
    rememberMePreference: boolean | undefined,
  ): Promise<void> {
    const nextOidcChecks = this.buildNextOidcChecks(
      req.session,
      sessionKey,
      pendingChecks,
      callbackState,
    );

    await regenerateSessionIfPossible(req.session);

    if (!req.session) {
      return;
    }

    if (Object.keys(nextOidcChecks).length > 0) {
      req.session.oidc = nextOidcChecks;
    } else if (req.session.oidc && Object.hasOwn(req.session.oidc, sessionKey)) {
      delete req.session.oidc[sessionKey];
    }

    if (typeof rememberMePreference === 'boolean') {
      req.session.rememberMe = rememberMePreference;
    }

    await saveSessionIfPossible(req.session);
  }

  applyRememberMePreference(session: OidcSessionLike | undefined): void {
    if (!session?.cookie) {
      return;
    }

    if (session.rememberMe) {
      session.cookie.maxAge = 3600 * 1000 * 24 * 30;
      return;
    }

    session.cookie.expires = false as unknown as Date;
    session.cookie.maxAge = null;
  }

  completePassportLogin(
    req: OidcCallbackRequest,
    res: Response,
    user: OidcAuthenticatedUser,
    loginVerificationStartedAt: bigint,
  ): void {
    this.log.debug('Perform passport login');
    req.login(user, (err) => {
      if (err) {
        this.log.warn(`Error when logging the user [${getErrorMessage(err)}]`);
        this.recordLoginMetrics('error', loginVerificationStartedAt);
        this.respondAuthenticationError(res, 'Authentication failed');
        return;
      }

      // Apply remember-me preference stored before OIDC redirect
      this.applyRememberMePreference(req.session);
      this.log.debug('User authenticated => redirect to app');
      this.recordLoginMetrics('success', loginVerificationStartedAt);
      res.redirect(getPublicUrl(req) || '/');
    });
  }

  async verify(accessToken: string, done: OidcVerifyDone): Promise<void> {
    const verifyStartedAt = process.hrtime.bigint();
    try {
      const user = await this.getUserFromAccessToken(accessToken);
      this.recordLoginMetrics('success', verifyStartedAt);
      done(null, user);
    } catch (e: unknown) {
      this.log.warn(`Error when validating the user access token (${getErrorMessage(e)})`);
      this.recordLoginMetrics('invalid', verifyStartedAt);
      done(null, false);
    }
  }

  recordLoginMetrics(outcome: 'success' | 'invalid' | 'locked' | 'error', startedAt: bigint): void {
    recordAuthLogin(outcome, 'oidc');
    observeAuthLoginDuration(outcome, 'oidc', getElapsedSeconds(startedAt));
  }

  async getUserFromAccessToken(accessToken: string): Promise<OidcAuthenticatedUser> {
    const openidClient = await this.getOpenIdClient();
    const userInfo = await openidClient.fetchUserInfo(
      this.client,
      accessToken,
      openidClient.skipSubjectCheck,
    );
    return {
      username: userInfo.email || 'unknown',
    };
  }
}

export default Oidc;
