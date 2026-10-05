/**
 * Completing and cancelling a login challenge (spec 11.1.2, slice 3).
 *
 * `PUT /auth/login-challenges/:id` takes exactly `{ code, remember? }` or
 * `{ recoveryCode, remember? }`. Every way a proof can fail (unknown, expired,
 * used up or stale challenge; wrong, replayed or already-spent code) answers
 * the same `401 { error: 'Unauthorized' }`, and every failure draws on the same
 * account and IP budget password failures do. Verification is synchronous
 * end to end, so two requests cannot interleave between the check and the
 * compare-and-set that spends a counter or a recovery code: one wins.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import log from '../log/index.js';
import {
  getFactorBySubject,
  revokeSessionsIssuedBefore,
  type TotpFactorRecord,
} from '../store/totp.js';
import { getErrorMessage } from '../util/error.js';
import { recordAuditEvent } from './audit-events.js';
import {
  clearLoginLockoutsAfterSuccess,
  rejectFailedSecondFactor,
  rejectIfFactorLocked,
  rejectIfLockedOut,
} from './auth-lockout.js';
import type { AuthRequest } from './auth-types.js';
import { sendErrorResponse } from './error-response.js';
import type { AuthenticatedPrincipal } from './principal.js';
import {
  deleteLoginChallenge,
  getLoginChallenge,
  type LoginChallenge,
  recordLoginChallengeFailure,
} from './totp-challenge.js';
import { releaseRecoveryProof, verifyRecoveryProof, verifyTotpProof } from './totp-proof.js';

const MAX_PROOF_LENGTH = 64;

interface ChallengeProof {
  kind: 'totp' | 'recovery';
  value: string;
  remember: boolean | undefined;
}

type ProofResult =
  | { outcome: 'accepted'; factor: TotpFactorRecord; recoveryCodeId?: string }
  | { outcome: 'invalid' | 'stale' };

/** Resolves true when a session was minted and false when the login was refused with an error. */
type SessionEstablisher = (
  req: AuthRequest,
  res: Response,
  principal: AuthenticatedPrincipal,
  rememberMe: boolean,
  options: { revokeOtherSessions: boolean },
) => Promise<boolean>;

/** A named route segment is always a single string. */
function challengeIdOf(req: Request): string {
  return req.params.id as string;
}

/** The proof in the body, or undefined when the body is not exactly one of the two shapes. */
function parseProof(body: unknown): ChallengeProof | undefined {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return undefined;
  }
  const record = body as Record<string, unknown>;
  const keys = Object.keys(record);
  const hasCode = Object.hasOwn(record, 'code');
  const hasRecovery = Object.hasOwn(record, 'recoveryCode');
  if (hasCode === hasRecovery) {
    return undefined;
  }
  if (keys.some((key) => key !== 'code' && key !== 'recoveryCode' && key !== 'remember')) {
    return undefined;
  }
  const { remember } = record;
  if (remember !== undefined && typeof remember !== 'boolean') {
    return undefined;
  }
  const value = hasCode ? record.code : record.recoveryCode;
  if (typeof value !== 'string' || value.length > MAX_PROOF_LENGTH) {
    return undefined;
  }
  return { kind: hasCode ? 'totp' : 'recovery', value, remember: remember as boolean | undefined };
}

/** Check a proof against the subject's current factor. Throws only when the factor cannot be read or decrypted. */
function checkProof(challenge: LoginChallenge, proof: ChallengeProof): ProofResult {
  const factor = getFactorBySubject(challenge.subjectId);
  if (factor === undefined || factor.factorVersion !== challenge.factorVersion) {
    return { outcome: 'stale' };
  }
  if (proof.kind === 'totp') {
    return verifyTotpProof(factor, proof.value)
      ? { outcome: 'accepted', factor }
      : { outcome: 'invalid' };
  }
  const recoveryCodeId = verifyRecoveryProof(factor, proof.value);
  return recoveryCodeId === undefined
    ? { outcome: 'invalid' }
    : { outcome: 'accepted', factor, recoveryCodeId };
}

export function createLoginChallengeCompletion(
  establishSession: SessionEstablisher,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authRequest = req as AuthRequest;
    res.set('Cache-Control', 'no-store');

    const proof = parseProof(req.body);
    if (proof === undefined) {
      sendErrorResponse(res, 400, 'Invalid request body');
      return;
    }

    const id = challengeIdOf(req);
    const challenge = getLoginChallenge(id);
    if (rejectIfLockedOut(authRequest, res, challenge?.username)) {
      return;
    }
    if (challenge === undefined) {
      rejectFailedSecondFactor(authRequest, res, undefined);
      return;
    }

    let result: ProofResult;
    try {
      // The persisted lock comes before the proof is looked at, so a locked
      // subject learns nothing about whether the code it sent was right.
      if (rejectIfFactorLocked(authRequest, res, challenge.subjectId, challenge.username)) {
        return;
      }
      result = checkProof(challenge, proof);
    } catch (error: unknown) {
      // A store or key fault is the server's, not the caller's: it neither
      // spends the challenge nor counts toward the lockout.
      log.warn(`Unable to verify second factor (${(error as { code?: string }).code ?? 'error'})`);
      sendErrorResponse(res, 503, 'Second factor verification is unavailable');
      return;
    }

    if (result.outcome !== 'accepted') {
      if (result.outcome === 'stale') {
        deleteLoginChallenge(id);
      } else {
        recordLoginChallengeFailure(id, challenge);
      }
      // Only a wrong proof counts toward the persisted budget; a challenge
      // outlived by its factor was never a guess.
      rejectFailedSecondFactor(
        authRequest,
        res,
        challenge.username,
        result.outcome === 'invalid' ? challenge.subjectId : undefined,
      );
      return;
    }

    // Consume before anything asynchronous: the proof is spent, and nothing
    // after this point may be reachable twice.
    deleteLoginChallenge(id);
    clearLoginLockoutsAfterSuccess(authRequest, challenge.username, challenge.subjectId);
    const { factor, recoveryCodeId } = result;
    // A recovery proof is the only one that carries a spent code to hand back.
    const recovery = recoveryCodeId !== undefined;
    const issuedAt = Date.now();
    // A recovery code is the scarce proof: when the login fails for a reason
    // that is the server's (the revocation cannot be recorded, or no session can
    // be minted) the code goes back, rather than leaving the person locked out
    // by a fault that was never theirs. A TOTP counter is not handed back; the
    // next code is one period away.
    if (recovery) {
      // The revocation is recorded where the session validator reads it,
      // before any session is minted, and at the new session's own issue time
      // so that session is the one older than nothing. A fault here refuses the
      // login: minting beside sessions that were meant to die would undo it.
      try {
        revokeSessionsIssuedBefore(challenge.subjectId, challenge.username, issuedAt);
      } catch (error: unknown) {
        log.warn(`Unable to record session revocation (${getErrorMessage(error)})`);
        releaseRecoveryProof(recoveryCodeId);
        sendErrorResponse(res, 503, 'Second factor verification is unavailable');
        return;
      }
    }

    const principal: AuthenticatedPrincipal = {
      kind: 'basic',
      username: challenge.username,
      identity: {
        subjectId: challenge.subjectId,
        providerId: challenge.providerId,
        assurance: recovery ? 'recovery' : 'totp',
        factorVersion: factor.factorVersion,
        issuedAt,
      },
    };
    authRequest.principal = principal;
    establishSession(authRequest, res, principal, proof.remember ?? challenge.remember, {
      revokeOtherSessions: recovery,
    })
      .then((established) => {
        if (!established) {
          authRequest.principal = undefined;
          if (recoveryCodeId !== undefined) {
            releaseRecoveryProof(recoveryCodeId);
          }
          return;
        }
        if (recovery) {
          recordAuditEvent({
            action: 'totp-recovery-used',
            status: 'success',
            containerName: 'authentication',
            details: `subject=${challenge.subjectId}`,
          });
        }
      })
      .catch(next);
  };
}

/** Idempotent: an unknown, expired or already-used id is the same 204 as a live one. */
export function cancelLoginChallenge(req: Request, res: Response): void {
  deleteLoginChallenge(challengeIdOf(req));
  res.set('Cache-Control', 'no-store');
  res.status(204).end();
}
