import type { Application, Request, Response } from 'express';
import type Authentication from '../authentications/providers/Authentication.js';
import type { StrategyDescription } from '../authentications/providers/Authentication.js';
import log from '../log/index.js';
import * as registry from '../registry/index.js';
import { getErrorMessage } from '../util/error.js';
import { apiKeyAuthenticator } from './api-key-auth.js';
import {
  clearAuthenticators,
  getAuthenticators,
  registerAuthenticator,
} from './authenticator-chain.js';
import { sessionAuthenticator } from './session-principal.js';

interface AuthStatusResponse {
  providers: StrategyDescription[];
  errors: registry.AuthenticationRegistrationError[];
}

export function resetAuthenticatorsForTests(): void {
  clearAuthenticators();
}

/**
 * Add one provider's authenticator to the chain.
 *
 * A provider that refuses to produce one — anonymous access without
 * DD_ANONYMOUS_AUTH_CONFIRM is the live case — is logged and skipped, exactly
 * as a strategy that refused to build was. The chain is left shorter, which is
 * what keeps /health reporting 503 rather than opening an unguarded dashboard.
 */
function useAuthenticator(authentication: Authentication, app: Application): void {
  try {
    registerAuthenticator(authentication.getAuthenticator(app));
  } catch (error: unknown) {
    log.warn(
      `Unable to apply authentication ${authentication.getId()} (${getErrorMessage(error)})`,
    );
  }
}

/**
 * Build the chain: credential-bearing providers in registry order, then the
 * session fallback, then credentialless anonymous access.
 *
 * Header credentials can therefore win over a cookie, while an invalid header
 * still falls back to the session before anonymous access is considered.
 */
export function registerAuthenticators(app: Application): void {
  clearAuthenticators();
  // First, ahead of every provider. A request carrying both a session cookie
  // and a `ddk_` bearer therefore resolves as the key: a background
  // integration must not silently inherit a browser session's identity or its
  // permissions, and a revoked key must not keep working because a cookie
  // rode along with it.
  registerAuthenticator(apiKeyAuthenticator);
  const authentications = Object.values(registry.getState().authentication);
  const categorized = authentications.map((authentication: Authentication) => ({
    authentication,
    isAnonymous: authentication.getStrategyDescription?.().type === 'anonymous',
  }));
  categorized
    .filter(({ isAnonymous }) => !isAnonymous)
    .forEach(({ authentication }) => useAuthenticator(authentication, app));
  registerAuthenticator(sessionAuthenticator);
  categorized
    .filter(({ isAnonymous }) => isAnonymous)
    .forEach(({ authentication }) => useAuthenticator(authentication, app));
}

/**
 * Whether anything can actually authenticate a caller yet.
 *
 * Authenticators that only re-present an identity something else established
 * do not count — the session, and API keys, which cannot exist until somebody
 * authenticated to mint one. A chain holding only those can never admit a
 * first request. This is the readiness signal /health gates on, and it answers
 * the same question the old `getAllIds().length > 0` did.
 *
 * The exclusion is read off `countsTowardReadiness` rather than matched
 * against a list of ids here, so adding a third such authenticator cannot
 * accidentally report an unguarded install as ready.
 */
export function isAuthenticationReady(): boolean {
  return getAuthenticators().some((authenticator) => authenticator.countsTowardReadiness !== false);
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

function getAuthStatusPayload(): AuthStatusResponse {
  return {
    providers: getUniqueStrategies(),
    errors: registry.getAuthenticationRegistrationErrors(),
  };
}

export function getAuthStatus(_req: Request, res: Response): void {
  res.json(getAuthStatusPayload());
}

export function getLogoutRedirectUrl(): string | undefined {
  const strategyWithRedirectUrl = getUniqueStrategies().find(
    (strategy: StrategyDescription): boolean => !!strategy.logoutUrl,
  );
  if (strategyWithRedirectUrl) {
    return strategyWithRedirectUrl.logoutUrl;
  }
  return undefined;
}
