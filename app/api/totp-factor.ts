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
    log.warn(`TOTP key ring is unavailable (${(error as { code?: string }).code ?? 'error'})`);
    sendErrorResponse(res, 503, UNAVAILABLE_MESSAGE);
    return undefined;
  }
}

function storeErrorCode(error: unknown): TotpStoreErrorCode | undefined {
  return error instanceof TotpStoreError ? error.code : undefined;
}

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
    const code = storeErrorCode(error);
    if (code === 'ENROLLMENT_PENDING') {
      sendErrorResponse(res, 409, 'A two-factor enrollment is already pending');
      return;
    }
    if (code === 'VERSION_CONFLICT') {
      sendErrorResponse(res, 409, STATE_CHANGED_MESSAGE);
      return;
    }
    throw error;
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
    const failure = storeErrorCode(error);
    if (failure === 'ENROLLMENT_NOT_FOUND') {
      sendErrorResponse(res, 404, 'Enrollment not found');
      return;
    }
    if (failure === 'ENROLLMENT_EXPIRED') {
      sendErrorResponse(res, 410, 'Enrollment expired');
      return;
    }
    if (failure === 'VERSION_CONFLICT' || failure === 'BINDING_MISMATCH') {
      sendErrorResponse(res, 409, STATE_CHANGED_MESSAGE);
      return;
    }
    throw error;
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
    const failure = storeErrorCode(error);
    if (failure === 'FACTOR_NOT_FOUND') {
      sendErrorResponse(res, 404, 'No two-factor factor is active');
      return;
    }
    if (failure === 'VERSION_CONFLICT') {
      sendErrorResponse(res, 409, STATE_CHANGED_MESSAGE);
      return;
    }
    throw error;
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
    const failure = storeErrorCode(error);
    if (failure === 'GENERATION_CONFLICT' || failure === 'FACTOR_NOT_FOUND') {
      sendErrorResponse(res, 409, STATE_CHANGED_MESSAGE);
      return;
    }
    throw error;
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
