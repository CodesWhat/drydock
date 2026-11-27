/**
 * Built-in roles for human principals.
 *
 * A role is a named list of the same scopes API keys hold, so one permission
 * matrix serves both and the two cannot drift: a human's effective authority is
 * the scope list of their role, checked against the scope a route declared in
 * `scoped()`. API keys keep their own scopes and carry no role.
 *
 * Three roles, fixed. Anything that does not configure one resolves to
 * `admin`, which is what every human was before roles existed, so an install
 * that sets nothing behaves exactly as it did.
 *
 * Only types and pure functions live here. `route-scopes.ts` imports this
 * module, so the scope names are written out rather than imported from it.
 */

import type { ApiScope } from './route-scopes.js';

export const ROLES = ['viewer', 'operator', 'admin'] as const;

export type Role = (typeof ROLES)[number];

/** What a human holds when nothing configured a role: today's behaviour. */
export const DEFAULT_ROLE: Role = 'admin';

/**
 * The scopes each role holds. Ordered from least to most, and each role holds
 * everything the one before it does.
 */
export const ROLE_SCOPES: Readonly<Record<Role, readonly ApiScope[]>> = {
  viewer: ['read'],
  operator: [
    'read',
    'containers:watch',
    'containers:update',
    'containers:control',
    'triggers:test',
  ],
  admin: [
    'read',
    'containers:watch',
    'containers:update',
    'containers:control',
    'triggers:test',
    'admin',
    'api-keys:manage',
  ],
};

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/**
 * Parse a configured role. Blank or absent is "not configured" (undefined); any
 * other value that is not a role throws, naming the variable, because guessing
 * a role for a typo either locks someone out or hands them more than intended.
 * @param raw - the configured value
 * @param variableName - the env var it came from, for the error
 */
export function parseRole(raw: string | undefined, variableName: string): Role | undefined {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === undefined || normalized === '') {
    return undefined;
  }
  if (isRole(normalized)) {
    return normalized;
  }
  throw new Error(`${variableName} must be one of ${ROLES.join(', ')} (got "${raw}")`);
}

function rank(role: Role): number {
  return ROLES.indexOf(role);
}

/**
 * Does `role` carry at least the authority of `required`?
 * @param role
 * @param required
 */
export function roleAtLeast(role: Role, required: Role): boolean {
  return rank(role) >= rank(required);
}

/**
 * The lesser of two roles. Used where one name could belong to several
 * accounts, so the answer is the one that grants the least.
 * @param a
 * @param b
 */
export function lowerRole(a: Role, b: Role): Role {
  return rank(a) <= rank(b) ? a : b;
}

/**
 * Does this role hold the scope?
 * @param role
 * @param scope
 */
export function hasRoleScope(role: Role, scope: ApiScope): boolean {
  return ROLE_SCOPES[role].includes(scope);
}

/**
 * The least role that holds a scope: the default floor a human needs to reach
 * a route declared at it.
 * @param scope
 */
export function minRoleForScope(scope: ApiScope): Role {
  return ROLES.find((role) => hasRoleScope(role, scope)) ?? DEFAULT_ROLE;
}
