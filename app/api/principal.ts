/**
 * The authenticated identity carried on a request.
 *
 * Replaces Passport's `req.user` truthiness check. `req.user` was an untyped
 * bag whose absence meant two different things — "nobody authenticated" and
 * "anonymous access was granted" — because passport-anonymous granted access by
 * calling `pass()` without ever setting a user. `req.principal` makes that
 * distinction explicit: anonymous access produces a principal whose `kind` says
 * so, and the two questions are asked with two different helpers.
 */

/**
 * Every identity Drydock can put on a request. `kind` is the discriminant:
 * consumers branch on it instead of probing for the presence of a field.
 *
 * `api-key` is declared here rather than in Phase 11.1 so the set of identities
 * is written down in exactly one place.
 */
export type PrincipalKind = 'session' | 'basic' | 'oidc' | 'anonymous' | 'api-key';

interface PrincipalBase {
  readonly username: string;
}

/** Identity restored from an existing express-session cookie. */
export interface SessionPrincipal extends PrincipalBase {
  readonly kind: 'session';
}

/** Identity proven by an `Authorization: Basic` header on this request. */
export interface BasicPrincipal extends PrincipalBase {
  readonly kind: 'basic';
}

/** Identity proven by an `Authorization: Bearer` OIDC access token. */
export interface OidcPrincipal extends PrincipalBase {
  readonly kind: 'oidc';
}

/**
 * Access granted without credentials because anonymous auth is configured and
 * explicitly confirmed. Carries no identity: see {@link isIdentityPrincipal}.
 */
export interface AnonymousPrincipal extends PrincipalBase {
  readonly kind: 'anonymous';
}

/** Identity proven by a scoped API key. Populated by Phase 11.1. */
export interface ApiKeyPrincipal extends PrincipalBase {
  readonly kind: 'api-key';
  readonly keyId: string;
  readonly scopes: readonly string[];
  readonly parentKeyId?: string;
}

export type AuthenticatedPrincipal =
  | SessionPrincipal
  | BasicPrincipal
  | OidcPrincipal
  | AnonymousPrincipal
  | ApiKeyPrincipal;

/**
 * Username reported for a request that authenticated anonymously. Kept as the
 * principal's `username` (rather than leaving it blank) so response bodies and
 * preference lookups read the same field for every principal kind.
 */
export const ANONYMOUS_USERNAME = 'anonymous';

/** Anything carrying a principal: an Express request, or a test double. */
export type PrincipalCarrier = {
  principal?: AuthenticatedPrincipal;
};

declare global {
  namespace Express {
    interface Request {
      principal?: AuthenticatedPrincipal;
    }
  }
}

export function getPrincipal(req: PrincipalCarrier): AuthenticatedPrincipal | undefined {
  return req.principal;
}

/**
 * Did this request authenticate at all? This is the access gate, and it is true
 * for anonymous access.
 */
export function isAuthenticated(req: PrincipalCarrier): boolean {
  return req.principal !== undefined;
}

/**
 * Does this request carry a real identity — something worth keying a rate limit
 * or an audit record on? False for anonymous, which is what Passport expressed
 * by leaving `req.user` undefined on the anonymous path.
 */
export function isIdentityPrincipal(principal: AuthenticatedPrincipal | undefined): boolean {
  return principal !== undefined && principal.kind !== 'anonymous';
}

/**
 * The identified username, or undefined when the request is unauthenticated or
 * anonymous. Returned verbatim — callers that need it trimmed trim it, because
 * the two existing consumers disagree about that and both are load-bearing.
 */
export function getIdentityUsername(req: PrincipalCarrier): string | undefined {
  const principal = req.principal;
  if (!isIdentityPrincipal(principal)) {
    return undefined;
  }
  return typeof principal.username === 'string' ? principal.username : undefined;
}
