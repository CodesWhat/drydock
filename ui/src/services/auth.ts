/**
 * Authentication service.
 */

import { errorMessage } from '../utils/error';

export const AUTH_USER_CACHE_TTL_MS = 5_000;

let cachedUser: unknown = undefined;
let cachedUserExpiresAt = 0;
let hasCachedUser = false;
let pendingUserRequest: Promise<unknown> | undefined;

function setCachedUser(user: unknown, now = Date.now()) {
  cachedUser = user;
  cachedUserExpiresAt = now + AUTH_USER_CACHE_TTL_MS;
  hasCachedUser = true;
  return user;
}

function clearCachedUser() {
  cachedUser = undefined;
  cachedUserExpiresAt = 0;
  hasCachedUser = false;
  pendingUserRequest = undefined;
}

function hasFreshUserCache(now = Date.now()) {
  return hasCachedUser && cachedUserExpiresAt > now;
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
  if (hasFreshUserCache()) {
    return cachedUser;
  }

  if (pendingUserRequest) {
    return pendingUserRequest;
  }

  pendingUserRequest = (async () => {
    try {
      const response = await fetch('/auth/user', {
        redirect: 'manual',
        credentials: 'include',
      });
      if (response.ok) {
        return setCachedUser(await response.json());
      }
      return setCachedUser(undefined);
    } catch (e: unknown) {
      console.debug(`Unable to fetch current user: ${errorMessage(e)}`);
      return setCachedUser(undefined);
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
  return setCachedUser(await response.json());
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

export { getOidcRedirection, getStrategies, getUser, loginBasic, logout, setRememberMe };
