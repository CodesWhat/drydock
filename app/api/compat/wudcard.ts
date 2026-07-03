import type { NextFunction, Request, Response } from 'express';
import express from 'express';

/**
 * Compatibility shim for the Home Assistant "wud-card" integration
 * (https://github.com/angryvoegi/wud-card), which speaks the upstream WUD
 * response shape (bare arrays) rather than drydock's { data, total, ... }
 * collection envelope.
 *
 * Gated by DD_COMPAT_WUDCARD (see getWudCardCompatEnabled(), default OFF).
 * Structurally independent of the deprecated unversioned /api alias so
 * that alias can be removed later without touching this module.
 *
 * For the narrow whitelist of endpoints the card actually calls, this
 * middleware patches res.json once to unwrap drydock's list envelope into
 * a bare array, then calls next() so the request is handled by the exact
 * same route handlers the /api alias uses today (identical auth, rate
 * limiting, and behavior — no security bypass). Every other request calls
 * next() immediately and is left completely untouched.
 */

interface CollectionEnvelope {
  data: unknown[];
  total: number;
  limit?: number;
  offset?: number;
  hasMore?: boolean;
  _links?: unknown;
}

const ENVELOPE_ALLOWED_KEYS = new Set(['data', 'total', 'limit', 'offset', 'hasMore', '_links']);

/**
 * True when body is drydock's collection envelope shape: a `data` array, a
 * numeric `total`, and no keys other than the known envelope fields. Error
 * bodies ({ error: ... }) and any other shape fail this check and pass
 * through res.json unshaped.
 */
function isCollectionEnvelope(body: unknown): body is CollectionEnvelope {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return false;
  }
  const candidate = body as Record<string, unknown>;
  if (!Array.isArray(candidate.data) || typeof candidate.total !== 'number') {
    return false;
  }
  return Object.keys(candidate).every((key) => ENVELOPE_ALLOWED_KEYS.has(key));
}

/**
 * Patch res.json (once per request) so that a drydock collection envelope
 * is re-serialized as the bare `data` array, matching upstream WUD's
 * response shape. Anything else passed to res.json (error bodies, already
 * bare arrays, {} success bodies, etc.) is forwarded unmodified.
 */
function unwrapEnvelopeOnResponse(res: Response): void {
  const originalJson = res.json.bind(res);
  res.json = ((body: unknown) => {
    if (isCollectionEnvelope(body)) {
      return originalJson(body.data);
    }
    return originalJson(body);
  }) as Response['json'];
}

const CONTAINERS_PATH = '/containers';
const CONTAINERS_WATCH_PATH = '/containers/watch';
const CONTAINERS_TRIGGERS_PATTERN = /^\/containers\/[^/]+\/triggers$/;
const CONTAINER_TRIGGER_RUN_PATTERN = /^\/containers\/[^/]+\/triggers\/[^/]+\/[^/]+$/;

interface WhitelistEntry {
  method: string;
  matches: (path: string) => boolean;
  /**
   * Whether a 200 response on this route needs its collection envelope
   * unwrapped to a bare array. False for routes whose response already
   * satisfies the card's contract verbatim (pure auth+rate-limit
   * pass-through, no body transform).
   */
  reshape: boolean;
}

/**
 * The exact method+path combinations the wud-card calls (see wud-card.js
 * primary-source analysis). The 5-segment remote-agent trigger variant and
 * the single-container /:id/watch rescan are intentionally excluded — the
 * card never calls them — so they fall through untouched like any other
 * non-whitelisted request.
 */
const WHITELIST: WhitelistEntry[] = [
  { method: 'GET', matches: (path) => path === CONTAINERS_PATH, reshape: true },
  { method: 'GET', matches: (path) => CONTAINERS_TRIGGERS_PATTERN.test(path), reshape: true },
  { method: 'POST', matches: (path) => path === CONTAINERS_WATCH_PATH, reshape: true },
  {
    method: 'POST',
    matches: (path) => CONTAINER_TRIGGER_RUN_PATTERN.test(path),
    reshape: false,
  },
];

function findWhitelistMatch(method: string, path: string): WhitelistEntry | undefined {
  return WHITELIST.find((entry) => entry.method === method && entry.matches(path));
}

/**
 * Single middleware applied to every request that reaches the compat
 * mount. Non-whitelisted requests are unaffected — next() is called
 * immediately so they fall through to whatever is mounted after (the
 * deprecated /api alias today).
 */
export function wudCardCompatMiddleware(req: Request, res: Response, next: NextFunction): void {
  const match = findWhitelistMatch(req.method, req.path);
  if (match?.reshape) {
    unwrapEnvelopeOnResponse(res);
  }
  next();
}

/**
 * Init the wud-card compat router.
 * @returns {*|Router}
 */
export function init(): express.Router {
  const router = express.Router();
  router.use(wudCardCompatMiddleware);
  return router;
}
