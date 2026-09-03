/**
 * Reading a `ddk_` credential off a request.
 *
 * Split out of the authenticator because two subsystems have to agree on what
 * "this request is presenting a key" means, and they sit on opposite sides of
 * authentication: the authenticator itself, and the pre-authentication rate
 * limiter, which has to bucket a key's traffic before anything has verified
 * it. A second implementation of the header parse in the limiter would be a
 * second answer to that question, and the two drifting apart is how a request
 * ends up in one subsystem's key bucket and another's anonymous one.
 *
 * Nothing here verifies anything. The secret is never hashed, compared or
 * logged, and no store lookup happens: these are string operations on an
 * untrusted header.
 */

import { API_KEY_PREFIX } from '../store/api-key.js';
import { getFirstHeaderValue } from './header-value.js';

/** Anything with headers: an Express request, or a rate-limiter's view of one. */
export type ApiKeyCredentialCarrier = {
  headers?: { authorization?: unknown };
};

/**
 * RFC 7235 makes the auth scheme case-insensitive, so `bearer ddk_…` is a
 * well-formed presentation of a key. Matching case-sensitively would let it
 * fall through to whatever sits behind the API key authenticator, and on an
 * install with anonymous access confirmed that fall-through grants the
 * request. The scheme is matched loosely; the `ddk_` prefix is matched exactly.
 */
const BEARER_SCHEME = 'bearer';

/**
 * Pull a `ddk_` credential out of the request, or undefined when the request
 * is not presenting one.
 * @param req
 */
export function extractApiKeyCredential(req: ApiKeyCredentialCarrier): string | undefined {
  const header = getFirstHeaderValue(req.headers?.authorization as string | string[] | undefined);
  if (typeof header !== 'string') {
    return undefined;
  }

  const separatorIndex = header.indexOf(' ');
  if (separatorIndex === -1) {
    return undefined;
  }
  if (header.slice(0, separatorIndex).toLowerCase() !== BEARER_SCHEME) {
    return undefined;
  }

  const credential = header.slice(separatorIndex + 1).trim();
  return credential.startsWith(API_KEY_PREFIX) ? credential : undefined;
}
