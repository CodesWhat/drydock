import express, { type Response } from 'express';
import joi from 'joi';
import nocache from 'nocache';
import * as uiPreferencesStore from '../store/ui-preferences.js';
import type { AuthRequest } from './auth-types.js';
import { sendErrorResponse } from './error-response.js';
import { sanitizeApiError } from './helpers.js';
import { broadcastPreferencesUpdated } from './sse.js';

const router = express.Router();

// Server-side API contract version for /api/v1/preferences. This is a
// distinct symbol from ui/src/preferences/index.ts's client-side
// PREFERENCES_API_VERSION constant of the same name/value — app/ and ui/
// share no runtime code, so a contract tripwire test in preferences.test.ts
// asserts the two constants (and the OpenAPI enum) agree; a one-sided bump
// fails CI instead of 409ing every sync write at runtime.
export const PREFERENCES_API_VERSION = 1;

const preferencesPatchSchema = joi.object({
  apiVersion: joi.number().valid(PREFERENCES_API_VERSION).required(),
  schemaVersion: joi.number().integer().min(1).required(),
  preferences: joi.object().unknown(true).required(),
});

// No per-route size validation here: PATCH bodies are already bounded by the
// existing global 256kb express.json() limit applied to all mutating
// /api/v1/* routes (app/api/api.ts's mutationJsonBodyParser), which rejects
// oversized requests with a 413 before this handler ever runs. Fine for
// today's blob sizes (a few KB) — revisit if a future field (e.g. dashboard
// grid layouts) grows large enough to approach that ceiling.

interface PreferencesResponseEnvelope {
  apiVersion: number;
  username: string;
  schemaVersion: number | null;
  preferences: Record<string, unknown> | null;
  updatedAt: string | null;
}

/**
 * Resolve the current request's username, falling back to 'anonymous'.
 * req.user is undefined for real anonymous sessions — passport-anonymous's
 * Strategy.authenticate() calls this.pass() with no arguments, it never
 * synthesizes { username: 'anonymous' }. That literal only appears as a
 * response-body fallback in auth.ts's GET /auth/user handler. Reimplemented
 * here since this router reads req.user directly.
 * @param req
 */
function getUsernameOrAnonymous(req: AuthRequest): string {
  return req.user?.username?.trim() || 'anonymous';
}

function buildEnvelope(
  username: string,
  record: uiPreferencesStore.UiPreferencesRecord | null,
): PreferencesResponseEnvelope {
  return {
    apiVersion: PREFERENCES_API_VERSION,
    username,
    schemaVersion: record?.schemaVersion ?? null,
    preferences: record?.preferences ?? null,
    updatedAt: record?.updatedAt ?? null,
  };
}

/**
 * Get synced UI preferences for the current user.
 * @param req
 * @param res
 */
function getPreferences(req: AuthRequest, res: Response): void {
  const username = getUsernameOrAnonymous(req);
  if (username === 'anonymous') {
    sendErrorResponse(res, 403, 'Sync is not available in anonymous mode');
    return;
  }

  const record = uiPreferencesStore.getPreferences(username);
  res.status(200).json(buildEnvelope(username, record));
}

/**
 * Replace synced UI preferences for the current user (full-replace semantics).
 * @param req
 * @param res
 */
function updatePreferences(req: AuthRequest, res: Response): void {
  const username = getUsernameOrAnonymous(req);
  if (username === 'anonymous') {
    sendErrorResponse(res, 403, 'Sync is not available in anonymous mode');
    return;
  }

  const body = (req.body ?? {}) as { apiVersion?: unknown };
  if (body.apiVersion !== PREFERENCES_API_VERSION) {
    res.status(409).json({
      error: 'PREFERENCES_API_VERSION_MISMATCH',
      supportedApiVersion: PREFERENCES_API_VERSION,
    });
    return;
  }

  const validated = preferencesPatchSchema.validate(req.body || {});
  if (validated.error) {
    sendErrorResponse(res, 400, sanitizeApiError(validated.error));
    return;
  }

  const record = uiPreferencesStore.replacePreferences(
    username,
    validated.value.schemaVersion,
    validated.value.preferences,
  );
  broadcastPreferencesUpdated();
  res.status(200).json(buildEnvelope(username, record));
}

/**
 * Init router.
 * @returns {*}
 */
export function init() {
  router.use(nocache());
  router.get('/', getPreferences);
  router.patch('/', updatePreferences);
  return router;
}
