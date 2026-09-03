/**
 * API key management.
 *
 * Mounted at `/api/v1/api-keys` and declared `api-keys:manage`, which `admin`
 * never implies. A session reaches it because scopes constrain key holders
 * only; an ordinary `admin` key gets 403.
 *
 * Three guarantees go beyond what the tools Drydock is at parity with
 * document, and all three exist to stop a key from becoming a ladder:
 *
 *   - **Subset-only minting.** A key can only grant what it could exercise
 *     itself, so an integration key cannot widen its own blast radius by
 *     minting a broader one.
 *   - **No self-extension.** A key cannot mint a child that outlives it.
 *     There is no verb that edits an existing key, so the only way to extend
 *     a key's reach past its own expiry would be to mint a longer-lived child
 *     and switch to it, which this refuses.
 *   - **Parent-cascade revocation.** Revoking a key revokes everything it
 *     minted, transitively, which is what makes a leaked automation key
 *     recoverable in one call. A key may not revoke itself or anything in its
 *     own ancestry, because either would let a compromised key cut the branch
 *     it is being hunted from.
 *
 * There is no rotate verb. Rotation is create-new-then-revoke-old, which the
 * store already supports by letting two keys be valid at once, so a third
 * verb would only be a worse spelling of two calls.
 */

import express, { type Request, type Response } from 'express';
import nocache from 'nocache';
import {
  API_KEY_PREFIX,
  type ApiKeyCreator,
  type ApiKeyRecord,
  ApiKeyValidationError,
  createApiKey,
  findApiKeyById,
  isApiKeyExpired,
  listApiKeys,
  revokeApiKey,
} from '../store/api-key.js';
import { recordApiKeyCreatedAuditEvent, recordApiKeyRevokedAuditEvent } from './api-key-audit.js';
import type { AuthRequest } from './auth-types.js';
import { getPathParamValue } from './container/request-helpers.js';
import { requireDestructiveActionConfirmation } from './destructive-confirmation.js';
import { sendErrorResponse } from './error-response.js';
import type { PaginationLinks } from './pagination-links.js';
import type { AuthenticatedPrincipal } from './principal.js';
import { API_KEYS_MANAGE_SCOPE, API_SCOPES, hasApiKeyScope, scoped } from './route-scopes.js';
import { closeSseClientsForRevokedApiKeys } from './sse.js';

const router = express.Router();

const API_KEYS_BASE_PATH = '/api/v1/api-keys';
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
// Same contract as audit.ts: an unparseable limit falls back to the default
// rather than 400ing, and a leading `+` is not accepted because that is
// form-encoding for a space.
const SAFE_INTEGER_PATTERN = /^-?\d+$/;
const KEY_ID_PATTERN = /^[0-9a-f]{12}$/;

export const UNKNOWN_KEY_MESSAGE = 'API key not found';
export const SELF_REVOKE_MESSAGE = 'An API key cannot revoke itself';
export const ANCESTOR_REVOKE_MESSAGE =
  'An API key cannot revoke the key that minted it, or any key further up that chain';
export const SCOPE_CEILING_MESSAGE = 'An API key cannot grant scopes it does not hold itself';
export const EXPIRY_CEILING_MESSAGE = 'An API key cannot mint a key that outlives it';
export const INVALID_CURSOR_MESSAGE =
  'Invalid cursor. Use the nextCursor value from a previous response.';

type ApiKeyStatus = 'active' | 'revoked' | 'expired';

/** The projection returned by the API. `secretHash` is not in it, by shape. */
interface ApiKeyView {
  keyId: string;
  name: string;
  /** `ddk_<keyId>…`, safe to show and to log. Never the credential. */
  displayPrefix: string;
  scopes: string[];
  status: ApiKeyStatus;
  createdAt: string;
  createdBy: string;
  parentKeyId: string | null;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  revokedBy?: string;
  rateLimitMax?: number;
}

function parseOptionalInteger(rawValue: unknown): number {
  const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
  if (typeof value !== 'string' || !SAFE_INTEGER_PATTERN.test(value)) {
    return Number.NaN;
  }
  return Number.parseInt(value, 10);
}

function getKeyStatus(record: ApiKeyRecord, now: Date): ApiKeyStatus {
  if (record.revokedAt !== null) {
    return 'revoked';
  }
  return isApiKeyExpired(record, now) ? 'expired' : 'active';
}

/**
 * Project a stored record for the API.
 *
 * Written as an explicit field list rather than a spread-and-delete, so
 * `secretHash` cannot reappear in a response because somebody added a field to
 * the record and the deletion list was not updated.
 */
function toView(record: ApiKeyRecord, now: Date): ApiKeyView {
  const view: ApiKeyView = {
    keyId: record.keyId,
    name: record.name,
    displayPrefix: `${API_KEY_PREFIX}${record.keyId}…`,
    scopes: [...record.scopes],
    status: getKeyStatus(record, now),
    createdAt: record.createdAt,
    createdBy: record.createdBy,
    parentKeyId: record.parentKeyId,
    expiresAt: record.expiresAt,
    lastUsedAt: record.lastUsedAt,
    revokedAt: record.revokedAt,
  };
  if (record.revokedBy !== undefined) {
    view.revokedBy = record.revokedBy;
  }
  if (record.rateLimitMax !== undefined) {
    view.rateLimitMax = record.rateLimitMax;
  }
  return view;
}

type ApiKeyPrincipal = Extract<AuthenticatedPrincipal, { kind: 'api-key' }>;

/** The calling key, or undefined when a human session is calling. */
function getCallingKey(req: Request): ApiKeyPrincipal | undefined {
  const principal = (req as AuthRequest).principal;
  return principal?.kind === 'api-key' ? principal : undefined;
}

function getCreator(req: Request): ApiKeyCreator {
  const callingKey = getCallingKey(req);
  if (callingKey) {
    return { kind: 'api-key', keyId: callingKey.keyId };
  }
  // A key minted from a human session has no parent and never cascades. That
  // is the documented escape hatch from parent-cascade revocation.
  return { kind: 'user', username: (req as AuthRequest).principal?.username ?? 'unknown' };
}

function getRevoker(req: Request): string {
  const callingKey = getCallingKey(req);
  return callingKey
    ? `api-key:${callingKey.keyId}`
    : `user:${(req as AuthRequest).principal?.username ?? 'unknown'}`;
}

function getRequestBody(req: Request): Record<string, unknown> {
  const body = req.body;
  return body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

/**
 * Reject a scope name the registry does not define.
 *
 * The store deliberately does not validate scope names — it sits below this
 * vocabulary — so this is the only place a typo like `containers:updates` is
 * caught. Without it a key would be minted holding a scope that matches no
 * route, which fails closed but silently.
 */
function validateScopeNames(scopes: unknown): string[] {
  if (!Array.isArray(scopes)) {
    throw new ApiKeyValidationError('API key scopes must be an array');
  }
  const unknown = scopes.filter(
    (scope) => typeof scope !== 'string' || !(API_SCOPES as readonly string[]).includes(scope),
  );
  if (unknown.length > 0) {
    throw new ApiKeyValidationError(
      `Unknown API key scope(s): ${unknown.map((scope) => String(scope)).join(', ')}`,
    );
  }
  return scopes as string[];
}

/**
 * The minting ceiling, applied only when a key is the caller.
 *
 * Expressed with the same `hasApiKeyScope` the route check uses, so "can grant"
 * and "can reach" cannot drift apart. That also gives the `api-keys:manage`
 * rule for free: it is the one scope `admin` never implies, so an
 * admin-holding key cannot mint it without holding it outright.
 */
function checkScopeCeiling(callingKey: ApiKeyPrincipal, requestedScopes: string[]): string[] {
  return requestedScopes.filter((scope) => !hasApiKeyScope(callingKey.scopes, scope as never));
}

/**
 * A key may not mint a child that outlives it.
 *
 * With no verb that edits an existing key, this is the only remaining
 * self-extension route: mint a longer-lived child, switch to it, and the
 * original key's expiry stops meaning anything.
 */
function violatesExpiryCeiling(callingKey: ApiKeyPrincipal, requestedExpiresAt: unknown): boolean {
  const own = findApiKeyById(callingKey.keyId);
  if (!own || own.expiresAt === null) {
    return false;
  }
  if (typeof requestedExpiresAt !== 'string') {
    // A never-expiring child of an expiring key is the clearest extension.
    return true;
  }
  const requested = Date.parse(requestedExpiresAt);
  return Number.isNaN(requested) ? false : requested > Date.parse(own.expiresAt);
}

/**
 * The list order, and the thing a cursor is a position in.
 *
 * Newest first on `createdAt`, tie-broken on `keyId`. The tie-break is not
 * cosmetic: two keys minted in the same millisecond carry the same timestamp,
 * and a cursor over a non-unique sort key either repeats them forever or skips
 * past the whole group.
 */
function compareNewestFirst(left: ApiKeyRecord, right: ApiKeyRecord): number {
  const byCreatedAt = right.createdAt.localeCompare(left.createdAt);
  return byCreatedAt !== 0 ? byCreatedAt : right.keyId.localeCompare(left.keyId);
}

interface ListCursor {
  createdAt: string;
  keyId: string;
}

function encodeCursor(record: ApiKeyRecord): string {
  return Buffer.from(`${record.createdAt}|${record.keyId}`, 'utf8').toString('base64url');
}

/**
 * Read a cursor back, or null when it is not one this API issued.
 *
 * Strict on both halves, because base64 decoding in Node never throws and never
 * complains: characters outside the alphabet are dropped, so `<cursor>!!!`,
 * `<cursor>=` and the same bytes spelled in standard base64 all decode to the
 * payload of the cursor they were built from. Re-encoding and comparing is what
 * rejects those, and it also rejects bytes that were not valid UTF-8 to begin
 * with, since those come back through the replacement character.
 *
 * A well-formed cursor naming a position the caller was never handed is not a
 * forgery and is accepted: a cursor is a position in the sort order, not a
 * capability, and both halves are already public.
 * @param rawValue
 */
function decodeCursor(rawValue: unknown): ListCursor | null {
  if (typeof rawValue !== 'string') {
    return null;
  }
  const decoded = Buffer.from(rawValue, 'base64url').toString('utf8');
  if (Buffer.from(decoded, 'utf8').toString('base64url') !== rawValue) {
    return null;
  }
  const separatorIndex = decoded.indexOf('|');
  if (separatorIndex === -1) {
    return null;
  }
  const createdAt = decoded.slice(0, separatorIndex);
  const keyId = decoded.slice(separatorIndex + 1);
  if (!KEY_ID_PATTERN.test(keyId) || !Number.isFinite(Date.parse(createdAt))) {
    return null;
  }
  // Canonical ISO-8601 UTC, the exact spelling the store writes. `2026`,
  // `2026-09-03T00:00:00Z` and a `+02:00` offset all name real instants that
  // `Date.parse` accepts, but `sortsAfterCursor` compares timestamps as
  // strings, so any other spelling orders the walk wrong rather than merely
  // reading untidily. `Date.parse` never returns a value `toISOString` would
  // throw a RangeError on, so the finite check above makes this line total.
  if (new Date(createdAt).toISOString() !== createdAt) {
    return null;
  }
  return { createdAt, keyId };
}

function sortsAfterCursor(record: ApiKeyRecord, cursor: ListCursor): boolean {
  if (record.createdAt !== cursor.createdAt) {
    return record.createdAt < cursor.createdAt;
  }
  return record.keyId < cursor.keyId;
}

function buildCursorLinks(limit: number, cursor: unknown, nextCursor: string | undefined) {
  const toLink = (pageCursor: unknown): string => {
    const searchParams = new URLSearchParams({ limit: String(limit) });
    if (typeof pageCursor === 'string') {
      searchParams.set('cursor', pageCursor);
    }
    return `${API_KEYS_BASE_PATH}?${searchParams.toString()}`;
  };
  const links: PaginationLinks = { self: toLink(cursor) };
  if (nextCursor !== undefined) {
    links.next = toLink(nextCursor);
  }
  return links;
}

/**
 * List keys, paged on a cursor.
 *
 * Offset paging was unstable here: a key minted between two pages inserts at
 * the head of a newest-first list and shifts every unread row down one, so the
 * walk skipped whatever landed on the page boundary and could finish reporting
 * `hasMore: false` having never returned it. Minting is exactly what an
 * operator does while looking at this screen. A cursor is a position in the
 * sort order rather than a count, so a key inserted mid-walk sorts ahead of the
 * cursor and is simply not seen by that walk — nothing is dropped or repeated.
 * @param req
 * @param res
 */
function listKeys(req: Request, res: Response): void {
  const now = new Date();
  const parsedLimit = parseOptionalInteger(req.query.limit);
  const limit = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number.isFinite(parsedLimit) ? parsedLimit : DEFAULT_PAGE_SIZE),
  );

  const rawCursor = req.query.cursor;
  let cursor: ListCursor | null = null;
  if (rawCursor !== undefined) {
    cursor = decodeCursor(rawCursor);
    if (cursor === null) {
      // Starting from the top instead would loop a paging client forever.
      sendErrorResponse(res, 400, INVALID_CURSOR_MESSAGE);
      return;
    }
  }

  const all = listApiKeys().sort(compareNewestFirst);
  const remaining =
    cursor === null ? all : all.filter((record) => sortsAfterCursor(record, cursor));
  const page = remaining.slice(0, limit);
  const hasMore = remaining.length > limit;
  const nextCursor = hasMore ? encodeCursor(page[page.length - 1]) : undefined;

  res.status(200).json({
    data: page.map((record) => toView(record, now)),
    total: all.length,
    limit,
    hasMore,
    ...(nextCursor === undefined ? {} : { nextCursor }),
    _links: buildCursorLinks(limit, rawCursor, nextCursor),
  });
}

function createKey(req: Request, res: Response): void {
  const body = getRequestBody(req);
  const callingKey = getCallingKey(req);

  let scopes: string[];
  try {
    scopes = validateScopeNames(body.scopes);
  } catch (error: unknown) {
    sendErrorResponse(res, 400, (error as Error).message);
    return;
  }

  if (callingKey) {
    const exceeded = checkScopeCeiling(callingKey, scopes);
    if (exceeded.length > 0) {
      sendErrorResponse(res, 403, {
        message: SCOPE_CEILING_MESSAGE,
        details: { scopes: exceeded },
      });
      return;
    }
    if (violatesExpiryCeiling(callingKey, body.expiresAt)) {
      sendErrorResponse(res, 403, EXPIRY_CEILING_MESSAGE);
      return;
    }
  }

  let created: ReturnType<typeof createApiKey>;
  try {
    created = createApiKey({
      name: typeof body.name === 'string' ? body.name : '',
      scopes,
      createdBy: getCreator(req),
      expiresAt: typeof body.expiresAt === 'string' ? body.expiresAt : null,
      ...(body.rateLimitMax !== undefined ? { rateLimitMax: body.rateLimitMax as number } : {}),
    });
  } catch (error: unknown) {
    if (error instanceof ApiKeyValidationError) {
      sendErrorResponse(res, 400, error.message);
      return;
    }
    throw error;
  }

  recordApiKeyCreatedAuditEvent(
    created.record.keyId,
    created.record.createdBy,
    created.record.scopes,
  );

  // The only time the credential is ever returned. It is not stored and no
  // later call can reproduce it, so a client that loses it must mint another.
  res.status(201).json({
    ...toView(created.record, new Date()),
    apiKey: created.apiKey,
  });
}

/**
 * Whether `keyId` is anywhere in the calling key's own ancestry.
 *
 * The whole chain, not just the immediate parent: revocation cascades down, so
 * revoking any ancestor takes the caller with it. Checking only the parent let
 * a grandchild cut the root and take out every sibling branch on the way,
 * which is the escape the self- and parent-revoke rules exist to close.
 *
 * The walk is bounded by a visited set. A cycle cannot be built through the
 * API — a parent always predates its child — but the chain is read back off a
 * JSON file on disk, and an unbounded walk over a corrupted one would hang the
 * process instead of answering the request.
 */
function isAncestorOfCallingKey(keyId: string, callingKey: ApiKeyPrincipal): boolean {
  const visited = new Set<string>([callingKey.keyId]);
  let ancestorId = callingKey.parentKeyId ?? undefined;

  while (ancestorId !== undefined && !visited.has(ancestorId)) {
    if (ancestorId === keyId) {
      return true;
    }
    visited.add(ancestorId);
    ancestorId = findApiKeyById(ancestorId)?.parentKeyId ?? undefined;
  }

  return false;
}

function revokeKey(req: Request, res: Response): void {
  const keyId = getPathParamValue(req.params.keyId);
  const callingKey = getCallingKey(req);

  if (callingKey) {
    if (keyId === callingKey.keyId) {
      sendErrorResponse(res, 403, SELF_REVOKE_MESSAGE);
      return;
    }
    if (isAncestorOfCallingKey(keyId, callingKey)) {
      sendErrorResponse(res, 403, ANCESTOR_REVOKE_MESSAGE);
      return;
    }
  }

  const result = revokeApiKey(keyId, { revokedBy: getRevoker(req) });
  if (result === null) {
    sendErrorResponse(res, 404, UNKNOWN_KEY_MESSAGE);
    return;
  }

  recordApiKeyRevokedAuditEvent(keyId, getRevoker(req), result.revokedKeyIds);

  // An SSE stream authenticates once and then stays open, so revocation has to
  // reach the connections as well as the store. The whole cascade goes over,
  // because a child's stream is just as dead as the parent's.
  closeSseClientsForRevokedApiKeys(result.revokedKeyIds);

  res.status(200).json({
    keyId: result.keyId,
    revokedKeyIds: result.revokedKeyIds,
    // The cascade count is reported because revoking a bootstrap key kills
    // every key it minted, and an operator has to see that happen.
    cascadeCount: result.revokedKeyIds.length,
  });
}

/**
 * Init Router.
 * @returns {*}
 */
export function init() {
  router.use(nocache());
  router.get('/', scoped(API_KEYS_MANAGE_SCOPE, listKeys));
  router.post('/', scoped(API_KEYS_MANAGE_SCOPE, createKey));
  router.delete(
    '/:keyId',
    requireDestructiveActionConfirmation('api-key-revoke'),
    scoped(API_KEYS_MANAGE_SCOPE, revokeKey),
  );
  return router;
}
