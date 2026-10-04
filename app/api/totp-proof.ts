/**
 * Verifying a second-factor proof against a subject's stored factor, shared by
 * the login challenge and by factor management (spec 11.1.2). Verification is
 * synchronous end to end, so two requests cannot interleave between the check
 * and the compare-and-set that spends a counter or a recovery code: one wins.
 */

import {
  advanceLastAcceptedCounter,
  listRecoveryCodes,
  markRecoveryCodeUsed,
  releaseRecoveryCodeUse,
  type TotpFactorRecord,
} from '../store/totp.js';
import {
  decryptTotpSeed,
  findRecoveryCodeMatch,
  loadTotpKeyringFromEnv,
  type TotpKeyring,
  type TotpSeedBinding,
  verifyTotp,
} from './totp-crypto.js';

/** The key ring, or a throw when none is configured. A caller turns the throw into a 503. */
export function requireTotpKeyring(): TotpKeyring {
  const keyring = loadTotpKeyringFromEnv();
  if (keyring === undefined) {
    throw new Error('TOTP key ring is not configured');
  }
  return keyring;
}

/** What a stored seed's ciphertext is bound to. */
export function seedBindingFor(
  subjectId: string,
  rowId: string,
  record: Pick<
    TotpFactorRecord,
    'schemaVersion' | 'algorithm' | 'digits' | 'periodSeconds' | 'allowedSkewSteps'
  >,
): TotpSeedBinding {
  return {
    subjectId,
    rowId,
    schemaVersion: record.schemaVersion,
    algorithm: record.algorithm,
    digits: record.digits,
    periodSeconds: record.periodSeconds,
    allowedSkewSteps: record.allowedSkewSteps,
  };
}

/** Accept a TOTP code, spending its counter. Throws when the seed cannot be read. */
export function verifyTotpProof(factor: TotpFactorRecord, code: string): boolean {
  const seed = decryptTotpSeed(
    factor,
    seedBindingFor(factor.subjectId, factor.factorId, factor),
    requireTotpKeyring(),
  );
  const result = verifyTotp({
    secret: seed,
    code,
    nowMs: Date.now(),
    lastAcceptedCounter: factor.lastAcceptedCounter,
    skewSteps: factor.allowedSkewSteps,
    digits: factor.digits,
    periodSeconds: factor.periodSeconds,
  });
  return (
    result.valid &&
    advanceLastAcceptedCounter(factor.factorId, result.counter, factor.factorVersion)
  );
}

/**
 * Accept a recovery code, spending it. Returns the spent row's id so a caller
 * whose login then fails before a session exists can hand it back with
 * {@link releaseRecoveryProof}, or undefined when the code is wrong or used.
 */
export function verifyRecoveryProof(factor: TotpFactorRecord, code: string): string | undefined {
  const match = findRecoveryCodeMatch(code, listRecoveryCodes(factor.factorId));
  return match !== undefined && markRecoveryCodeUsed(match.codeId) ? match.codeId : undefined;
}

/** Hand back a recovery code spent by a proof whose login did not complete. */
export function releaseRecoveryProof(codeId: string): void {
  releaseRecoveryCodeUse(codeId);
}
