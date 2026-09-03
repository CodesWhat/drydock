import { readJsonResponse } from '../utils/api';

/** The six scopes the API enforces. Mirrors `API_SCOPES` in the backend registry. */
const API_SCOPES = [
  'read',
  'containers:watch',
  'containers:update',
  'triggers:test',
  'admin',
  'api-keys:manage',
] as const;

type ApiKeyStatus = 'active' | 'revoked' | 'expired';

/**
 * A key as the API returns it. There is no secret field, by shape: the
 * credential exists only in the response to a create.
 */
interface ApiKey {
  keyId: string;
  name: string;
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

/** A create response: the record plus the one and only copy of the credential. */
interface CreatedApiKey extends ApiKey {
  apiKey: string;
}

interface CreateApiKeyInput {
  name: string;
  scopes: string[];
  expiresAt?: string | null;
  rateLimitMax?: number;
}

interface RevokeApiKeyResult {
  keyId: string;
  revokedKeyIds: string[];
  cascadeCount: number;
}

const BASE_PATH = '/api/v1/api-keys';

async function throwForResponse(response: Response, fallback: string): Promise<never> {
  const payload = await response.json().catch(() => null);
  const message =
    payload &&
    typeof payload === 'object' &&
    typeof (payload as { error?: unknown }).error === 'string'
      ? (payload as { error: string }).error
      : `${fallback} (HTTP ${response.status})`;
  throw new Error(message);
}

/**
 * One page of keys, plus what the caller needs to ask for the next one.
 *
 * `hasMore` is true only when `nextCursor` is a string, so a caller that has
 * somewhere to go always has the thing to go there with.
 */
interface ApiKeyPage {
  data: ApiKey[];
  total: number;
  hasMore: boolean;
  nextCursor?: string;
}

/**
 * How many keys a page holds. The server's own default; its ceiling is 200, so
 * a caller asking for everything at once silently got truncated at that and
 * had no way to know, which is what this replaces.
 */
const API_KEY_PAGE_SIZE = 50;

/**
 * Read one page of keys.
 *
 * Paged on the server's cursor, not on a count of what is already loaded: keys
 * sort newest first, so one minted while the operator is reading inserts at the
 * head and an offset walk skips whatever it pushed off the page boundary.
 *
 * `hasMore` is taken from the cursor rather than from the flag beside it. A
 * body that claims more but carries no cursor leaves nothing to ask for, and
 * repeating the cursor-less request would duplicate every row already on
 * screen.
 */
async function listApiKeys(options: { limit?: number; cursor?: string } = {}): Promise<ApiKeyPage> {
  const limit = options.limit ?? API_KEY_PAGE_SIZE;
  const query = new URLSearchParams({ limit: String(limit) });
  if (options.cursor !== undefined) {
    query.set('cursor', options.cursor);
  }
  const response = await fetch(`${BASE_PATH}?${query.toString()}`, {
    credentials: 'include',
  });
  if (!response.ok) {
    return throwForResponse(response, 'Failed to load API keys');
  }
  const payload = await readJsonResponse<{
    data?: ApiKey[];
    total?: number;
    nextCursor?: string;
  }>(response, 'API keys');
  const data = Array.isArray(payload?.data) ? payload.data : [];
  const total = typeof payload?.total === 'number' ? payload.total : data.length;
  const nextCursor = typeof payload?.nextCursor === 'string' ? payload.nextCursor : undefined;
  return {
    data,
    total,
    hasMore: nextCursor !== undefined,
    ...(nextCursor === undefined ? {} : { nextCursor }),
  };
}

/**
 * Mint a key.
 *
 * The resolved value carries the credential and is the only time it exists
 * anywhere outside the caller's hands, so a caller that drops it has to mint
 * another key.
 */
async function createApiKey(input: CreateApiKeyInput): Promise<CreatedApiKey> {
  const response = await fetch(BASE_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      name: input.name,
      scopes: input.scopes,
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
      ...(typeof input.rateLimitMax === 'number' ? { rateLimitMax: input.rateLimitMax } : {}),
    }),
  });
  if (!response.ok) {
    return throwForResponse(response, 'Failed to create API key');
  }
  return readJsonResponse<CreatedApiKey>(response, 'API keys');
}

/**
 * Revoke a key and everything it minted.
 *
 * The cascade count comes back from the server rather than being derived here,
 * because the client's list can be stale and under-reporting how much a
 * revocation just killed is worse than showing nothing.
 */
async function revokeApiKey(keyId: string): Promise<RevokeApiKeyResult> {
  const response = await fetch(`${BASE_PATH}/${encodeURIComponent(keyId)}`, {
    method: 'DELETE',
    headers: { 'X-DD-Confirm-Action': 'api-key-revoke' },
    credentials: 'include',
  });
  if (!response.ok) {
    return throwForResponse(response, 'Failed to revoke API key');
  }
  return readJsonResponse<RevokeApiKeyResult>(response, 'API keys');
}

export { API_KEY_PAGE_SIZE, API_SCOPES, type ApiKey, createApiKey, listApiKeys, revokeApiKey };
