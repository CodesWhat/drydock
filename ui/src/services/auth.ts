/**
 * Authentication service.
 */

import { errorMessage } from '../utils/error';

interface CurrentUser {
  username: string;
}

interface LoginChallenge {
  id: string;
  expiresAt: string;
  methods: string[];
}

type ChallengeProof = { code: string } | { recoveryCode: string };

/** A failed auth request that keeps the status (and Retry-After) the view branches on. */
class AuthRequestError extends Error {
  readonly status: number;
  readonly retryAfterSeconds: number | undefined;

  constructor(message: string, status: number, retryAfterSeconds?: number) {
    super(message);
    this.name = 'AuthRequestError';
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

let pendingUserRequest: Promise<CurrentUser | undefined> | undefined;

function clearCachedUser() {
  pendingUserRequest = undefined;
}

function getPayloadErrorMessage(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null) {
    return '';
  }
  if (!('error' in payload)) {
    return '';
  }

  const error = payload.error;
  return typeof error === 'string' ? error.trim() : '';
}

function parseRetryAfterSeconds(response: Response): number | undefined {
  const value = response.headers?.get('Retry-After');
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) {
    return undefined;
  }
  return Number.parseInt(value, 10);
}

function parseLoginChallenge(payload: unknown): LoginChallenge {
  const candidate =
    typeof payload === 'object' && payload !== null && 'challenge' in payload
      ? payload.challenge
      : undefined;
  if (typeof candidate === 'object' && candidate !== null) {
    const { id, expiresAt, methods } = candidate as Record<string, unknown>;
    const known = Array.isArray(methods)
      ? methods.filter((method): method is string => method === 'totp' || method === 'recovery')
      : [];
    if (typeof id === 'string' && typeof expiresAt === 'string' && known.length > 0) {
      return { id, expiresAt, methods: known };
    }
  }
  throw new Error('Unexpected login challenge response');
}

/**
 * Get auth provider status.
 * @returns {Promise<unknown>}
 */
async function getStrategies(): Promise<{
  providers: unknown[];
  errors: Array<{ provider: string; error: string }>;
}> {
  const response = await fetch('/api/v1/auth/status', { credentials: 'include' });
  if (!response.ok) {
    throw new Error(`Failed to get auth strategies: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Get current user.
 * @returns {Promise<*>}
 */
async function getUser() {
  if (pendingUserRequest) {
    return pendingUserRequest;
  }

  pendingUserRequest = (async () => {
    try {
      // Only dedupe concurrent callers. Always revalidate settled auth state so
      // logout/session expiry in another tab is reflected on the next check.
      const response = await fetch('/auth/user', {
        redirect: 'manual',
        credentials: 'include',
        signal: AbortSignal.timeout(8_000),
      });
      if (response.ok) {
        return await response.json();
      }
      return undefined;
    } catch (e: unknown) {
      console.debug(`Unable to fetch current user: ${errorMessage(e)}`);
      return undefined;
    } finally {
      pendingUserRequest = undefined;
    }
  })();

  return pendingUserRequest;
}

/**
 * Perform auth Basic.
 * @param username
 * @param password
 * @returns {Promise<*>}
 */
async function loginBasic(username: string, password: string, remember: boolean = false) {
  const base64 = btoa(`${username}:${password}`);
  const response = await fetch(`/auth/login`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      Authorization: `Basic ${base64}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ remember }),
  });
  if (!response.ok) {
    let message = '';
    try {
      const payload: unknown = await response.json();
      message = getPayloadErrorMessage(payload);
    } catch {
      // Ignore response parsing errors and fallback to a generic credential error.
    }

    if (response.status === 401 || message.toLowerCase() === 'unauthorized') {
      throw new Error('Username or password error');
    }

    throw new Error(message || 'Username or password error');
  }
  if (response.status === 202) {
    // Password was right but a second factor is owed: no session exists yet,
    // so the cached user stays untouched and the challenge is handed back.
    return { challenge: parseLoginChallenge(await response.json()) };
  }
  clearCachedUser();
  return await response.json();
}

/**
 * Complete a login challenge with a TOTP or recovery code. The challenge id is
 * a credential: it only ever travels in this request path, never stored.
 */
async function completeLoginChallenge(id: string, proof: ChallengeProof, remember: boolean) {
  const response = await fetch(`/auth/login-challenges/${encodeURIComponent(id)}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...proof, remember }),
  });
  if (!response.ok) {
    throw new AuthRequestError(
      `Login challenge failed (${response.status})`,
      response.status,
      parseRetryAfterSeconds(response),
    );
  }
  clearCachedUser();
  return await response.json();
}

/** Best-effort cancel: the server expires the challenge on its own anyway. */
async function cancelLoginChallenge(id: string): Promise<void> {
  try {
    await fetch(`/auth/login-challenges/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: 'include',
    });
  } catch {
    // Nothing to do: the challenge lapses by itself.
  }
}

/**
 * Store remember-me preference in the session before auth flows.
 */
async function setRememberMe(remember: boolean) {
  await fetch('/auth/remember', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ remember }),
  });
}

/**
 * Get Oidc redirection url.
 * @returns {Promise<*>}
 */
async function getOidcRedirection(name: string) {
  const response = await fetch(`/auth/oidc/${name}/redirect`, { credentials: 'include' });
  return response.json();
}

/**
 * Logout current user.
 * @returns {Promise<unknown>}
 */
async function logout() {
  const response = await fetch(`/auth/logout`, {
    method: 'POST',
    credentials: 'include',
    redirect: 'manual',
  });
  clearCachedUser();
  return response.json();
}

export type { ChallengeProof, LoginChallenge };
export {
  AuthRequestError,
  cancelLoginChallenge,
  completeLoginChallenge,
  getOidcRedirection,
  getStrategies,
  getUser,
  loginBasic,
  logout,
  setRememberMe,
};
