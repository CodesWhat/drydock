/**
 * Parsing of the `Authorization: Basic` request header.
 *
 * Replaces passport-http's BasicStrategy, and reproduces its parse exactly —
 * including two quirks — so no request changes meaning across the Passport
 * removal:
 *
 *  - the token-count check runs before the scheme check, so a one-token header
 *    such as `Authorization: Bearer` is a 400 even though it is not Basic at
 *    all;
 *  - the decoded credential is split on every colon and only the first two
 *    fields are read, so a password containing a colon is truncated at it.
 *    That means such a password does not authenticate today, and still does
 *    not. Fixing it is a deliberate change to make on its own, not a side
 *    effect of this refactor.
 */

const BASIC_SCHEME_PATTERN = /Basic/i;
const MALFORMED_AUTHORIZATION_STATUS = 400;
const CREDENTIAL_FIELD_COUNT = 2;

export interface BasicCredentials {
  readonly userid: string;
  readonly password: string;
}

export type BasicAuthorization =
  /** No Basic credential was presented. Nothing to do; let the chain continue. */
  | { readonly outcome: 'absent' }
  /** A Basic credential was presented but the header is syntactically broken. */
  | { readonly outcome: 'malformed' }
  | ({ readonly outcome: 'credentials' } & BasicCredentials);

const ABSENT: BasicAuthorization = { outcome: 'absent' };
const MALFORMED: BasicAuthorization = { outcome: 'malformed' };

export function parseBasicAuthorization(header: unknown): BasicAuthorization {
  if (typeof header !== 'string' || header === '') {
    return ABSENT;
  }

  const parts = header.split(' ');
  if (parts.length < CREDENTIAL_FIELD_COUNT) {
    return MALFORMED;
  }

  if (!BASIC_SCHEME_PATTERN.test(parts[0])) {
    return ABSENT;
  }

  const credentials = Buffer.from(parts[1], 'base64').toString().split(':');
  if (credentials.length < CREDENTIAL_FIELD_COUNT) {
    return MALFORMED;
  }

  const [userid, password] = credentials;
  if (!userid || !password) {
    return ABSENT;
  }

  return { outcome: 'credentials', userid, password };
}

/**
 * The status the authenticator chain should reject with when nothing
 * authenticated. Only a syntactically broken Basic header names one; anything
 * else leaves the chain on its 401 default.
 */
export function getBasicAuthorizationFailureStatus(header: unknown): number | undefined {
  return parseBasicAuthorization(header).outcome === 'malformed'
    ? MALFORMED_AUTHORIZATION_STATUS
    : undefined;
}
