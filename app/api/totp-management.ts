/**
 * What every factor-management call has to clear before its handler runs
 * (spec 11.1.2): a browser session of a local account, a transport that is
 * HTTPS or genuinely local, and, for the calls that change something, proof of
 * the person again in the request itself. API keys, Basic header auth, OIDC and
 * anonymous access never reach a handler.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import log from '../log/index.js';
import * as registry from '../registry/index.js';
import type { TotpFactorRecord } from '../store/totp.js';
import { getErrorMessage } from '../util/error.js';
import {
  rejectFailedReauthentication,
  rejectIfFactorLocked,
  rejectIfLockedOut,
} from './auth-lockout.js';
import type { AuthRequest } from './auth-types.js';
import { sendErrorResponse } from './error-response.js';
import { getPrincipal } from './principal.js';
import { enforceApiKeyScope, SESSION_ONLY } from './route-scopes.js';
import { releaseRecoveryProof, verifyRecoveryProof, verifyTotpProof } from './totp-proof.js';

export const INVALID_BODY_MESSAGE = 'Invalid request body';
export const UNAVAILABLE_MESSAGE = 'Two-factor management is unavailable';
const MAX_PASSWORD_LENGTH = 1024;
const MAX_PROOF_LENGTH = 64;

/** The signed-in local account a management call acts for. */
export interface ManagementContext {
  readonly username: string;
  readonly subjectId: string;
  readonly providerId: string;
  /** The subject's factor version the session was minted at, which the guard has just confirmed is current. */
  readonly factorVersion: number;
}

const CONTEXT_KEY = 'totpManagement';

export function getManagementContext(res: Response): ManagementContext {
  return res.locals[CONTEXT_KEY] as ManagementContext;
}

const PROXY_HEADERS = [
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-forwarded-port',
  'forwarded',
  'x-real-ip',
] as const;

function isLoopbackAddress(address: string | undefined): boolean {
  if (address === undefined) {
    return false;
  }
  const bare = address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address;
  return bare === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(bare);
}

function isLoopbackHost(hostHeader: string | undefined): boolean {
  if (hostHeader === undefined) {
    return false;
  }
  const hostname = hostHeader.startsWith('[')
    ? hostHeader.slice(1, hostHeader.indexOf(']'))
    : hostHeader.split(':')[0];
  return hostname === 'localhost' || isLoopbackAddress(hostname);
}

/**
 * HTTPS as Express sees it (so a trusted proxy's `X-Forwarded-Proto` counts),
 * or a client that is really on this machine. Loopback means the socket peer
 * is loopback, the request names a loopback host, and nothing marks it as
 * forwarded: a reverse proxy on the same machine connects from 127.0.0.1 too,
 * and must not turn the public internet into "local".
 */
function isAllowedTransport(req: Request): boolean {
  if (req.secure) {
    return true;
  }
  return (
    isLoopbackAddress(req.socket?.remoteAddress) &&
    isLoopbackHost(req.headers.host) &&
    PROXY_HEADERS.every((name) => req.headers[name] === undefined)
  );
}

/**
 * The gate in front of every management route: a session of a local account
 * (never a key, a Basic header, OIDC or anonymous access), and for anything
 * that changes state, HTTPS or loopback.
 */
export const requireManagementSession: RequestHandler = (req, res, next) => {
  const principal = getPrincipal(req);
  if (principal?.kind === 'api-key') {
    enforceApiKeyScope(req, res, SESSION_ONLY);
    return;
  }
  if (principal?.kind !== 'session') {
    sendErrorResponse(res, 403, 'Two-factor management requires a signed-in session');
    return;
  }
  const { identity } = principal;
  if (identity === undefined) {
    sendErrorResponse(
      res,
      403,
      'This session predates two-factor support. Sign out and sign in again.',
    );
    return;
  }
  if (identity.type !== 'local') {
    sendErrorResponse(res, 403, 'Two-factor authentication is only available for local accounts');
    return;
  }
  if (req.method !== 'GET' && !isAllowedTransport(req)) {
    sendErrorResponse(res, 403, {
      message: 'Two-factor management requires HTTPS',
      details: { reason: 'https-required' },
    });
    return;
  }
  res.locals[CONTEXT_KEY] = {
    username: principal.username,
    subjectId: identity.subjectId,
    providerId: identity.providerId,
    factorVersion: identity.factorVersion,
  } satisfies ManagementContext;
  res.set('Cache-Control', 'no-store');
  next();
};

/** What a call that must re-authenticate carries: the password, and a proof when a factor is active. */
export interface ReauthBody {
  password: string;
  proof?: { kind: 'totp' | 'recovery'; value: string };
}

/** The body, or undefined when it is not exactly `{ password }` plus at most one of `code` or `recoveryCode`. */
export function parseReauthBody(body: unknown): ReauthBody | undefined {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return undefined;
  }
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some((key) => !['password', 'code', 'recoveryCode'].includes(key))) {
    return undefined;
  }
  const { password } = record;
  if (
    typeof password !== 'string' ||
    password.length === 0 ||
    password.length > MAX_PASSWORD_LENGTH
  ) {
    return undefined;
  }
  const hasCode = Object.hasOwn(record, 'code');
  const hasRecovery = Object.hasOwn(record, 'recoveryCode');
  if (hasCode && hasRecovery) {
    return undefined;
  }
  if (!hasCode && !hasRecovery) {
    return { password };
  }
  const value = hasCode ? record.code : record.recoveryCode;
  if (typeof value !== 'string' || value.length > MAX_PROOF_LENGTH) {
    return undefined;
  }
  return { password, proof: { kind: hasCode ? 'totp' : 'recovery', value } };
}

interface PasswordVerifier {
  verifyPasswordForUser(username: string, password: string): Promise<boolean>;
}

/** The registered Basic provider the session's subject belongs to, if it is still configured. */
function findPasswordVerifier(providerId: string): PasswordVerifier | undefined {
  const component = registry.getState().authentication[providerId] as unknown as
    | Partial<PasswordVerifier>
    | undefined;
  return typeof component?.verifyPasswordForUser === 'function'
    ? (component as PasswordVerifier)
    : undefined;
}

/** What a successful re-authentication spent, so a caller that then fails can give it back. */
export interface Reauthenticated {
  spentRecoveryCodeId?: string;
}

/**
 * Prove the person again: their password, and, when a factor is active, a
 * current code or recovery code. Answers the request itself and resolves
 * undefined on any failure. Failures draw on the same account, IP and
 * persisted second-factor budgets login does. A code that proves the call is
 * spent like any other, so a replayed one fails.
 */
export async function reauthenticate(
  req: Request,
  res: Response,
  context: ManagementContext,
  body: ReauthBody,
  factor: TotpFactorRecord | undefined,
): Promise<Reauthenticated | undefined> {
  const authRequest = req as AuthRequest;
  if ((factor === undefined) !== (body.proof === undefined)) {
    sendErrorResponse(res, 400, INVALID_BODY_MESSAGE);
    return undefined;
  }
  if (rejectIfLockedOut(authRequest, res, context.username)) {
    return undefined;
  }
  if (factor && rejectIfFactorLocked(authRequest, res, context.subjectId, context.username)) {
    return undefined;
  }

  const verifier = findPasswordVerifier(context.providerId);
  if (verifier === undefined) {
    log.warn('Unable to re-authenticate: the sign-in provider of this session is not available');
    sendErrorResponse(res, 503, UNAVAILABLE_MESSAGE);
    return undefined;
  }
  if (!(await verifier.verifyPasswordForUser(context.username, body.password))) {
    rejectFailedReauthentication(authRequest, res, context.username);
    return undefined;
  }
  if (factor === undefined || body.proof === undefined) {
    return {};
  }

  try {
    if (body.proof.kind === 'totp') {
      if (verifyTotpProof(factor, body.proof.value)) {
        return {};
      }
    } else {
      const spent = verifyRecoveryProof(factor, body.proof.value);
      if (spent !== undefined) {
        return { spentRecoveryCodeId: spent };
      }
    }
  } catch (error: unknown) {
    log.warn(`Unable to verify the second factor (${getErrorMessage(error)})`);
    sendErrorResponse(res, 503, UNAVAILABLE_MESSAGE);
    return undefined;
  }
  rejectFailedReauthentication(authRequest, res, context.username, context.subjectId);
  return undefined;
}

/** Give back a recovery code that proved a call which then changed nothing. */
export function refundReauthentication(reauthenticated: Reauthenticated): void {
  if (reauthenticated.spentRecoveryCodeId !== undefined) {
    releaseRecoveryProof(reauthenticated.spentRecoveryCodeId);
  }
}

/** Express 5 forwards rejected promises, but a management failure is a 503 with a fixed body, never a stack. */
export function guarded(
  handler: (req: Request, res: Response) => Promise<void> | void,
): RequestHandler {
  return (req: Request, res: Response, _next: NextFunction): void => {
    Promise.resolve()
      .then(() => handler(req, res))
      .catch((error: unknown) => {
        log.warn(`Two-factor management failed (${(error as { code?: string }).code ?? 'error'})`);
        if (!res.headersSent) {
          sendErrorResponse(res, 503, UNAVAILABLE_MESSAGE);
        }
      });
  };
}
