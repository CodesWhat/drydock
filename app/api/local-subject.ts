import { createHash } from 'node:crypto';

/**
 * The opaque, immutable subject for one Basic provider and its exact username.
 *
 * Kept apart from `totp-identity.ts`, which re-exports it, so the role check
 * can recompute a subject without importing the factor store.
 */
export function deriveSubjectId(providerId: string, username: string): string {
  return createHash('sha256').update(`${providerId}\0${username}`, 'utf8').digest('hex');
}
