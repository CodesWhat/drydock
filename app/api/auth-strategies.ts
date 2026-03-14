import type { Application, Request, Response } from 'express';
import passport from 'passport';
import type Authentication from '../authentications/providers/Authentication.js';
import type { StrategyDescription } from '../authentications/providers/Authentication.js';
import log from '../log/index.js';
import * as registry from '../registry/index.js';
import { getErrorMessage } from '../util/error.js';

const STRATEGY_IDS: string[] = [];

/**
 * Get all strategies id.
 * @returns {[]}
 */
export function getAllIds(): string[] {
  return [...STRATEGY_IDS];
}

export function resetStrategyIdsForTests(): void {
  STRATEGY_IDS.length = 0;
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

export function registerStrategies(app: Application): void {
  Object.values(registry.getState().authentication).forEach((authentication: Authentication) => {
    useStrategy(authentication, app);
  });
}

export function getUniqueStrategies(): StrategyDescription[] {
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
 * Includes any registration warnings so the login UI can surface them.
 * @param req
 * @param res
 */
export function getStrategies(_req: Request, res: Response): void {
  const warnings = registry.getRegistrationWarnings();
  res.json({
    strategies: getUniqueStrategies(),
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
