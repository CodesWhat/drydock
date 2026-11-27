/**
 * Where the authenticator chain is kept.
 *
 * Split from `authenticator-chain.ts` so the role check in `route-scopes.ts`,
 * which every router imports, can read the chain without pulling in the
 * session store and everything behind it. `authenticator-chain.ts` re-exports
 * all of this, so callers keep importing from there.
 */

import type { Authenticator } from './authenticator-chain.js';

const chain: Authenticator[] = [];

export function registerAuthenticator(authenticator: Authenticator): void {
  chain.push(authenticator);
}

export function getAuthenticators(): readonly Authenticator[] {
  return [...chain];
}

/** Whether a registered authenticator reads `Authorization: Basic` headers. */
export function isBasicHeaderAuthenticationRegistered(): boolean {
  return chain.some((authenticator) => authenticator.readsBasicHeader === true);
}

/**
 * Empty the chain. Called at the start of every registration pass so that
 * building the chain twice — which only happens in tests, but used to leave
 * passport's id list holding duplicates — yields the same chain both times.
 */
export function clearAuthenticators(): void {
  chain.length = 0;
}
