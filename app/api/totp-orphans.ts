/**
 * Orphaned factors (spec 11.1.2 decision 10).
 *
 * A subject is the digest of a Basic provider's id and its username, so
 * renaming either gives the account a new subject, and the factor it enrolled
 * stays behind under the old one. Left alone, the renamed account would sign
 * in as though it had never enrolled: its second factor would be dropped
 * without anyone removing it.
 *
 * So while any factor belongs to a subject that nothing registered can sign
 * in, a verified local account with no factor of its own is refused. Nothing
 * in the store says which account the orphan belonged to (both halves of the
 * subject may have changed), so every account without a factor is a candidate.
 * An account with a factor of its own is not: it is asked for that factor, as
 * always. The way out is deliberate and offline, `totp rebind` or `totp
 * remove`, never an HTTP route.
 */

import log from '../log/index.js';
import { getFactorBySubject, listFactors, type TotpFactorRecord } from '../store/totp.js';
import { getAuthenticators } from './authenticator-chain.js';

/** Refuses the request as a server fault: it is the operator's to fix, not a wrong password. */
class OrphanedFactorError extends Error {
  readonly status = 503;

  constructor(count: number) {
    super(
      `Local sign-in is refused: ${count} two-factor factor(s) belong to accounts that are no longer configured`,
    );
    this.name = 'OrphanedFactorError';
  }
}

/** Factors whose subject no registered authenticator signs in. Reads the store, so it throws when the store cannot answer. */
export function listOrphanedFactors(): TotpFactorRecord[] {
  const live = new Set(getAuthenticators().map((authenticator) => authenticator.localSubjectId));
  return listFactors().filter((factor) => !live.has(factor.subjectId));
}

/**
 * Throw unless `subjectId` may sign in on its password: it has a factor of its
 * own (and will be asked for it), or no factor is orphaned. Call it only after
 * the password was verified, so the refusal tells an outsider nothing.
 */
export function assertNotShadowedByOrphanedFactor(subjectId: string): void {
  if (getFactorBySubject(subjectId) !== undefined) {
    return;
  }
  const orphaned = listOrphanedFactors();
  if (orphaned.length === 0) {
    return;
  }
  const error = new OrphanedFactorError(orphaned.length);
  log.error(
    `${error.message} (${orphaned
      .map((factor) => `provider=${factor.providerId} subject=${factor.subjectId}`)
      .join(
        '; ',
      )}). Stop Drydock and move each one with "totp rebind" or remove it with "totp remove".`,
  );
  throw error;
}
