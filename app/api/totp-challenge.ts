/**
 * The login challenge (spec 11.1.2, slice 3): what a correct password for a
 * subject with an active second factor gets instead of a session.
 *
 * A challenge is 32 random bytes handed to the caller once. Only its SHA-256
 * digest is held, in memory, so a heap or log leak of the table is not a usable
 * challenge, and a restart invalidates every challenge. The table is bounded:
 * entries live five minutes, die after five wrong proofs, and at most 5,000
 * exist at once. Nothing here is persisted and nothing here sees a seed, a
 * code or a recovery code: proof checking lives in totp-challenge-routes.ts.
 */

import { createHash, randomBytes } from 'node:crypto';
import type { Response } from 'express';
import { countUnusedRecoveryCodes, type TotpFactorRecord } from '../store/totp.js';
import { recordLoginAuditEvent } from './auth-audit.js';
import { getRememberMePreference } from './auth-remember-me.js';
import type { AuthRequest } from './auth-types.js';
import { sendErrorResponse } from './error-response.js';
import type { AuthenticatedPrincipal } from './principal.js';

export const LOGIN_CHALLENGE_MAX_ENTRIES = 5000;
export const LOGIN_CHALLENGE_MAX_PER_SUBJECT = 5;
export const LOGIN_CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const LOGIN_CHALLENGE_MAX_FAILED_ATTEMPTS = 5;
const CHALLENGE_ID_BYTES = 32;
const CHALLENGE_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const CHALLENGE_LOCATION_PREFIX = '/auth/login-challenges/';
const CAPACITY_RETRY_AFTER_SECONDS = 1;

export interface LoginChallenge {
  readonly subjectId: string;
  readonly providerId: string;
  readonly username: string;
  /** The subject's factor version when the password was verified. */
  readonly factorVersion: number;
  readonly remember: boolean;
  readonly expiresAt: number;
  failedAttempts: number;
}

type LoginChallengeMethod = 'totp' | 'recovery';

type BasicLoginPrincipal = AuthenticatedPrincipal & { kind: 'basic' };

const challenges = new Map<string, LoginChallenge>();

function digestOf(id: string): string {
  return createHash('sha256').update(id, 'utf8').digest('hex');
}

/** Expiry is a constant TTL, so insertion order is expiry order: stop at the first live entry. */
function sweepExpired(now: number): void {
  for (const [key, challenge] of challenges) {
    if (challenge.expiresAt > now) {
      return;
    }
    challenges.delete(key);
  }
}

/**
 * Make room for one more challenge of this subject: past the per-subject cap
 * its oldest goes. A password-verified caller can only ever displace its own
 * subject's challenges, never another subject's, and never fills the global
 * table by itself.
 */
function evictSubjectOverflow(subjectId: string): void {
  const held: string[] = [];
  for (const [key, challenge] of challenges) {
    if (challenge.subjectId === subjectId) {
      held.push(key);
    }
  }
  for (const key of held.slice(0, Math.max(0, held.length - LOGIN_CHALLENGE_MAX_PER_SUBJECT + 1))) {
    challenges.delete(key);
  }
}

/**
 * Hold a challenge and return its id, or undefined when the table is full of
 * live entries. A full table refuses new challenges rather than evicting: an
 * evicting table would let a flood of challenges push out a real user's.
 */
export function createLoginChallenge(
  input: Omit<LoginChallenge, 'expiresAt' | 'failedAttempts'>,
  now: number = Date.now(),
): { id: string; expiresAt: number } | undefined {
  sweepExpired(now);
  evictSubjectOverflow(input.subjectId);
  if (challenges.size >= LOGIN_CHALLENGE_MAX_ENTRIES) {
    return undefined;
  }
  const id = randomBytes(CHALLENGE_ID_BYTES).toString('base64url');
  const expiresAt = now + LOGIN_CHALLENGE_TTL_MS;
  challenges.set(digestOf(id), { ...input, expiresAt, failedAttempts: 0 });
  return { id, expiresAt };
}

/** The live challenge for `id`, or undefined for unknown, malformed or expired ones alike. */
export function getLoginChallenge(
  id: string,
  now: number = Date.now(),
): LoginChallenge | undefined {
  if (typeof id !== 'string' || !CHALLENGE_ID_PATTERN.test(id)) {
    return undefined;
  }
  const key = digestOf(id);
  const challenge = challenges.get(key);
  if (challenge === undefined) {
    return undefined;
  }
  if (challenge.expiresAt <= now) {
    challenges.delete(key);
    return undefined;
  }
  return challenge;
}

/** Remove a challenge. Returns whether this call was the one that removed it. */
export function deleteLoginChallenge(id: string): boolean {
  if (typeof id !== 'string' || !CHALLENGE_ID_PATTERN.test(id)) {
    return false;
  }
  return challenges.delete(digestOf(id));
}

/** Count one wrong proof; the fifth removes the challenge. */
export function recordLoginChallengeFailure(id: string, challenge: LoginChallenge): void {
  challenge.failedAttempts += 1;
  if (challenge.failedAttempts >= LOGIN_CHALLENGE_MAX_FAILED_ATTEMPTS) {
    deleteLoginChallenge(id);
  }
}

export function resetLoginChallengesForTests(): void {
  challenges.clear();
}

export function getLoginChallengeCountForTests(): number {
  return challenges.size;
}

/**
 * Answer a verified password for an enrolled subject: 202 with the challenge
 * and no session, no cookie and no principal. Recovery is offered only while
 * unused codes remain, and only here, after the password was right.
 */
export function issueLoginChallenge(
  req: AuthRequest,
  res: Response,
  principal: BasicLoginPrincipal,
  factor: TotpFactorRecord,
): void {
  const { identity } = principal;

  const created = createLoginChallenge({
    subjectId: identity.subjectId,
    providerId: identity.providerId,
    username: principal.username,
    factorVersion: factor.factorVersion,
    remember: getRememberMePreference(req),
  });
  if (created === undefined) {
    res.setHeader('Retry-After', `${CAPACITY_RETRY_AFTER_SECONDS}`);
    recordLoginAuditEvent(req, 'error', 'Too many pending login challenges', principal.username);
    sendErrorResponse(res, 429, 'Too many pending login challenges');
    return;
  }

  const methods: LoginChallengeMethod[] =
    countUnusedRecoveryCodes(factor.factorId) > 0 ? ['totp', 'recovery'] : ['totp'];
  recordLoginAuditEvent(
    req,
    'success',
    'Password verified; second factor required',
    principal.username,
  );
  res.set('Cache-Control', 'no-store');
  res.set('Location', `${CHALLENGE_LOCATION_PREFIX}${created.id}`);
  res.status(202).json({
    challenge: {
      id: created.id,
      expiresAt: new Date(created.expiresAt).toISOString(),
      methods,
    },
  });
}
