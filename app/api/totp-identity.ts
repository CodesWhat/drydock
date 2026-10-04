/**
 * Stable local subject identity and the session validity check (spec 11.1.2).
 *
 * A Basic login has always been identified by its username alone, so two Basic
 * providers sharing a username were the same person. A subject is the opaque
 * digest of provider id plus the exact configured username, which keeps them
 * apart and survives anything that would change what the username means to a
 * session. Nothing here knows about TOTP codes or secrets: it only compares a
 * session's recorded subject version with the one `totp_subject_versions`
 * holds. With no rows every subject is at version 0, which is exactly what a
 * session minted before this feature carries, so nothing changes until a factor
 * is enrolled.
 */

import { createHash } from 'node:crypto';
import log from '../log/index.js';
import { getFactorBySubject, getSubjectVersion, hasEnrolledUsername } from '../store/totp.js';
import { getErrorMessage } from '../util/error.js';
import type { SessionUser } from './auth-types.js';

type LocalAssurance = 'password' | 'totp' | 'recovery';

export interface LocalIdentityFields {
  subjectId: string;
  providerId: string;
  assurance: LocalAssurance;
  factorVersion: number;
}

export type SessionIdentityCheck = 'valid' | 'stale' | 'unavailable';

/** The opaque, immutable subject for one Basic provider and its exact username. */
export function deriveSubjectId(providerId: string, username: string): string {
  return createHash('sha256').update(`${providerId}\0${username}`, 'utf8').digest('hex');
}

/**
 * The identity a verified Basic credential carries into a new session: password
 * assurance at the subject's current version. Reads the store, so it throws
 * when the store is not initialised.
 */
export function resolveLocalIdentity(providerId: string, username: string): LocalIdentityFields {
  const subjectId = deriveSubjectId(providerId, username);
  return {
    subjectId,
    providerId,
    assurance: 'password',
    factorVersion: getSubjectVersion(subjectId),
  };
}

function checkLocalIdentity(
  username: string,
  identity: Extract<NonNullable<SessionUser['identity']>, { type: 'local' }>,
): SessionIdentityCheck {
  if (identity.subjectId !== deriveSubjectId(identity.providerId, username)) {
    return 'stale';
  }

  const version = getSubjectVersion(identity.subjectId);
  if (version !== identity.factorVersion) {
    return 'stale';
  }

  // Version 0 means the subject never enrolled, so no factor row can exist.
  if (
    version > 0 &&
    identity.assurance === 'password' &&
    getFactorBySubject(identity.subjectId) !== undefined
  ) {
    return 'stale';
  }
  return 'valid';
}

/**
 * Is a parsed session user still good? `stale` means it never will be again and
 * the caller should drop it; `unavailable` means the store could not answer, so
 * the session is refused for now but kept.
 *
 * A legacy session names no subject, so it is valid only while no stored
 * subject version row for its username (or with an unknown username) is above
 * 0. That is decided from persisted rows, never from which Basic providers are
 * registered, so renaming a provider, a failed registration or the shutdown
 * window cannot revive one. The version never returns to 0, which is what stops
 * removing a factor from resurrecting old sessions.
 */
export function checkSessionIdentity(user: SessionUser): SessionIdentityCheck {
  const { identity } = user;
  if (identity?.type === 'oidc') {
    return 'valid';
  }

  try {
    if (identity?.type === 'local') {
      return checkLocalIdentity(user.username, identity);
    }

    return hasEnrolledUsername(user.username) ? 'stale' : 'valid';
  } catch (error: unknown) {
    log.warn(`Unable to check session subject version (${getErrorMessage(error)})`);
    return 'unavailable';
  }
}
