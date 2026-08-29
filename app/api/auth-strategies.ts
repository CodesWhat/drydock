import type { Application, Request, Response } from 'express';
import type Authentication from '../authentications/providers/Authentication.js';
import type { StrategyDescription } from '../authentications/providers/Authentication.js';
import log from '../log/index.js';
import * as registry from '../registry/index.js';
import { getErrorMessage } from '../util/error.js';
import {
  clearAuthenticators,
  getAuthenticators,
  registerAuthenticator,
} from './authenticator-chain.js';
import { SESSION_AUTHENTICATOR_ID, sessionAuthenticator } from './session-principal.js';

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
 * Build the chain: the session authenticator first, then every registered
 * provider in registry order.
 *
 * Session goes first because a request that already carries a valid session
 * must resolve to it before any credential is inspected — which is what
 * passport's per-strategy `if (req.isAuthenticated())` short-circuit did, once
 * per strategy, and what Phase 11.1's API-key authenticator will be registered
 * ahead of.
 */
export function registerAuthenticators(app: Application): void {
  clearAuthenticators();
  registerAuthenticator(sessionAuthenticator);
  Object.values(registry.getState().authentication).forEach((authentication: Authentication) => {
    useAuthenticator(authentication, app);
  });
}

/**
 * Whether anything can actually authenticate a caller yet.
 *
 * The session authenticator does not count: it can only restore an identity
 * some other authenticator established, so a chain holding nothing else can
 * never admit a first request. This is the readiness signal /health gates on,
 * and it answers the same question the old `getAllIds().length > 0` did.
 */
export function isAuthenticationReady(): boolean {
  return getAuthenticators().some((authenticator) => authenticator.id !== SESSION_AUTHENTICATOR_ID);
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

/**
 * Return the registered strategies from the registry.
 * Includes registration warnings so the login UI can surface them.
 * @param req
 * @param res
 */
export function getStrategies(_req: Request, res: Response): void {
  const status = getAuthStatusPayload();
  const warnings = registry.getRegistrationWarnings();
  res.json({
    strategies: status.providers,
    warnings,
  });
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
