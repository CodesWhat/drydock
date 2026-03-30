/**
 * Authentication service.
 */

import { errorMessage } from '../utils/error';

// Current logged user
let user = undefined;

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
  try {
    const response = await fetch('/auth/user', {
      redirect: 'manual',
      credentials: 'include',
    });
    if (response.ok) {
      user = await response.json();
      return user;
    } else {
      user = undefined;
      return undefined;
    }
  } catch (e: unknown) {
    console.debug(`Unable to fetch current user: ${errorMessage(e)}`);
    user = undefined;
    return undefined;
  }
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
  user = await response.json();
  return user;
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
  user = await response.json();
  return user;
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
  user = undefined;
  return response.json();
}

export { getOidcRedirection, getStrategies, getUser, loginBasic, logout, setRememberMe };
