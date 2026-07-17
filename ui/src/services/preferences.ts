import { PREFERENCES_API_VERSION } from '../preferences';
import type { PreferencesSchema } from '../preferences/schema';
import { readJsonResponse } from '../utils/api';

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
    const err = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `HTTP ${response.status}`);
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
    const err = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `HTTP ${response.status}`);
  }
  return readJsonResponse<PreferencesEnvelope>(response);
}

export type { PreferencesEnvelope };
export { getPreferences, updatePreferences };
