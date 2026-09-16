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
): Promise<PreferencesEnvelope> {
  const response = await fetch('/api/v1/preferences', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ apiVersion: PREFERENCES_API_VERSION, schemaVersion, preferences }),
  });
  if (!response.ok) {
    throw new Error(await readHttpError(response));
  }
  return readJsonResponse<PreferencesEnvelope>(response);
}

export { getPreferences, updatePreferences };
