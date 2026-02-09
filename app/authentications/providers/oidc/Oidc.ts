// @ts-nocheck
import { v4 as uuid } from 'uuid';
import * as openidClientLibrary from 'openid-client';
import Authentication from '../Authentication.js';
import OidcStrategy from './OidcStrategy.js';
import { getPublicUrl } from '../../../configuration/index.js';

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

        if (!req.session) {
            this.log.warn(
                'Unable to initialize OIDC checks because no session is available',
            );
            res.status(500).send('Unable to initialize OIDC session');
            return;
        }

        if (!req.session.oidc || typeof req.session.oidc !== 'object') {
            req.session.oidc = {};
        }
        req.session.oidc[sessionKey] = {
            codeVerifier,
            state,
        };
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
            if (typeof req.session.save === 'function') {
                await new Promise((resolve, reject) => {
                    req.session.save((err) => {
                        if (err) {
                            reject(err);
                        } else {
                            resolve(undefined);
                        }
                    });
                });
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
            const oidcChecks =
                req.session && req.session.oidc
                    ? req.session.oidc[sessionKey]
                    : undefined;

            if (
                !oidcChecks ||
                !oidcChecks.codeVerifier ||
                !oidcChecks.state
            ) {
                this.log.warn(
                    'OIDC checks are missing from the session; ask user to restart authentication',
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
            const tokenSet = await openidClient.authorizationCodeGrant(
                this.client,
                callbackUrl,
                {
                    pkceCodeVerifier: oidcChecks.codeVerifier,
                    expectedState: oidcChecks.state,
                },
            );
            if (!tokenSet.access_token) {
                throw new Error(
                    'Access token is missing from OIDC authorization response',
                );
            }

            if (req.session && req.session.oidc) {
                delete req.session.oidc[sessionKey];
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
                    res.status(401).send(err.message);
                } else {
                    this.log.debug('User authenticated => redirect to app');
                    res.redirect(`${getPublicUrl(req)}`);
                }
            });
        } catch (err) {
            this.log.warn(`Error when logging the user [${err.message}]`);
            res.status(401).send(err.message);
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
