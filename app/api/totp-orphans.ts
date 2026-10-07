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

/** How often the full explanation goes to the log while the condition lasts. */
const NOTICE_INTERVAL_MS = 60 * 60 * 1000;

let lastNoticeAt: number | undefined;

export function resetOrphanedFactorNoticeForTests(): void {
  lastNoticeAt = undefined;
}

/** Refuses the request as a server fault: it is the operator's to fix, not a wrong password. */
class OrphanedFactorError extends Error {
  readonly status = 503;
  /** This module writes its own log lines, so the API's error handler repeats this one at debug only. */
  readonly alreadyLogged = true;

  constructor(count: number) {
    super(
      `Local sign-in is refused: ${count} two-factor factor(s) have no Basic provider that can sign in`,
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
 * Say why, at most once an hour. Every request of an account that is held
 * back runs into the guard (a metrics scraper on Basic auth does so every few
 * seconds), and the reason does not change between them, so the explanation is
 * an error line once and each refusal after it a debug line.
 *
 * What is registered decides what is orphaned, not what is configured: a
 * Basic provider that failed to register (a hash that is not valid argon2id,
 * say) leaves its factor with no account that can sign in, exactly like a
 * rename does. That case is named first, because its fix is the configuration
 * and removing the factor would throw away a second factor that is still wanted.
 */
function reportRefusal(error: OrphanedFactorError, orphaned: readonly TotpFactorRecord[]): void {
  log.debug(error.message);
  const now = Date.now();
  if (lastNoticeAt !== undefined && now - lastNoticeAt < NOTICE_INTERVAL_MS) {
    return;
  }
  lastNoticeAt = now;
  log.error(
    `${error.message} (${orphaned
      .map((factor) => `provider=${factor.providerId} subject=${factor.subjectId}`)
      .join(
        '; ',
      )}), so local accounts without a factor of their own are refused. Either the account was renamed or removed, or its Basic provider failed to register at startup. Look for a provider that failed to register in the startup log and fix its configuration first. Otherwise stop Drydock and move each factor with "totp rebind" or remove it with "totp remove". This is logged at most once an hour.`,
  );
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
  reportRefusal(error, orphaned);
  throw error;
}
