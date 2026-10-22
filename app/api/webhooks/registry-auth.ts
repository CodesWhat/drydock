import { createHash, timingSafeEqual } from 'node:crypto';
import type { RegistryWebhookAuthMode } from '../../configuration/index.js';
import { verifyRegistryWebhookSignature } from './signature.js';

export interface RegistryWebhookAuthInput {
  modes: readonly RegistryWebhookAuthMode[];
  /** Static secret for path, query and bearer modes. */
  staticSecret: string;
  /** HMAC signing secret for the hmac mode. */
  hmacSecret: string;
  payload: Buffer | string;
  signature: string | undefined;
  pathSecret: string | undefined;
  querySecret: unknown;
  authorizationHeader: string | undefined;
}

export type RegistryWebhookAuthResult =
  | { status: 'ok'; mode: RegistryWebhookAuthMode }
  | { status: 'missing' | 'invalid' };

/**
 * Constant-time string comparison. Both sides are hashed first so
 * timingSafeEqual always sees equal-length buffers and the length of the
 * configured secret does not leak. An empty expected value never matches.
 */
export function staticSecretsMatch(candidate: string, expected: string): boolean {
  if (!expected) {
    return false;
  }
  const candidateHash = createHash('sha256').update(candidate, 'utf8').digest();
  const expectedHash = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(candidateHash, expectedHash);
}

function getBearerCredential(header: string | undefined): string | undefined {
  if (!header?.startsWith('Bearer ')) {
    return undefined;
  }
  return header.slice('Bearer '.length).trim() || undefined;
}

/**
 * Authenticate a registry webhook against the modes allowed for its provider.
 * Credentials for a mode the provider does not allow are ignored, so a
 * disabled mode behaves exactly as if the credential were absent.
 */
export function authenticateRegistryWebhook(
  input: RegistryWebhookAuthInput,
): RegistryWebhookAuthResult {
  let presented = false;
  const check = (mode: RegistryWebhookAuthMode, candidate: string | undefined) => {
    if (!input.modes.includes(mode) || candidate === undefined || candidate === '') {
      return false;
    }
    presented = true;
    return staticSecretsMatch(candidate, input.staticSecret);
  };

  const bearer = getBearerCredential(input.authorizationHeader);
  const querySecret = typeof input.querySecret === 'string' ? input.querySecret : undefined;

  // Evaluate every mode (no short-circuit) so timing does not reveal which
  // credential was the one presented.
  const results = [
    check('path', input.pathSecret),
    check('query', querySecret),
    check('bearer', bearer),
  ];

  if (input.modes.includes('hmac') && input.signature) {
    presented = true;
    const verification = verifyRegistryWebhookSignature({
      payload: input.payload,
      secret: input.hmacSecret,
      signature: input.signature,
    });
    results.push(verification.valid);
  }

  const matchedIndex = results.indexOf(true);
  if (matchedIndex !== -1) {
    const matchedMode = (['path', 'query', 'bearer', 'hmac'] as const)[matchedIndex];
    return { status: 'ok', mode: matchedMode };
  }
  return { status: presented ? 'invalid' : 'missing' };
}

/**
 * Path of a registry webhook request that is safe to log: the query string is
 * dropped and the `/:provider/:secret` secret segment is masked.
 */
export function redactRegistryWebhookPath(url: string | undefined): string {
  const path = (url ?? '').split('?')[0];
  return path.replace(/(\/webhooks\/registry\/[^/]+)\/[^/]+/, '$1/***');
}
