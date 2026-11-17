export interface OidcAccessPolicyConfiguration {
  allowedemails?: string;
  allowedemaildomains?: string;
  requiredgroup?: string;
  groupclaim?: string;
}

export const DEFAULT_OIDC_GROUP_CLAIM = 'groups';

/**
 * Thrown when a user authenticated at the IdP but is not allowed in by the
 * configured access policy. The message never contains claim values.
 */
export class OidcAccessDeniedError extends Error {
  constructor(public readonly reason: string) {
    super(`OIDC access denied: ${reason}`);
    this.name = 'OidcAccessDeniedError';
  }
}

function splitList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== '');
}

function extractGroups(claim: unknown): string[] {
  if (Array.isArray(claim)) {
    return claim.filter((entry): entry is string => typeof entry === 'string');
  }
  if (typeof claim === 'string') {
    return claim.split(/[\s,]+/).filter((entry) => entry !== '');
  }
  return [];
}

export function isOidcAccessPolicyConfigured(configuration: OidcAccessPolicyConfiguration) {
  return (
    splitList(configuration.allowedemails).length > 0 ||
    splitList(configuration.allowedemaildomains).length > 0 ||
    (configuration.requiredgroup ?? '').trim() !== ''
  );
}

/**
 * Enforce the sign-in allowlist and required group. Email entries and domain
 * entries are alternatives (either admits the user); the group requirement is
 * an additional condition. `email_verified` must not be false when the IdP
 * supplies it, so an unverified address cannot claim an allowlisted identity.
 */
export function enforceOidcAccessPolicy(
  configuration: OidcAccessPolicyConfiguration,
  claims: Record<string, unknown>,
): void {
  const emails = splitList(configuration.allowedemails);
  const domains = splitList(configuration.allowedemaildomains).map((domain) =>
    domain.replace(/^@/, ''),
  );

  if (emails.length > 0 || domains.length > 0) {
    const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
    if (email === '') {
      throw new OidcAccessDeniedError('email claim is missing');
    }
    const verified = claims.email_verified;
    if (verified !== undefined && verified !== true && verified !== 'true') {
      throw new OidcAccessDeniedError('email is not verified');
    }
    const at = email.lastIndexOf('@');
    const domain = at >= 0 ? email.slice(at + 1) : '';
    if (!emails.includes(email) && !(domain !== '' && domains.includes(domain))) {
      throw new OidcAccessDeniedError('email is not on the allowlist');
    }
  }

  const requiredGroup = (configuration.requiredgroup ?? '').trim();
  if (requiredGroup !== '') {
    const claimName = (configuration.groupclaim ?? '').trim() || DEFAULT_OIDC_GROUP_CLAIM;
    const groups = extractGroups(Object.hasOwn(claims, claimName) ? claims[claimName] : undefined);
    if (!groups.includes(requiredGroup)) {
      throw new OidcAccessDeniedError('required group is missing');
    }
  }
}
