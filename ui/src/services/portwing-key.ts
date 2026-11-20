import { i18n } from '../boot/i18n';
import { readJsonResponse } from '../utils/api';
import { ApiError } from '../utils/error';

/** A registered edge-agent public key. Only the public half is ever stored or returned. */
export interface PortwingKey {
  keyId: string;
  pubkey: string;
  label: string;
  createdAt: string;
  revokedAt: string | null;
}

const BASE_PATH = '/api/v1/portwing/keys';

async function throwForResponse(response: Response, fallback: string): Promise<never> {
  if (response.status === 401 || response.status === 403) {
    throw new ApiError(i18n.global.t('agentsView.edgeKeys.forbidden'), response.status);
  }
  const payload = await response.json().catch(() => null);
  const message =
    payload &&
    typeof payload === 'object' &&
    typeof (payload as { error?: unknown }).error === 'string' &&
    (payload as { error: string }).error.trim()
      ? (payload as { error: string }).error
      : `${fallback} (HTTP ${response.status})`;
  throw new ApiError(message, response.status);
}

export async function listPortwingKeys(): Promise<PortwingKey[]> {
  const response = await fetch(BASE_PATH, { credentials: 'include' });
  if (!response.ok) {
    return throwForResponse(response, i18n.global.t('agentsView.edgeKeys.loadError'));
  }
  const payload = await readJsonResponse<unknown>(response, 'Portwing keys');
  return Array.isArray(payload) ? (payload as PortwingKey[]) : [];
}

export async function registerPortwingKey(input: {
  pubkeyBase64: string;
  label: string;
}): Promise<Pick<PortwingKey, 'keyId' | 'label' | 'createdAt'>> {
  const response = await fetch(BASE_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    return throwForResponse(response, i18n.global.t('agentsView.edgeKeys.errors.register'));
  }
  return readJsonResponse(response, 'Portwing keys');
}

export async function revokePortwingKey(keyId: string): Promise<void> {
  const response = await fetch(`${BASE_PATH}/${encodeURIComponent(keyId)}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!response.ok) {
    return throwForResponse(response, i18n.global.t('agentsView.edgeKeys.errors.revoke'));
  }
}
