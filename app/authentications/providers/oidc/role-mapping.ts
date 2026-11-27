import { ROLES, type Role } from '../../../api/roles.js';
import { DEFAULT_OIDC_GROUP_CLAIM, extractGroups, OidcAccessDeniedError } from './access-policy.js';

export interface OidcRoleMappingConfiguration {
  admingroup?: string;
  operatorgroup?: string;
  viewergroup?: string;
  defaultrole?: Role | 'none';
  groupclaim?: string;
}

/** What `DEFAULTROLE` may be set to: a role, or `none` to deny unmatched users. */
export const OIDC_DEFAULT_ROLE_VALUES = [...ROLES, 'none'] as const;

/** The role every OIDC user held before roles existed, and still holds with nothing mapped. */
const UNMAPPED_ROLE: Role = 'admin';
/** The role an unmatched user holds when groups are mapped and no default is set. */
const UNMATCHED_ROLE: Role = 'viewer';

type GroupKey = 'admingroup' | 'operatorgroup' | 'viewergroup';

/** Highest first: the first match wins. */
const GROUP_PRECEDENCE: readonly { role: Role; key: GroupKey }[] = [
  { role: 'admin', key: 'admingroup' },
  { role: 'operator', key: 'operatorgroup' },
  { role: 'viewer', key: 'viewergroup' },
];

/** Group names are matched exactly, like `requiredgroup`, so only trim. */
function splitGroups(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

function mappedGroupRoles(configuration: OidcRoleMappingConfiguration) {
  return GROUP_PRECEDENCE.map(({ role, key }) => ({
    role,
    groups: splitGroups(configuration[key]),
  })).filter(({ groups }) => groups.length > 0);
}

/** Any of the three group variables or `DEFAULTROLE` is set, so roles are in use. */
export function isOidcRoleMappingConfigured(configuration: OidcRoleMappingConfiguration): boolean {
  return mappedGroupRoles(configuration).length > 0 || configuration.defaultrole !== undefined;
}

function fallbackRole(configuration: OidcRoleMappingConfiguration): Role | 'none' {
  if (configuration.defaultrole !== undefined) {
    return configuration.defaultrole;
  }
  return mappedGroupRoles(configuration).length > 0 ? UNMATCHED_ROLE : UNMAPPED_ROLE;
}

/**
 * The highest role this configuration can ever grant, for the startup check
 * that someone can still be admin. Undefined when it grants no role at all.
 */
export function highestConfiguredOidcRole(
  configuration: OidcRoleMappingConfiguration,
): Role | undefined {
  const candidates: Role[] = mappedGroupRoles(configuration).map(({ role }) => role);
  const fallback = fallbackRole(configuration);
  if (fallback !== 'none') {
    candidates.push(fallback);
  }
  return GROUP_PRECEDENCE.find(({ role }) => candidates.includes(role))?.role;
}

/**
 * The role an authenticated user holds, from their group claim.
 *
 * Returns undefined when no mapping is configured, so the caller stores no role
 * and the user stays admin as before. Otherwise the highest matching role wins
 * (admin over operator over viewer), an unmatched user gets `DEFAULTROLE`, and
 * `none` denies the login. Group names match exactly, including case. Runs
 * after the access policy, which can already have denied the user.
 */
export function resolveOidcRole(
  configuration: OidcRoleMappingConfiguration,
  claims: Record<string, unknown>,
): Role | undefined {
  if (!isOidcRoleMappingConfigured(configuration)) {
    return undefined;
  }
  const claimName = (configuration.groupclaim ?? '').trim() || DEFAULT_OIDC_GROUP_CLAIM;
  const groups = extractGroups(Object.hasOwn(claims, claimName) ? claims[claimName] : undefined);
  const match = mappedGroupRoles(configuration).find((mapped) =>
    mapped.groups.some((group) => groups.includes(group)),
  );
  if (match) {
    return match.role;
  }
  const fallback = fallbackRole(configuration);
  if (fallback === 'none') {
    throw new OidcAccessDeniedError('no group maps to a role');
  }
  return fallback;
}
