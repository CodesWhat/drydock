/**
 * Two-factor (TOTP) management service.
 *
 * Every secret that passes through here (password, seed, otpauth URI, codes,
 * recovery codes) is handed straight back to the caller. Nothing is cached,
 * logged or stored at module level.
 */

interface PendingEnrollment {
  id: string;
  expiresAt: string;
  replacesFactor: boolean;
}

interface TotpFactorStatus {
  status: 'unenrolled' | 'active';
  activatedAt?: string;
  recoveryCodesRemaining: number;
  pendingEnrollment?: PendingEnrollment;
}

/** The one and only reveal of a new seed. */
interface TotpEnrollment {
  id: string;
  secret: string;
  otpauthUri: string;
  expiresAt: string;
  replacesFactor: boolean;
}

/** The person proving themselves again: password, plus one proof while a factor is active. */
interface TotpReauth {
  password: string;
  code?: string;
  recoveryCode?: string;
}

interface RecoveryCodeSet {
  recoveryCodes: string[];
}

const BASE_PATH = '/api/v1/auth';
const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

/** A failed management call, keeping what the caller branches on. */
class TotpRequestError extends Error {
  readonly status: number;
  readonly reason: string | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor(message: string, status: number, reason?: string, retryAfterSeconds?: number) {
    super(message);
    this.name = 'TotpRequestError';
    this.status = status;
    this.reason = reason;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function unexpected(): never {
  throw new Error('Unexpected two-factor response');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseRetryAfterSeconds(response: Response): number | undefined {
  const value = response.headers?.get('Retry-After');
  return typeof value === 'string' && /^\d+$/.test(value.trim())
    ? Number.parseInt(value, 10)
    : undefined;
}

async function toRequestError(response: Response): Promise<TotpRequestError> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }
  const record = isRecord(payload) ? payload : {};
  const message =
    typeof record.error === 'string' && record.error.trim()
      ? record.error.trim()
      : `Two-factor request failed (${response.status})`;
  const details = isRecord(record.details) ? record.details : {};
  const reason = typeof details.reason === 'string' ? details.reason : undefined;
  return new TotpRequestError(message, response.status, reason, parseRetryAfterSeconds(response));
}

async function send(path: string, method?: string, body?: unknown): Promise<Response> {
  const response = await fetch(`${BASE_PATH}${path}`, {
    ...(method === undefined ? {} : { method }),
    credentials: 'include',
    ...(body === undefined ? {} : { headers: JSON_HEADERS, body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    throw await toRequestError(response);
  }
  return response;
}

function parsePendingEnrollment(value: unknown): PendingEnrollment {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.expiresAt !== 'string' ||
    typeof value.replacesFactor !== 'boolean'
  ) {
    return unexpected();
  }
  return { id: value.id, expiresAt: value.expiresAt, replacesFactor: value.replacesFactor };
}

function parseStatus(payload: unknown): TotpFactorStatus {
  if (
    !isRecord(payload) ||
    (payload.status !== 'unenrolled' && payload.status !== 'active') ||
    typeof payload.recoveryCodesRemaining !== 'number'
  ) {
    return unexpected();
  }
  const status: TotpFactorStatus = {
    status: payload.status,
    recoveryCodesRemaining: payload.recoveryCodesRemaining,
  };
  if (payload.status === 'active') {
    if (typeof payload.activatedAt !== 'string') {
      return unexpected();
    }
    status.activatedAt = payload.activatedAt;
  }
  if (payload.pendingEnrollment !== undefined) {
    status.pendingEnrollment = parsePendingEnrollment(payload.pendingEnrollment);
  }
  return status;
}

function parseEnrollment(payload: unknown): TotpEnrollment {
  if (
    !isRecord(payload) ||
    typeof payload.id !== 'string' ||
    typeof payload.secret !== 'string' ||
    typeof payload.otpauthUri !== 'string' ||
    typeof payload.expiresAt !== 'string' ||
    typeof payload.replacesFactor !== 'boolean'
  ) {
    return unexpected();
  }
  return {
    id: payload.id,
    secret: payload.secret,
    otpauthUri: payload.otpauthUri,
    expiresAt: payload.expiresAt,
    replacesFactor: payload.replacesFactor,
  };
}

function parseRecoveryCodes(payload: unknown): RecoveryCodeSet {
  const codes = isRecord(payload) ? payload.recoveryCodes : undefined;
  if (
    !Array.isArray(codes) ||
    codes.length === 0 ||
    !codes.every((code) => typeof code === 'string')
  ) {
    return unexpected();
  }
  return { recoveryCodes: codes };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

/** Read the account's two-factor status. */
async function getTotpFactor(): Promise<TotpFactorStatus> {
  return parseStatus(await readJson(await send('/totp-factor')));
}

/** Start an enrollment (or a replacement). The seed in the answer is shown once. */
async function startTotpEnrollment(reauth: TotpReauth): Promise<TotpEnrollment> {
  return parseEnrollment(await readJson(await send('/totp-enrollments', 'POST', reauth)));
}

/** Confirm a pending enrollment. The recovery codes in the answer are shown once. */
async function confirmTotpEnrollment(id: string, code: string): Promise<RecoveryCodeSet> {
  const response = await send(`/totp-enrollments/${encodeURIComponent(id)}`, 'PUT', { code });
  return parseRecoveryCodes(await readJson(response));
}

/** Cancel a pending enrollment. Idempotent on the server. */
async function cancelTotpEnrollment(id: string): Promise<void> {
  await send(`/totp-enrollments/${encodeURIComponent(id)}`, 'DELETE');
}

/** Replace the recovery codes. The new set is shown once. */
async function replaceTotpRecoveryCodes(reauth: TotpReauth): Promise<RecoveryCodeSet> {
  return parseRecoveryCodes(await readJson(await send('/totp-recovery-code-sets', 'POST', reauth)));
}

/** Remove the factor. A DELETE that carries a JSON body, as the API specifies. */
async function removeTotpFactor(reauth: TotpReauth): Promise<void> {
  await send('/totp-factor', 'DELETE', reauth);
}

export type { PendingEnrollment, RecoveryCodeSet, TotpEnrollment, TotpFactorStatus, TotpReauth };
export {
  cancelTotpEnrollment,
  confirmTotpEnrollment,
  getTotpFactor,
  removeTotpFactor,
  replaceTotpRecoveryCodes,
  startTotpEnrollment,
  TotpRequestError,
};
