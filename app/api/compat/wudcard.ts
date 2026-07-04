import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import * as apiRouter from '../api.js';

/**
 * Compatibility shim for the Home Assistant "wud-card" integration
 * (https://github.com/angryvoegi/wud-card), which speaks the upstream WUD
 * response shape (bare arrays) rather than drydock's { data, total, ... }
 * collection envelope.
 *
 * Gated by DD_COMPAT_WUDCARD (see getWudCardCompatEnabled(), default OFF).
 *
 * Genuinely self-sufficient: init() builds its own internal apiRouter.init()
 * instance (index.ts already mounts two independent instances of the API
 * router today — one for /api/v1, one for the deprecated /api alias — this
 * is a third) and, for the narrow whitelist of endpoints the card actually
 * calls, dispatches the request directly into that internal instance
 * (patching res.json first to unwrap drydock's list envelope into a bare
 * array when the matched route needs it). That internal instance runs the
 * exact same route handlers the /api alias uses today, so auth, rate
 * limiting, and behavior are identical — no security bypass — but the
 * response is produced by this module itself, not by falling through to
 * whatever happens to be mounted after it. Every other request calls
 * next() immediately and is left completely untouched, falling through to
 * whatever is mounted after this router (the deprecated /api alias today).
 * Because whitelisted requests never depend on that fallthrough, this
 * module keeps working unchanged once the deprecated /api alias is
 * eventually removed.
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
 * Build the compat middleware bound to a specific internal apiRouter
 * instance. Whitelisted requests are answered by dispatching them directly
 * into internalApiRouter (patching res.json first when the matched route
 * needs its collection envelope unwrapped) — this module never depends on
 * anything mounted after it to serve those responses. Non-whitelisted
 * requests call next() immediately and are left completely untouched, so
 * they fall through to whatever is mounted after this router (the
 * deprecated /api alias today).
 */
export function createWudCardCompatMiddleware(
  internalApiRouter: express.Router,
): (req: Request, res: Response, next: NextFunction) => void {
  return function wudCardCompatMiddleware(req: Request, res: Response, next: NextFunction): void {
    const match = findWhitelistMatch(req.method, req.path);
    if (!match) {
      next();
      return;
    }
    if (match.reshape) {
      unwrapEnvelopeOnResponse(res);
    }
    internalApiRouter(req, res, next);
  };
}

/**
 * Init the wud-card compat router. Owns its own internal apiRouter.init()
 * instance so the whitelisted endpoints are served directly by this
 * module, with no dependency on the deprecated unversioned /api alias
 * mounted after it.
 * @returns {*|Router}
 */
export function init(): express.Router {
  const internalApiRouter = apiRouter.init();
  const router = express.Router();
  router.use(createWudCardCompatMiddleware(internalApiRouter));
  return router;
}
