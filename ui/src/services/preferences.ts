import { PREFERENCES_API_VERSION } from '../preferences';
import type { PreferencesSchema } from '../preferences/schema';
import { readJsonResponse } from '../utils/api';
import { readHttpError } from './error-response';

interface PreferencesEnvelope {
  apiVersion: number;
  username: string;
  schemaVersion: number | null;
  preferences: Record<string, unknown> | null;
  updatedAt: string | null;
  revision: number;
}

const PREFERENCES_REVISION_STALE_ERROR = 'PREFERENCES_REVISION_STALE';

/**
 * The server refused a write because another one landed since this client last
 * read the document. The caller re-fetches, merges and tries again.
 */
class PreferencesRevisionConflictError extends Error {
  constructor() {
    super(PREFERENCES_REVISION_STALE_ERROR);
    this.name = 'PreferencesRevisionConflictError';
  }
}

async function getPreferences(): Promise<PreferencesEnvelope> {
  const response = await fetch('/api/v1/preferences', { credentials: 'include' });
  if (!response.ok) {
    throw new Error(await readHttpError(response));
  }
  return readJsonResponse<PreferencesEnvelope>(response);
}

async function updatePreferences(
  schemaVersion: number,
  preferences: PreferencesSchema,
  revision?: number,
): Promise<PreferencesEnvelope> {
  const response = await fetch('/api/v1/preferences', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      apiVersion: PREFERENCES_API_VERSION,
      schemaVersion,
      preferences,
      revision,
    }),
  });
  if (response.status === 409) {
    // Two different 409s share this status: a stale revision (re-fetch and
    // merge) and an API version mismatch (a real error).
    const body = await response.json().catch(() => null);
    if (body?.error === PREFERENCES_REVISION_STALE_ERROR) {
      throw new PreferencesRevisionConflictError();
    }
    throw new Error(typeof body?.error === 'string' ? body.error : 'HTTP 409');
  }
  if (!response.ok) {
    throw new Error(await readHttpError(response));
  }
  return readJsonResponse<PreferencesEnvelope>(response);
}

export { getPreferences, PreferencesRevisionConflictError, updatePreferences };
