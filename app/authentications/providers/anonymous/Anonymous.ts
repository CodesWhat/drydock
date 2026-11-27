import type { Authenticator } from '../../../api/authenticator-chain.js';
import { ANONYMOUS_USERNAME, type AuthenticatedPrincipal } from '../../../api/principal.js';
import { DEFAULT_ROLE, parseRole, type Role } from '../../../api/roles.js';
import { isUpgrade } from '../../../store/app.js';
import Authentication from '../Authentication.js';

/**
 * Access granted without a credential. Carries a principal so that
 * `req.principal` is set for every request the chain admits, but its kind
 * marks it as identity-free: passport-anonymous granted access by calling
 * pass() and leaving req.user undefined, so a rate limit key or an audit
 * record must not treat it as a user. See isIdentityPrincipal().
 *
 * A fresh object per request, so nothing downstream can leak a mutation into
 * the next one.
 */
function createAnonymousPrincipal(role: Role): AuthenticatedPrincipal {
  return { kind: 'anonymous', username: ANONYMOUS_USERNAME, role };
}

export const ANONYMOUS_ROLE_ENV = 'DD_ANONYMOUS_AUTH_ROLE';

/**
 * The role anonymous callers hold. Unset is admin, which is what anonymous
 * access always granted; `viewer` makes a read-only public dashboard. An
 * invalid value throws, so registration fails and the dashboard stays closed.
 */
function readAnonymousRole(): { role: Role; explicit: boolean } {
  const role = parseRole(process.env[ANONYMOUS_ROLE_ENV], ANONYMOUS_ROLE_ENV);
  return role === undefined ? { role: DEFAULT_ROLE, explicit: false } : { role, explicit: true };
}

/**
 * Anonymous authentication.
 */
class Anonymous extends Authentication {
  private isExplicitlyConfirmed(): boolean {
    const canonical = process.env.DD_ANONYMOUS_AUTH_CONFIRM?.trim().toLowerCase();
    const alias = process.env.DD_AUTH_ANONYMOUS_CONFIRM?.trim().toLowerCase();
    return canonical === 'true' || alias === 'true';
  }

  initAuthentication(): void {
    if (this.isExplicitlyConfirmed()) {
      readAnonymousRole();
      return;
    }
    if (isUpgrade()) {
      throw new Error(
        'No authentication configured during an upgrade. Set DD_AUTH_BASIC_<name>_USER / DD_AUTH_BASIC_<name>_HASH to secure the dashboard, or set DD_ANONYMOUS_AUTH_CONFIRM=true to explicitly allow anonymous access.',
      );
    }
    throw new Error(
      'No authentication configured and this is a fresh install. Set DD_AUTH_BASIC_<name>_USER / DD_AUTH_BASIC_<name>_HASH to secure the dashboard, or set DD_ANONYMOUS_AUTH_CONFIRM=true to allow anonymous access.',
    );
  }

  /**
   * Return the authenticator this provider contributes to the chain.
   *
   * Throws unless anonymous access was explicitly confirmed, exactly as
   * getStrategy() did: registration catches it, no authenticator is added, and
   * /health keeps answering 503 instead of opening an unauthenticated
   * dashboard.
   */
  getAuthenticator(_app?: unknown): Authenticator {
    this.assertAnonymousAccessConfirmed();
    const grantedRole = readAnonymousRole();
    return {
      id: this.getId(),
      persistsSession: false,
      grantedRole,
      authenticate: () => Promise.resolve(createAnonymousPrincipal(grantedRole.role)),
    };
  }

  private assertAnonymousAccessConfirmed(): void {
    if (this.isExplicitlyConfirmed()) {
      return;
    }
    if (isUpgrade()) {
      throw new Error(
        'Anonymous authentication cannot be enabled during an upgrade without DD_ANONYMOUS_AUTH_CONFIRM=true',
      );
    }
    throw new Error(
      'Anonymous authentication cannot be enabled on a fresh install without DD_ANONYMOUS_AUTH_CONFIRM=true',
    );
  }

  getStrategyDescription() {
    return {
      type: 'anonymous',
      name: 'Anonymous',
    };
  }
}

export default Anonymous;
