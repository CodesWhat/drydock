import { decodeProtectedHeader, type JWTVerifyGetKey, jwtVerify } from 'jose';

const ASYMMETRIC_ALGORITHMS = [
  'RS256',
  'RS384',
  'RS512',
  'PS256',
  'PS384',
  'PS512',
  'ES256',
  'ES384',
  'ES512',
  'EdDSA',
];

const DEFAULT_CLOCK_TOLERANCE_SECONDS = 30;

type Claims = Record<string, unknown>;

export interface BearerBindingContext {
  /** Issuer from the IdP's discovery metadata. */
  issuer: string;
  /** This drydock's OIDC client id. */
  clientId: string;
  /** Extra audiences accepted in `aud`, from the bearer audiences setting. */
  audiences: string[];
  /** Key resolver for the IdP's JWKS, absent when discovery has no `jwks_uri`. */
  getKey?: JWTVerifyGetKey;
  /** RFC 7662 introspection call, absent when discovery has no `introspection_endpoint`. */
  introspect?: (token: string) => Promise<Claims>;
  clockToleranceSeconds?: number;
  nowSeconds?: () => number;
}

export interface BearerBindingResult {
  subject?: string;
}

function isJwt(token: string): boolean {
  if (token.split('.').length !== 3) {
    return false;
  }
  try {
    decodeProtectedHeader(token);
    return true;
  } catch {
    return false;
  }
}

function toStringList(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string');
  }
  return [];
}

/**
 * A token is bound to this client when its audience names the client (or a
 * configured extra audience), or the authorized party / client id claim is
 * the client. IdPs differ: Auth0 and Okta use `aud`, Keycloak uses `azp`.
 */
function assertBoundToClient(claims: Claims, context: BearerBindingContext): void {
  const accepted = new Set([context.clientId, ...context.audiences]);
  const audienceMatches = toStringList(claims.aud).some((audience) => accepted.has(audience));
  const clientMatches = claims.azp === context.clientId || claims.client_id === context.clientId;
  if (!audienceMatches && !clientMatches) {
    throw new Error('OIDC bearer token was not issued for this client');
  }
}

function subjectOf(claims: Claims): string | undefined {
  return typeof claims.sub === 'string' && claims.sub !== '' ? claims.sub : undefined;
}

async function verifyJwt(
  token: string,
  getKey: JWTVerifyGetKey,
  context: BearerBindingContext,
): Promise<BearerBindingResult> {
  const { payload } = await jwtVerify(token, getKey, {
    issuer: context.issuer,
    algorithms: ASYMMETRIC_ALGORITHMS,
    clockTolerance: context.clockToleranceSeconds ?? DEFAULT_CLOCK_TOLERANCE_SECONDS,
  });
  assertBoundToClient(payload, context);
  return { subject: subjectOf(payload) };
}

function assertIntrospectionValid(claims: Claims, context: BearerBindingContext): void {
  if (claims.active !== true) {
    throw new Error('OIDC bearer token is not active');
  }
  if (typeof claims.iss === 'string' && claims.iss !== context.issuer) {
    throw new Error('OIDC bearer token issuer does not match');
  }
  const now = (context.nowSeconds ?? (() => Math.floor(Date.now() / 1000)))();
  const tolerance = context.clockToleranceSeconds ?? DEFAULT_CLOCK_TOLERANCE_SECONDS;
  if (typeof claims.exp === 'number' && claims.exp + tolerance <= now) {
    throw new Error('OIDC bearer token is expired');
  }
  if (typeof claims.nbf === 'number' && claims.nbf - tolerance > now) {
    throw new Error('OIDC bearer token is not yet valid');
  }
  assertBoundToClient(claims, context);
}

/**
 * Prove a bearer access token was issued by the configured IdP for this
 * client before it is accepted. JWTs are verified against the IdP's JWKS;
 * opaque tokens go through RFC 7662 introspection. With neither available
 * the token is rejected rather than trusted on a userinfo call alone.
 */
export async function verifyBearerBinding(
  token: string,
  context: BearerBindingContext,
): Promise<BearerBindingResult> {
  if (context.getKey && isJwt(token)) {
    return verifyJwt(token, context.getKey, context);
  }
  if (context.introspect) {
    const claims = await context.introspect(token);
    assertIntrospectionValid(claims, context);
    return { subject: subjectOf(claims) };
  }
  throw new Error(
    'OIDC bearer token cannot be verified: the IdP advertises no usable jwks_uri or introspection_endpoint for this token, so it is rejected',
  );
}
