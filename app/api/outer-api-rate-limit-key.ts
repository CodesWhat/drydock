import type { Request } from 'express';
import type { ValueDeterminingMiddleware } from 'express-rate-limit';
import { verifyApiKey } from '../store/api-key.js';
import { extractApiKeyCredential } from './api-key-credential.js';
import { getAuthenticatedRouteRateLimitKey, getIpRateLimitKey } from './rate-limit-key.js';

/**
 * The bucket the pre-authentication API limiter charges.
 *
 * That limiter is the first middleware on `/api/v1`, so it runs before
 * anything has authenticated and could only key on the client address. Several
 * integrations behind one reverse proxy therefore shared a single budget — the
 * exact deployment scoped keys exist for — while the per-key limiter that
 * would have separated them sits after authentication and never got the
 * chance.
 *
 * So the address bucket is split by the key the request is presenting, and the
 * split is earned by the whole credential: the id has to be one this instance
 * issued *and* the secret has to match. Splitting on the id alone was an
 * existence oracle. The limiter emits RateLimit headers on every response,
 * including responses from routes that never authenticate — `/webhook` carries
 * its own bearer scheme and is mounted ahead of `requireAuthentication` — so a
 * caller could read a real id back off its own headers, on a path where the
 * authenticator's per-address failure budget never runs and cannot bound the
 * probing. Verifying the secret makes an unknown id, a known id with a wrong
 * secret, a revoked key and an expired one land in one bucket and look the
 * same from outside.
 *
 * `verifyApiKey` rather than a local digest compare, so this and the
 * authenticator can never drift on what "this credential is good" means. It is
 * side-effect free — no usage timestamp, no audit row — and costs one SHA-256
 * (measured at 0.58 microseconds), so the second verification the authenticator
 * does is not worth caching a record across the middleware boundary for.
 * Re-verifying there keeps the revoked and expired checks reading live store
 * state at the moment the request is admitted.
 * @param identityAwareKeyingEnabled
 */
export function createOuterApiRateLimitKeyGenerator(
  identityAwareKeyingEnabled: boolean,
): ValueDeterminingMiddleware<string> {
  return (request: Request) => {
    const base = identityAwareKeyingEnabled
      ? getAuthenticatedRouteRateLimitKey(request)
      : getIpRateLimitKey(request);
    const credential = extractApiKeyCredential(request);
    if (credential === undefined) {
      return base;
    }
    const record = verifyApiKey(credential);
    if (record === null) {
      return base;
    }
    return `${base}|apikey:${record.keyId}`;
  };
}
