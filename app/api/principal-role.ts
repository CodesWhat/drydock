/**
 * Which role a human principal holds on this request.
 *
 * Resolved per request from the live authenticator chain rather than stored in
 * the session, so a role change plus restart applies to existing sessions
 * immediately and a session can never outlive a demotion. The session payload
 * is unchanged: it never carried a role and still does not.
 */

import type { Authenticator } from './authenticator-chain.js';
import { getAuthenticators } from './authenticator-registry.js';
import { deriveSubjectId } from './local-subject.js';
import type { AuthenticatedPrincipal } from './principal.js';
import { DEFAULT_ROLE, lowerRole, type Role } from './roles.js';

/** Any authenticator configured a role explicitly, so roles are in use. */
function isRoleConfigurationActive(authenticators: readonly Authenticator[]): boolean {
  return authenticators.some((authenticator) => authenticator.grantedRole?.explicit === true);
}

/**
 * The role for a local subject no registered authenticator names any more: a
 * session that outlived its account. Without configured roles that is today's
 * behaviour, admin. Once roles are in use it is the least role, so a removed or
 * renamed account cannot keep admin through an old cookie.
 */
function unknownSubjectRole(authenticators: readonly Authenticator[]): Role {
  return isRoleConfigurationActive(authenticators) ? 'viewer' : DEFAULT_ROLE;
}

/**
 * An OIDC provider derives roles from group claims, so a session of its that
 * carries no role predates the mapping and must sign in again.
 *
 * With `providerId`, the answer is that provider's own mapping, so a provider
 * that maps nothing keeps its sessions while another one maps groups. A
 * provider that is no longer registered, or no `providerId` at all (a session
 * minted before the provider was recorded), falls back to whether any
 * provider maps roles.
 * @param providerId - the authenticator that minted the session, when known
 */
export function isOidcRoleMappingActive(providerId?: string): boolean {
  const authenticators = getAuthenticators();
  const provider =
    providerId === undefined
      ? undefined
      : authenticators.find((authenticator) => authenticator.id === providerId);
  if (provider !== undefined) {
    return provider.mapsRolesFromClaims === true;
  }
  return authenticators.some((authenticator) => authenticator.mapsRolesFromClaims === true);
}

function roleOf(authenticator: Authenticator): Role {
  return authenticator.grantedRole?.role ?? DEFAULT_ROLE;
}

function localSubjectRole(subjectId: string | undefined): Role {
  const authenticators = getAuthenticators();
  const owner = authenticators.find(
    (authenticator) =>
      authenticator.localSubjectId !== undefined && authenticator.localSubjectId === subjectId,
  );
  return owner ? roleOf(owner) : unknownSubjectRole(authenticators);
}

/**
 * A legacy `{ username }` session never recorded which provider signed it in.
 * Its subject is recomputed against every local authenticator; when the name
 * matches more than one account, the least of their roles applies.
 */
function legacySessionRole(username: string): Role {
  const authenticators = getAuthenticators();
  const matches = authenticators.filter(
    (authenticator) =>
      authenticator.localSubjectId !== undefined &&
      authenticator.localSubjectId === deriveSubjectId(authenticator.id, username),
  );
  if (matches.length === 0) {
    return unknownSubjectRole(authenticators);
  }
  return matches.map(roleOf).reduce(lowerRole);
}

/** A principal that is a person: everything except an API key. */
export type HumanPrincipal = Exclude<AuthenticatedPrincipal, { kind: 'api-key' }>;

/**
 * The role a principal holds, or undefined for an API key, whose scopes are
 * its authority.
 * @param principal
 */
export function resolvePrincipalRole(principal: AuthenticatedPrincipal): Role | undefined {
  return principal.kind === 'api-key' ? undefined : resolveHumanRole(principal);
}

/**
 * The role a person holds on this request.
 *
 * An explicit `role` on the principal wins (anonymous access sets it). OIDC
 * principals carry the role their group claims mapped to, and are admin when
 * no mapping is configured; every Basic and local session principal resolves
 * through the account that signed it in.
 * @param principal
 */
export function resolveHumanRole(principal: HumanPrincipal): Role {
  if (principal.role !== undefined) {
    return principal.role;
  }
  switch (principal.kind) {
    case 'basic':
      return localSubjectRole(principal.identity?.subjectId);
    case 'session':
      if (principal.identity === undefined) {
        return legacySessionRole(principal.username);
      }
      if (principal.identity.type === 'local') {
        return localSubjectRole(principal.identity.subjectId);
      }
      return principal.identity.role ?? DEFAULT_ROLE;
    default:
      return DEFAULT_ROLE;
  }
}
