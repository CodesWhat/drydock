/**
 * Factor management (spec 11.1.2, slice 4), mounted at `/api/v1/auth`.
 *
 * Every route needs a browser session of a local account, same-origin CSRF and
 * its own session-keyed rate limit; every route that changes something also
 * needs HTTPS (or a genuinely local client) and the person to prove
 * themselves again in the request: their password, and, while a factor is
 * active, a current code or recovery code. The seed is generated here, held
 * encrypted under the external key ring, and shown once in the response that
 * starts the enrollment. Recovery codes are shown once in the response that
 * activates the factor or replaces the set. Nothing here logs, audits or
 * echoes any of them.
 */

import crypto from 'node:crypto';
import express, { type Request, type RequestHandler, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { getPublicUrl, getServerName } from '../configuration/index.js';
import log from '../log/index.js';
import type { AuditEntry } from '../model/audit.js';
import {
  activateEnrollment,
  countUnusedRecoveryCodes,
  createEnrollment,
  deleteEnrollment,
  getEnrollmentBySubject,
  getEnrollmentIncludingExpired,
  getFactorBySubject,
  recordEnrollmentFailure,
  removeFactor,
  replaceRecoveryCodes,
  sweepExpiredEnrollments,
  TotpStoreError,
  type TotpStoreErrorCode,
} from '../store/totp.js';
import { getErrorMessage } from '../util/error.js';
import { recordAuditEvent } from './audit-events.js';
import type { AuthRequest } from './auth-types.js';
import { requireSameOriginForMutations } from './csrf.js';
import { sendErrorResponse } from './error-response.js';
import type { AuthenticatedPrincipal } from './principal.js';
import { getAuthenticatedRouteRateLimitKey } from './rate-limit-key.js';
import { SESSION_ONLY, scoped } from './route-scopes.js';
import {
  decryptTotpSeed,
  digestRecoveryCode,
  encryptTotpSeed,
  generateRecoveryCodes,
  generateTotpSeed,
  TOTP_ALLOWED_SKEW_STEPS,
  TOTP_DIGITS,
  TOTP_PERIOD_SECONDS,
  type TotpKeyring,
  verifyTotp,
} from './totp-crypto.js';
import {
  getManagementContext,
  guarded,
  INVALID_BODY_MESSAGE,
  type ManagementContext,
  parseReauthBody,
  type Reauthenticated,
  reauthenticate,
  refundReauthentication,
  requireManagementSession,
  UNAVAILABLE_MESSAGE,
} from './totp-management.js';
import { requireTotpKeyring, seedBindingFor } from './totp-proof.js';
import { base32Encode, buildOtpauthUri } from './totp-provisioning.js';
import { replaceSessionAfterFactorChange } from './totp-session.js';

const BASE_PATH = '/api/v1/auth';
const ENROLLMENT_TTL_MS = 10 * 60 * 1000;
/** Wrong confirmation codes one pending enrollment takes; the last one deletes it, as a login challenge's does. */
const ENROLLMENT_MAX_FAILED_ATTEMPTS = 5;
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX = 60;
const ENROLLMENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TOTP_PARAMETERS = {
  schemaVersion: 1,
  algorithm: 'SHA1',
  digits: TOTP_DIGITS,
  periodSeconds: TOTP_PERIOD_SECONDS,
  allowedSkewSteps: TOTP_ALLOWED_SKEW_STEPS,
} as const;

const STATE_CHANGED_MESSAGE = 'Two-factor state changed. Try again.';

let sweepTimer: ReturnType<typeof setInterval> | undefined;

/** Hourly delete of enrollments nobody confirmed. Expired ones are also deleted when read. */
function startEnrollmentSweep(): void {
  if (sweepTimer !== undefined) {
    clearInterval(sweepTimer);
  }
  sweepTimer = setInterval(() => {
    try {
      sweepExpiredEnrollments();
    } catch (error: unknown) {
      log.warn(`Unable to sweep expired TOTP enrollments (${getErrorMessage(error)})`);
    }
  }, SWEEP_INTERVAL_MS);
  sweepTimer.unref();
}

function audit(action: AuditEntry['action'], details: string): void {
  recordAuditEvent({
    action,
    status: 'success',
    containerName: 'authentication',
    details,
  });
}

/** The key ring, or a 503 and undefined: nothing has been read or changed yet. */
function keyringOrRefuse(res: Response): TotpKeyring | undefined {
  try {
    return requireTotpKeyring();
  } catch (error: unknown) {
    log.warn(`TOTP key ring is unavailable (${String((error as { code?: unknown }).code)})`);
    sendErrorResponse(res, 503, UNAVAILABLE_MESSAGE);
    return undefined;
  }
}

interface Refusal {
  status: number;
  message: string;
}

/**
 * Answer a store failure the caller can act on with its mapped status, or
 * rethrow it. Anything unmapped is a fault, which the route guard turns into a
 * 503 with a fixed body.
 */
function refuseOnStoreFailure(
  res: Response,
  error: unknown,
  refusals: Partial<Record<TotpStoreErrorCode, Refusal>>,
): void {
  const refusal = error instanceof TotpStoreError ? refusals[error.code] : undefined;
  if (refusal === undefined) {
    throw error;
  }
  sendErrorResponse(res, refusal.status, refusal.message);
}

const STATE_CHANGED = { status: 409, message: STATE_CHANGED_MESSAGE } as const;
const NOT_ACTIVE = { status: 404, message: 'No two-factor factor is active' } as const;

function labelHost(req: Request): string {
  try {
    return new URL(getPublicUrl(req)).host;
  } catch {
    return getServerName();
  }
}

/** The principal a replaced session carries: the same subject at its new version. */
function principalAfterChange(
  context: ManagementContext,
  assurance: 'password' | 'totp',
  factorVersion: number,
): Extract<AuthenticatedPrincipal, { kind: 'basic' }> {
  return {
    kind: 'basic',
    username: context.username,
    identity: {
      subjectId: context.subjectId,
      providerId: context.providerId,
      assurance,
      factorVersion,
      issuedAt: Date.now(),
    },
  };
}

function getFactorStatus(_req: Request, res: Response): void {
  const { subjectId } = getManagementContext(res);
  const factor = getFactorBySubject(subjectId);
  const pending = getEnrollmentBySubject(subjectId);
  res.status(200).json({
    status: factor ? 'active' : 'unenrolled',
    ...(factor ? { activatedAt: factor.activatedAt } : {}),
    recoveryCodesRemaining: factor ? countUnusedRecoveryCodes(factor.factorId) : 0,
    ...(pending
      ? {
          pendingEnrollment: {
            id: pending.enrollmentId,
            expiresAt: pending.expiresAt,
            replacesFactor: pending.replacesFactorId !== null,
          },
        }
      : {}),
  });
}

async function startEnrollment(req: Request, res: Response): Promise<void> {
  const context = getManagementContext(res);
  const body = parseReauthBody(req.body);
  if (body === undefined) {
    sendErrorResponse(res, 400, INVALID_BODY_MESSAGE);
    return;
  }
  const keyring = keyringOrRefuse(res);
  if (keyring === undefined) {
    return;
  }
  const factor = getFactorBySubject(context.subjectId);
  const reauthenticated = await reauthenticate(req, res, context, body, factor);
  if (reauthenticated === undefined) {
    return;
  }

  const now = new Date();
  const enrollmentId = crypto.randomUUID();
  const seed = generateTotpSeed();
  const expiresAt = new Date(now.getTime() + ENROLLMENT_TTL_MS).toISOString();
  try {
    createEnrollment(
      {
        schemaVersion: 1,
        enrollmentId,
        subjectId: context.subjectId,
        providerId: context.providerId,
        username: context.username,
        expectedFactorVersion: context.factorVersion,
        replacesFactorId: factor?.factorId ?? null,
        ...encryptTotpSeed(
          seed,
          seedBindingFor(context.subjectId, enrollmentId, TOTP_PARAMETERS),
          keyring,
        ),
        createdAt: now.toISOString(),
        expiresAt,
      },
      now,
    );
  } catch (error: unknown) {
    refundReauthentication(reauthenticated);
    refuseOnStoreFailure(res, error, {
      ENROLLMENT_PENDING: { status: 409, message: 'A two-factor enrollment is already pending' },
      VERSION_CONFLICT: STATE_CHANGED,
    });
    return;
  }

  audit('totp-enrollment-started', `subject=${context.subjectId} enrollment=${enrollmentId}`);
  const secret = base32Encode(seed);
  res
    .status(201)
    .set('Location', `${BASE_PATH}/totp-enrollments/${enrollmentId}`)
    .json({
      id: enrollmentId,
      secret,
      otpauthUri: buildOtpauthUri({
        secret,
        username: context.username,
        host: labelHost(req),
      }),
      expiresAt,
      replacesFactor: factor !== undefined,
    });
}

/** The body of a confirmation: exactly `{ code }`. */
function parseConfirmBody(body: unknown): string | undefined {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return undefined;
  }
  const keys = Object.keys(body);
  const { code } = body as Record<string, unknown>;
  return keys.length === 1 && typeof code === 'string' && code.length <= 64 ? code : undefined;
}

async function confirmEnrollment(req: Request, res: Response): Promise<void> {
  const context = getManagementContext(res);
  const code = parseConfirmBody(req.body);
  if (code === undefined) {
    sendErrorResponse(res, 400, INVALID_BODY_MESSAGE);
    return;
  }
  const keyring = keyringOrRefuse(res);
  if (keyring === undefined) {
    return;
  }

  const enrollmentId = req.params.id as string;
  const enrollment = ENROLLMENT_ID_PATTERN.test(enrollmentId)
    ? getEnrollmentIncludingExpired(enrollmentId)
    : undefined;
  if (enrollment === undefined || enrollment.subjectId !== context.subjectId) {
    sendErrorResponse(res, 404, 'Enrollment not found');
    return;
  }
  if (enrollment.expiresAt <= new Date().toISOString()) {
    deleteEnrollment(enrollmentId);
    sendErrorResponse(res, 410, 'Enrollment expired');
    return;
  }

  const seed = decryptTotpSeed(
    enrollment,
    seedBindingFor(context.subjectId, enrollmentId, TOTP_PARAMETERS),
    keyring,
  );
  const verified = verifyTotp({ secret: seed, code, nowMs: Date.now() });
  if (!verified.valid) {
    // A confirmation is a guess at the pending seed, and the session that
    // makes it may not be the person who was shown that seed. The guesses are
    // counted on the enrollment, and everything from reading it to here is
    // synchronous, so a burst cannot get more of them than a queue would.
    recordEnrollmentFailure(enrollmentId, ENROLLMENT_MAX_FAILED_ATTEMPTS);
    sendErrorResponse(res, 422, 'Invalid code');
    return;
  }

  const factorId = crypto.randomUUID();
  const recoveryCodes = generateRecoveryCodes();
  const now = new Date();
  let activatedFactor: ReturnType<typeof activateEnrollment>['factor'];
  try {
    ({ factor: activatedFactor } = activateEnrollment({
      enrollmentId,
      acceptedCounter: verified.counter,
      factor: {
        ...TOTP_PARAMETERS,
        factorId,
        subjectId: context.subjectId,
        providerId: context.providerId,
        username: context.username,
        ...encryptTotpSeed(
          seed,
          seedBindingFor(context.subjectId, factorId, TOTP_PARAMETERS),
          keyring,
        ),
        createdAt: now.toISOString(),
        activatedAt: now.toISOString(),
      },
      recoveryCodeDigests: recoveryCodes.map(digestRecoveryCode),
      now,
    }));
  } catch (error: unknown) {
    refuseOnStoreFailure(res, error, {
      ENROLLMENT_NOT_FOUND: { status: 404, message: 'Enrollment not found' },
      ENROLLMENT_EXPIRED: { status: 410, message: 'Enrollment expired' },
      VERSION_CONFLICT: STATE_CHANGED,
      BINDING_MISMATCH: STATE_CHANGED,
    });
    return;
  }

  audit(
    enrollment.replacesFactorId === null ? 'totp-enabled' : 'totp-replaced',
    `subject=${context.subjectId} factor=${factorId}`,
  );
  // The factor is live and the codes below exist nowhere else, so a session
  // that cannot be replaced still gets its answer; the person signs in again.
  await replaceSessionAfterFactorChange(
    req as AuthRequest,
    principalAfterChange(context, 'totp', activatedFactor.factorVersion),
  );
  res.status(201).json({
    status: 'active',
    activatedAt: activatedFactor.activatedAt,
    recoveryCodesRemaining: recoveryCodes.length,
    recoveryCodes,
  });
}

function cancelEnrollment(req: Request, res: Response): void {
  const { subjectId } = getManagementContext(res);
  const enrollmentId = req.params.id as string;
  const enrollment = ENROLLMENT_ID_PATTERN.test(enrollmentId)
    ? getEnrollmentIncludingExpired(enrollmentId)
    : undefined;
  if (enrollment?.subjectId === subjectId) {
    deleteEnrollment(enrollmentId);
  }
  res.status(204).end();
}

/** The reauthenticated call every factor-bearing mutation starts with; undefined when it has answered. */
async function reauthenticateActiveFactor(
  req: Request,
  res: Response,
): Promise<
  | {
      context: ManagementContext;
      factor: NonNullable<ReturnType<typeof getFactorBySubject>>;
      reauthenticated: Reauthenticated;
    }
  | undefined
> {
  const context = getManagementContext(res);
  const body = parseReauthBody(req.body);
  if (body === undefined) {
    sendErrorResponse(res, 400, INVALID_BODY_MESSAGE);
    return undefined;
  }
  const factor = getFactorBySubject(context.subjectId);
  if (factor === undefined) {
    sendErrorResponse(res, 404, 'No two-factor factor is active');
    return undefined;
  }
  const reauthenticated = await reauthenticate(req, res, context, body, factor);
  return reauthenticated === undefined ? undefined : { context, factor, reauthenticated };
}

async function removeActiveFactor(req: Request, res: Response): Promise<void> {
  const proven = await reauthenticateActiveFactor(req, res);
  if (proven === undefined) {
    return;
  }
  const { context, factor, reauthenticated } = proven;
  let nextVersion: number;
  try {
    nextVersion = removeFactor({
      subjectId: context.subjectId,
      expectedFactorVersion: context.factorVersion,
    });
  } catch (error: unknown) {
    refundReauthentication(reauthenticated);
    refuseOnStoreFailure(res, error, {
      FACTOR_NOT_FOUND: NOT_ACTIVE,
      VERSION_CONFLICT: STATE_CHANGED,
    });
    return;
  }

  audit('totp-disabled', `subject=${context.subjectId} factor=${factor.factorId}`);
  await replaceSessionAfterFactorChange(
    req as AuthRequest,
    principalAfterChange(context, 'password', nextVersion),
  );
  res.status(204).end();
}

async function replaceRecoveryCodeSet(req: Request, res: Response): Promise<void> {
  const proven = await reauthenticateActiveFactor(req, res);
  if (proven === undefined) {
    return;
  }
  const { context, factor, reauthenticated } = proven;
  const recoveryCodes = generateRecoveryCodes();
  try {
    replaceRecoveryCodes({
      factorId: factor.factorId,
      expectedGeneration: factor.recoveryGeneration,
      recoveryCodeDigests: recoveryCodes.map(digestRecoveryCode),
    });
  } catch (error: unknown) {
    refundReauthentication(reauthenticated);
    refuseOnStoreFailure(res, error, {
      GENERATION_CONFLICT: STATE_CHANGED,
      FACTOR_NOT_FOUND: STATE_CHANGED,
    });
    return;
  }

  audit('totp-recovery-codes-replaced', `subject=${context.subjectId} factor=${factor.factorId}`);
  res.status(201).json({ recoveryCodes, recoveryCodesRemaining: recoveryCodes.length });
}

const DELETE_BODY_LIMIT = '8kb';

/**
 * The API router parses JSON for POST, PUT and PATCH only, but removing a
 * factor carries its proof in a DELETE body, so these routes read and gate it
 * themselves, with the same 415 an unparseable media type gets elsewhere.
 */
function createDeleteBodyReader(): RequestHandler {
  const parse = express.json({ limit: DELETE_BODY_LIMIT });
  return (req, res, next) => {
    if (req.method !== 'DELETE') {
      next();
      return;
    }
    if (req.is('application/json') === false) {
      sendErrorResponse(res, 415, 'Content-Type must be application/json');
      return;
    }
    parse(req, res, next);
  };
}

export function init(): express.Router {
  const router = express.Router();
  startEnrollmentSweep();

  // Post-authentication, so the budget is per session: a person cannot be
  // starved by another caller behind the same address, and one session cannot
  // spend the password-hashing budget of the whole instance.
  const limiter = rateLimit({
    windowMs: RATE_LIMIT_WINDOW_MS,
    limit: RATE_LIMIT_MAX,
    keyGenerator: (req: Request) => getAuthenticatedRouteRateLimitKey(req),
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    requestPropertyName: 'totpManagementRateLimit',
  });
  const gates = [
    limiter,
    requireSameOriginForMutations,
    createDeleteBodyReader(),
    requireManagementSession,
  ];

  router.get('/totp-factor', ...gates, scoped(SESSION_ONLY, guarded(getFactorStatus)));
  router.delete('/totp-factor', ...gates, scoped(SESSION_ONLY, guarded(removeActiveFactor)));
  router.post('/totp-enrollments', ...gates, scoped(SESSION_ONLY, guarded(startEnrollment)));
  router.put('/totp-enrollments/:id', ...gates, scoped(SESSION_ONLY, guarded(confirmEnrollment)));
  router.delete('/totp-enrollments/:id', ...gates, scoped(SESSION_ONLY, guarded(cancelEnrollment)));
  router.post(
    '/totp-recovery-code-sets',
    ...gates,
    scoped(SESSION_ONLY, guarded(replaceRecoveryCodeSet)),
  );
  return router;
}
