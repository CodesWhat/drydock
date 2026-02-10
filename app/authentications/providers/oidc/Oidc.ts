// @ts-nocheck
import { v4 as uuid } from 'uuid';
import rateLimit from 'express-rate-limit';
import * as openidClientLibrary from 'openid-client';
import Authentication from '../Authentication.js';
import OidcStrategy from './OidcStrategy.js';
import { getPublicUrl } from '../../../configuration/index.js';

const OIDC_CHECKS_TTL_MS = 10 * 60 * 1000;
const OIDC_MAX_PENDING_CHECKS = 5;
const oidcSessionLocks = new Map<string, Promise<void>>();

function normalizePendingChecks(rawChecks) {
    const now = Date.now();
    const pendingChecks = {};

    if (rawChecks && typeof rawChecks === 'object') {
        if (rawChecks.pending && typeof rawChecks.pending === 'object') {
            Object.entries(rawChecks.pending).forEach(([state, check]: any) => {
                if (
                    typeof state === 'string' &&
                    state &&
                    check &&
                    typeof check.codeVerifier === 'string' &&
                    check.codeVerifier
                ) {
                    const createdAt =
                        typeof check.createdAt === 'number'
                            ? check.createdAt
                            : now;
                    if (now - createdAt <= OIDC_CHECKS_TTL_MS) {
                        pendingChecks[state] = {
                            codeVerifier: check.codeVerifier,
                            createdAt,
                        };
                    }
                }
            });
        }

        // Backward compatibility with previously persisted single-check shape.
        if (
            Object.keys(pendingChecks).length === 0 &&
            typeof rawChecks.state === 'string' &&
            rawChecks.state &&
            typeof rawChecks.codeVerifier === 'string' &&
            rawChecks.codeVerifier
        ) {
            pendingChecks[rawChecks.state] = {
                codeVerifier: rawChecks.codeVerifier,
                createdAt: now,
            };
        }
    }

    const mostRecentChecks = Object.entries(pendingChecks)
        .sort(([, c1]: any, [, c2]: any) => c2.createdAt - c1.createdAt)
        .slice(0, OIDC_MAX_PENDING_CHECKS);
    return Object.fromEntries(mostRecentChecks);
}

async function withOidcSessionLock(sessionId: string, operation: any) {
    const previousLock = oidcSessionLocks.get(sessionId) || Promise.resolve();
    let releaseLock: any;
    const currentLock = new Promise<void>((resolve) => {
        releaseLock = resolve;
    });
    const nextLock = previousLock
        .catch(() => undefined)
        .then(() => currentLock);
    oidcSessionLocks.set(sessionId, nextLock);
    await previousLock.catch(() => undefined);
    try {
        return await operation();
    } finally {
        releaseLock();
        if (oidcSessionLocks.get(sessionId) === nextLock) {
            oidcSessionLocks.delete(sessionId);
        }
    }
}

async function reloadSessionIfPossible(session: any) {
    if (!session || typeof session.reload !== 'function') {
        return;
    }
    await new Promise((resolve, reject) => {
        session.reload((err) => {
            if (err) {
                reject(err);
            } else {
                resolve(undefined);
            }
        });
    });
}

async function saveSessionIfPossible(session: any) {
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

/**
 * Htpasswd authentication.
 */
class Oidc extends Authentication {
    openidClient = openidClientLibrary;

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
            redirect: this.joi.boolean().default(false),
            timeout: this.joi.number().greater(500).default(5000),
        });
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
            redirect: this.configuration.redirect,
            timeout: this.configuration.timeout,
        };
    }

    async initAuthentication() {
        this.log.debug(
            `Discovering configuration from ${this.configuration.discovery}`,
        );
        const openidClient = await this.getOpenIdClient();
        const timeoutSeconds = Math.ceil(this.configuration.timeout / 1000);
        this.client = await openidClient.discovery(
            new URL(this.configuration.discovery),
            this.configuration.clientid,
            this.configuration.clientsecret,
            openidClient.ClientSecretPost(this.configuration.clientsecret),
            {
                timeout: timeoutSeconds,
            },
        );
        try {
            this.logoutUrl = openidClient.buildEndSessionUrl(this.client).href;
        } catch (e) {
            this.log.warn(` End session url is not supported (${e.message})`);
        }
    }

    /**
     * Return passport strategy.
     * @param app
     */
    getStrategy(app) {
        const oidcLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 50, standardHeaders: true, legacyHeaders: false });
        app.use(`/auth/oidc/${this.name}`, oidcLimiter);
        app.get(`/auth/oidc/${this.name}/redirect`, async (req, res) =>
            this.redirect(req, res),
        );
        app.get(`/auth/oidc/${this.name}/cb`, async (req, res) =>
            this.callback(req, res),
        );
        const strategy = new OidcStrategy(
            {
                config: this.client,
                scope: 'openid email profile',
                name: 'oidc',
            },
            async (accessToken, done) => this.verify(accessToken, done),
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

    async redirect(req, res) {
        const openidClient = await this.getOpenIdClient();
        const codeVerifier = openidClient.randomPKCECodeVerifier();
        const codeChallenge =
            await openidClient.calculatePKCECodeChallenge(codeVerifier);
        const state = uuid();
        const sessionKey = this.getSessionKey();
        const sessionLockKey =
            typeof req.sessionID === 'string' && req.sessionID !== ''
                ? req.sessionID
                : undefined;

        if (!req.session) {
            this.log.warn(
                'Unable to initialize OIDC checks because no session is available',
            );
            res.status(500).send('Unable to initialize OIDC session');
            return;
        }
        const authUrl = openidClient
            .buildAuthorizationUrl(this.client, {
                redirect_uri: `${getPublicUrl(req)}/auth/oidc/${this.name}/cb`,
                scope: 'openid email profile',
                code_challenge_method: 'S256',
                code_challenge: codeChallenge,
                state,
            })
            .href;
        this.log.debug(`Build redirection url [${authUrl}]`);

        try {
            const persistOidcChecks = async () => {
                await reloadSessionIfPossible(req.session);

                if (!req.session.oidc || typeof req.session.oidc !== 'object') {
                    req.session.oidc = {};
                }
                const pendingChecks = normalizePendingChecks(
                    req.session.oidc[sessionKey],
                );
                pendingChecks[state] = {
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
        } catch (e) {
            this.log.warn(`Unable to persist OIDC session checks (${e.message})`);
            res.status(500).send('Unable to initialize OIDC session');
            return;
        }

        res.json({
            url: authUrl,
        });
    }

    async callback(req, res) {
        try {
            this.log.debug('Validate callback data');
            const openidClient = await this.getOpenIdClient();
            const sessionKey = this.getSessionKey();
            await reloadSessionIfPossible(req.session);
            const oidcChecks =
                req.session && req.session.oidc
                    ? req.session.oidc[sessionKey]
                    : undefined;

            if (!oidcChecks) {
                this.log.warn(
                    `OIDC checks are missing from session for strategy ${sessionKey}; ask user to restart authentication`,
                );
                res.status(401).send(
                    'OIDC session is missing or expired. Please retry authentication.',
                );
                return;
            }

            const callbackUrl = new URL(
                req.originalUrl || req.url,
                `${getPublicUrl(req)}/`,
            );
            const callbackState = callbackUrl.searchParams.get('state');
            if (!callbackState) {
                this.log.warn(
                    `OIDC callback is missing state parameter for strategy ${sessionKey}`,
                );
                res.status(401).send(
                    'OIDC callback is missing state. Please retry authentication.',
                );
                return;
            }

            const pendingChecks = normalizePendingChecks(oidcChecks);
            const oidcCheck = pendingChecks[callbackState];
            if (!oidcCheck || !oidcCheck.codeVerifier) {
                this.log.warn(
                    `OIDC callback state does not match active session checks for strategy ${sessionKey} (pending=${Object.keys(pendingChecks).length})`,
                );
                res.status(401).send(
                    'OIDC session state mismatch or expired. Please retry authentication.',
                );
                return;
            }

            const tokenSet = await openidClient.authorizationCodeGrant(
                this.client,
                callbackUrl,
                {
                    pkceCodeVerifier: oidcCheck.codeVerifier,
                    expectedState: callbackState,
                },
            );
            if (!tokenSet.access_token) {
                throw new Error(
                    'Access token is missing from OIDC authorization response',
                );
            }

            if (req.session && req.session.oidc) {
                delete pendingChecks[callbackState];
                if (Object.keys(pendingChecks).length > 0) {
                    req.session.oidc[sessionKey] = {
                        pending: pendingChecks,
                    };
                } else {
                    delete req.session.oidc[sessionKey];
                }
                await saveSessionIfPossible(req.session);
            }
            this.log.debug('Get user info');
            const user = await this.getUserFromAccessToken(
                tokenSet.access_token,
            );

            this.log.debug('Perform passport login');
            req.login(user, (err) => {
                if (err) {
                    this.log.warn(
                        `Error when logging the user [${err.message}]`,
                    );
                    res.status(401).json({ error: 'Authentication failed' });
                } else {
                    this.log.debug('User authenticated => redirect to app');
                    res.redirect(getPublicUrl(req) || '/');
                }
            });
        } catch (err) {
            this.log.warn(`Error when logging the user [${err.message}]`);
            res.status(401).json({ error: 'Authentication failed' });
        }
    }

    async verify(accessToken, done) {
        try {
            const user = await this.getUserFromAccessToken(accessToken);
            done(null, user);
        } catch (e) {
            this.log.warn(
                `Error when validating the user access token (${e.message})`,
            );
            done(null, false);
        }
    }

    async getUserFromAccessToken(accessToken) {
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
