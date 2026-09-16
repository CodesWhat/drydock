import { readJsonResponse } from '../utils/api';
import { readHttpError } from './error-response';

export type UpdateMode = 'notify' | 'manual' | 'auto';

interface Settings {
  internetlessMode: boolean;
  updateMode: UpdateMode;
}

async function getSettings(): Promise<Settings> {
  const response = await fetch('/api/v1/settings', { credentials: 'include' });
  if (!response.ok) {
    throw new Error(await readHttpError(response));
  }
  return readJsonResponse<Settings>(response);
}

async function updateSettings(settings: Partial<Settings>): Promise<Settings> {
  const response = await fetch('/api/v1/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(settings),
  });
  if (!response.ok) {
    throw new Error(await readHttpError(response));
  }
  return readJsonResponse<Settings>(response);
}

async function clearIconCache(): Promise<{ cleared: number }> {
  const response = await fetch('/api/v1/icons/cache', {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(await readHttpError(response));
  }
  return readJsonResponse<{ cleared: number }>(response);
}

export { clearIconCache, getSettings, updateSettings };
