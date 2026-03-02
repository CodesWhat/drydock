import axios from 'axios';

export interface DeviceCodeFlowOptions {
  tokenEndpoint: string;
  clientId?: string;
  clientSecret?: string;
  scope?: string;
  audience?: string;
  resource?: string;
  timeout?: number;
}

export interface OidcRequestParameters {
  clientId?: string;
  clientSecret?: string;
  scope?: string;
  audience?: string;
  resource?: string;
}

export interface DeviceCodeTokenPollOptions {
  tokenEndpoint: string;
  deviceCode: string;
  clientId?: string;
  clientSecret?: string;
  timeout?: number;
  pollIntervalMs: number;
  pollTimeoutMs: number;
}

export interface MutableOidcState {
  accessToken?: string;
  refreshToken?: string;
  accessTokenExpiresAt?: number;
  deviceCodeCompleted?: boolean;
}

export interface MutableOidcStateAccessor {
  getAccessToken: () => string | undefined;
  setAccessToken: (value: string | undefined) => void;
  getRefreshToken: () => string | undefined;
  setRefreshToken: (value: string | undefined) => void;
  getAccessTokenExpiresAt: () => number | undefined;
  setAccessTokenExpiresAt: (value: number | undefined) => void;
  getDeviceCodeCompleted: () => boolean | undefined;
  setDeviceCodeCompleted: (value: boolean | undefined) => void;
}

const REDACTED_OIDC_TOKEN_VALUE = '[REDACTED]';

function getRedactedTokenValue(value: string | undefined) {
  return value ? REDACTED_OIDC_TOKEN_VALUE : undefined;
}

export function createMutableOidcState(accessor: MutableOidcStateAccessor): MutableOidcState {
  const state: any = {};

  Object.defineProperties(state, {
    accessToken: {
      get: accessor.getAccessToken,
      set: accessor.setAccessToken,
      enumerable: false,
      configurable: false,
    },
    refreshToken: {
      get: accessor.getRefreshToken,
      set: accessor.setRefreshToken,
      enumerable: false,
      configurable: false,
    },
    accessTokenExpiresAt: {
      get: accessor.getAccessTokenExpiresAt,
      set: accessor.setAccessTokenExpiresAt,
      enumerable: false,
      configurable: false,
    },
    deviceCodeCompleted: {
      get: accessor.getDeviceCodeCompleted,
      set: accessor.setDeviceCodeCompleted,
      enumerable: false,
      configurable: false,
    },
    toJSON: {
      value: () => ({
        accessToken: getRedactedTokenValue(accessor.getAccessToken()),
        refreshToken: getRedactedTokenValue(accessor.getRefreshToken()),
        accessTokenExpiresAt: accessor.getAccessTokenExpiresAt(),
        deviceCodeCompleted: accessor.getDeviceCodeCompleted(),
      }),
      enumerable: false,
      configurable: false,
    },
  });

  Object.defineProperty(state, Symbol.for('nodejs.util.inspect.custom'), {
    value: () => state.toJSON(),
    enumerable: false,
    configurable: false,
  });

  return state as MutableOidcState;
}

export interface OidcContext {
  watcherName: string;
  log: any;
  state: MutableOidcState;
  getOidcAuthString: (paths: string[]) => string | undefined;
  getOidcAuthNumber: (paths: string[]) => number | undefined;
  normalizeNumber: (value: any) => number | undefined;
  sleep: (ms: number) => Promise<void>;
}

export const OIDC_ACCESS_TOKEN_REFRESH_WINDOW_MS = 30 * 1000;
export const OIDC_DEFAULT_ACCESS_TOKEN_TTL_MS = 5 * 60 * 1000;
export const OIDC_DEFAULT_TIMEOUT_MS = 5000;
export const OIDC_TOKEN_ENDPOINT_PATHS = [
  'tokenurl',
  'tokenendpoint',
  'token_url',
  'token_endpoint',
  'token.url',
  'token.endpoint',
];
export const OIDC_CLIENT_ID_PATHS = ['clientid', 'client_id', 'client.id'];
export const OIDC_CLIENT_SECRET_PATHS = ['clientsecret', 'client_secret', 'client.secret'];
export const OIDC_SCOPE_PATHS = ['scope'];
export const OIDC_RESOURCE_PATHS = ['resource'];
export const OIDC_AUDIENCE_PATHS = ['audience'];
export const OIDC_GRANT_TYPE_PATHS = ['granttype', 'grant_type'];
export const OIDC_ACCESS_TOKEN_PATHS = ['accesstoken', 'access_token'];
export const OIDC_REFRESH_TOKEN_PATHS = ['refreshtoken', 'refresh_token'];
export const OIDC_EXPIRES_IN_PATHS = ['expiresin', 'expires_in'];
export const OIDC_TIMEOUT_PATHS = ['timeout'];
export const OIDC_DEVICE_URL_PATHS = [
  'deviceurl',
  'deviceendpoint',
  'device_url',
  'device_endpoint',
  'device.url',
  'device.endpoint',
  'device_authorization_endpoint',
];
export const OIDC_DEVICE_POLL_INTERVAL_MS = 5000;
export const OIDC_DEVICE_POLL_TIMEOUT_MS = 5 * 60 * 1000;

export function getRemoteAuthResolution(
  auth: any,
  getFirstConfigString: (value: any, paths: string[]) => string | undefined,
) {
  const hasBearer = Boolean(auth?.bearer);
  const hasBasic = Boolean(auth?.user && auth?.password);
  const hasOidcConfig = Boolean(
    getFirstConfigString(auth?.oidc, OIDC_TOKEN_ENDPOINT_PATHS) ||
      getFirstConfigString(auth?.oidc, OIDC_ACCESS_TOKEN_PATHS) ||
      getFirstConfigString(auth?.oidc, OIDC_REFRESH_TOKEN_PATHS),
  );
  let authType = `${auth?.type || ''}`.toLowerCase();
  if (!authType) {
    if (hasBearer) {
      authType = 'bearer';
    } else if (hasBasic) {
      authType = 'basic';
    } else if (hasOidcConfig) {
      authType = 'oidc';
    }
  }
  return { authType, hasBearer, hasBasic, hasOidcConfig };
}

export function initializeRemoteOidcStateFromConfiguration(context: OidcContext) {
  const configuredAccessToken = context.getOidcAuthString(OIDC_ACCESS_TOKEN_PATHS);
  const configuredRefreshToken = context.getOidcAuthString(OIDC_REFRESH_TOKEN_PATHS);
  const configuredExpiresInSeconds = context.getOidcAuthNumber(OIDC_EXPIRES_IN_PATHS);

  if (configuredAccessToken && !context.state.accessToken) {
    context.state.accessToken = configuredAccessToken;
  }
  if (configuredRefreshToken && !context.state.refreshToken) {
    context.state.refreshToken = configuredRefreshToken;
  }
  if (
    configuredAccessToken &&
    configuredExpiresInSeconds !== undefined &&
    context.state.accessTokenExpiresAt === undefined
  ) {
    context.state.accessTokenExpiresAt = Date.now() + configuredExpiresInSeconds * 1000;
  }
}

export function getOidcGrantType(input: {
  configuredGrantType?: string;
  refreshToken?: string;
  deviceUrl?: string;
}) {
  const configuredGrantType = `${input.configuredGrantType || ''}`.trim().toLowerCase();
  if (configuredGrantType) {
    return configuredGrantType;
  }
  if (input.refreshToken) {
    return 'refresh_token';
  }
  if (input.deviceUrl) {
    return 'urn:ietf:params:oauth:grant-type:device_code';
  }
  return 'client_credentials';
}

export function isRemoteOidcTokenRefreshRequired(
  state: MutableOidcState,
  now = Date.now(),
) {
  if (!state.accessToken) {
    return true;
  }
  if (state.accessTokenExpiresAt === undefined) {
    return false;
  }
  return state.accessTokenExpiresAt <= now + OIDC_ACCESS_TOKEN_REFRESH_WINDOW_MS;
}

export function determineGrantType(context: OidcContext): { grantType: string; deviceUrl?: string } {
  let grantType = getOidcGrantType({
    configuredGrantType: context.getOidcAuthString(OIDC_GRANT_TYPE_PATHS),
    refreshToken: context.state.refreshToken,
    deviceUrl: context.getOidcAuthString(OIDC_DEVICE_URL_PATHS),
  });

  if (grantType === 'refresh_token' && !context.state.refreshToken) {
    context.log.warn(
      `OIDC refresh token is missing for ${context.watcherName}; fallback to client_credentials grant`,
    );
    grantType = 'client_credentials';
  }

  if (grantType === 'urn:ietf:params:oauth:grant-type:device_code') {
    const deviceUrl = context.getOidcAuthString(OIDC_DEVICE_URL_PATHS);
    if (!deviceUrl) {
      context.log.warn(
        `OIDC device authorization URL is missing for ${context.watcherName}; fallback to client_credentials`,
      );
      grantType = 'client_credentials';
    } else {
      return { grantType, deviceUrl };
    }
  }

  if (grantType !== 'client_credentials' && grantType !== 'refresh_token') {
    context.log.warn(
      `OIDC grant type "${grantType}" is unsupported for ${context.watcherName}; fallback to client_credentials`,
    );
    grantType = 'client_credentials';
  }

  return { grantType };
}

/**
 * Build the URLSearchParams body for a standard OIDC token request
 * (client_credentials or refresh_token grant).
 */
export function appendOidcRequestBodyFields(
  body: URLSearchParams,
  params: OidcRequestParameters,
  includeClientSecret = true,
) {
  if (params.clientId) {
    body.set('client_id', params.clientId);
  }
  if (includeClientSecret && params.clientSecret) {
    body.set('client_secret', params.clientSecret);
  }
  if (params.scope) {
    body.set('scope', params.scope);
  }
  if (params.audience) {
    body.set('audience', params.audience);
  }
  if (params.resource) {
    body.set('resource', params.resource);
  }
}

export function buildTokenRequestBody(
  grantType: string,
  params: OidcRequestParameters,
  refreshToken?: string,
): URLSearchParams {
  const body = new URLSearchParams();
  body.set('grant_type', grantType);
  if (grantType === 'refresh_token' && refreshToken) {
    body.set('refresh_token', refreshToken);
  }
  appendOidcRequestBodyFields(body, params);
  return body;
}

export function applyRemoteOidcTokenPayload(
  state: MutableOidcState,
  tokenPayload: any,
  options: {
    watcherName: string;
    normalizeNumber: (value: any) => number | undefined;
    markDeviceCodeCompleted?: boolean;
    allowMissingAccessToken?: boolean;
  },
): boolean {
  const accessToken = tokenPayload?.access_token;
  if (!accessToken) {
    if (options.allowMissingAccessToken) {
      return false;
    }
    throw new Error(
      `Unable to refresh OIDC token for ${options.watcherName}: token endpoint response does not contain access_token`,
    );
  }

  state.accessToken = accessToken;
  if (tokenPayload.refresh_token) {
    state.refreshToken = tokenPayload.refresh_token;
  }
  const expiresIn = options.normalizeNumber(tokenPayload.expires_in);
  const tokenTtlMs = (expiresIn ?? OIDC_DEFAULT_ACCESS_TOKEN_TTL_MS / 1000) * 1000;
  state.accessTokenExpiresAt = Date.now() + tokenTtlMs;
  if (options.markDeviceCodeCompleted) {
    state.deviceCodeCompleted = true;
  }
  return true;
}

export async function refreshRemoteOidcAccessToken(context: OidcContext) {
  const tokenEndpoint = context.getOidcAuthString(OIDC_TOKEN_ENDPOINT_PATHS);
  if (!tokenEndpoint) {
    throw new Error(
      `Unable to refresh OIDC token for ${context.watcherName}: missing auth.oidc token endpoint`,
    );
  }

  const oidcClientId = context.getOidcAuthString(OIDC_CLIENT_ID_PATHS);
  const oidcClientSecret = context.getOidcAuthString(OIDC_CLIENT_SECRET_PATHS);
  const oidcScope = context.getOidcAuthString(OIDC_SCOPE_PATHS);
  const oidcAudience = context.getOidcAuthString(OIDC_AUDIENCE_PATHS);
  const oidcResource = context.getOidcAuthString(OIDC_RESOURCE_PATHS);
  const oidcTimeout = context.getOidcAuthNumber(OIDC_TIMEOUT_PATHS);

  const { grantType, deviceUrl } = determineGrantType(context);

  // Device code flow: delegate to the dedicated method
  if (grantType === 'urn:ietf:params:oauth:grant-type:device_code' && deviceUrl) {
    await performDeviceCodeFlow(context, deviceUrl, {
      tokenEndpoint,
      clientId: oidcClientId,
      clientSecret: oidcClientSecret,
      scope: oidcScope,
      audience: oidcAudience,
      resource: oidcResource,
      timeout: oidcTimeout,
    });
    return;
  }

  const tokenRequestBody = buildTokenRequestBody(
    grantType,
    {
      clientId: oidcClientId,
      clientSecret: oidcClientSecret,
      scope: oidcScope,
      audience: oidcAudience,
      resource: oidcResource,
    },
    context.state.refreshToken,
  );

  const tokenResponse = await axios.post(tokenEndpoint, tokenRequestBody.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    timeout: oidcTimeout || OIDC_DEFAULT_TIMEOUT_MS,
  });
  applyRemoteOidcTokenPayload(context.state, tokenResponse?.data || {}, {
    watcherName: context.watcherName,
    normalizeNumber: context.normalizeNumber,
  });
}

/**
 * Perform the OAuth 2.0 Device Authorization Grant (RFC 8628).
 *
 * Step 1: POST to the device authorization endpoint to obtain a device_code,
 *         user_code, and verification_uri.
 * Step 2: Log the user code and verification URI so the operator can authorize
 *         the device in a browser.
 * Step 3: Poll the token endpoint with the device_code until the user completes
 *         authorization, the code expires, or polling times out.
 */
export async function performDeviceCodeFlow(
  context: OidcContext,
  deviceUrl: string,
  options: DeviceCodeFlowOptions,
) {
  const { tokenEndpoint, clientId, clientSecret, scope, audience, resource, timeout } = options;

  // Step 1: Request device authorization
  const deviceRequestBody = new URLSearchParams();
  appendOidcRequestBodyFields(
    deviceRequestBody,
    { clientId, clientSecret, scope, audience, resource },
    false,
  );

  const deviceResponse = await axios.post(deviceUrl, deviceRequestBody.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    timeout: timeout || OIDC_DEFAULT_TIMEOUT_MS,
  });

  const devicePayload = deviceResponse?.data || {};
  const deviceCode = devicePayload.device_code;
  const userCode = devicePayload.user_code;
  const verificationUri = devicePayload.verification_uri || devicePayload.verification_url;
  const verificationUriComplete =
    devicePayload.verification_uri_complete || devicePayload.verification_url_complete;
  const serverInterval = context.normalizeNumber(devicePayload.interval);
  const deviceExpiresIn = context.normalizeNumber(devicePayload.expires_in);

  if (!deviceCode) {
    throw new Error(
      `OIDC device authorization for ${context.watcherName} failed: response does not contain device_code`,
    );
  }

  // Step 2: Log the user code for the operator
  const pollIntervalMs = serverInterval ? serverInterval * 1000 : OIDC_DEVICE_POLL_INTERVAL_MS;
  const pollTimeoutMs = deviceExpiresIn ? deviceExpiresIn * 1000 : OIDC_DEVICE_POLL_TIMEOUT_MS;

  if (verificationUriComplete) {
    context.log.info(
      `OIDC device authorization for ${context.watcherName}: visit ${verificationUriComplete} to authorize this device`,
    );
  } else if (verificationUri && userCode) {
    context.log.info(
      `OIDC device authorization for ${context.watcherName}: visit ${verificationUri} and enter code ${userCode}`,
    );
  } else {
    context.log.info(
      `OIDC device authorization for ${context.watcherName}: user_code=${userCode || 'N/A'}, verification_uri=${verificationUri || 'N/A'}`,
    );
  }

  // Step 3: Poll the token endpoint
  await pollDeviceCodeToken(context, {
    tokenEndpoint,
    deviceCode,
    clientId,
    clientSecret,
    timeout,
    pollIntervalMs,
    pollTimeoutMs,
  });
}

/**
 * Build the URLSearchParams body for a device-code token poll request.
 */
export function buildDeviceCodeTokenRequest(
  deviceCode: string,
  clientId: string | undefined,
  clientSecret: string | undefined,
): URLSearchParams {
  const body = new URLSearchParams();
  body.set('grant_type', 'urn:ietf:params:oauth:grant-type:device_code');
  body.set('device_code', deviceCode);
  appendOidcRequestBodyFields(body, { clientId, clientSecret });
  return body;
}

/**
 * Handle an error response during device-code token polling.
 * Returns an object indicating whether to continue polling and any
 * adjustment to the poll interval, or throws on fatal errors.
 */
export function handleTokenErrorResponse(
  e: any,
  currentIntervalMs: number,
  context: { watcherName: string; log: any },
): { continuePolling: boolean; newIntervalMs: number } {
  const errorResponse = e?.response?.data;
  const errorCode = errorResponse?.error || '';

  if (errorCode === 'authorization_pending') {
    context.log.debug(
      `OIDC device authorization for ${context.watcherName}: waiting for user authorization...`,
    );
    return { continuePolling: true, newIntervalMs: currentIntervalMs };
  }

  if (errorCode === 'slow_down') {
    const newIntervalMs = currentIntervalMs + 5000;
    context.log.debug(
      `OIDC device authorization for ${context.watcherName}: slowing down, new interval=${newIntervalMs}ms`,
    );
    return { continuePolling: true, newIntervalMs };
  }

  if (errorCode === 'expired_token') {
    throw new Error(
      `OIDC device authorization for ${context.watcherName} failed: device code expired before user authorization`,
    );
  }

  if (errorCode === 'access_denied') {
    throw new Error(
      `OIDC device authorization for ${context.watcherName} failed: user denied the authorization request`,
    );
  }

  const errorDescription = errorResponse?.error_description || e.message;
  throw new Error(
    `OIDC device authorization for ${context.watcherName} failed: ${errorDescription}`,
  );
}

/**
 * Poll the token endpoint with the device_code until the user authorizes,
 * the code expires, or the maximum timeout is reached.
 */
export async function pollDeviceCodeToken(context: OidcContext, options: DeviceCodeTokenPollOptions) {
  const {
    tokenEndpoint,
    deviceCode,
    clientId,
    clientSecret,
    timeout,
    pollIntervalMs,
    pollTimeoutMs,
  } = options;
  const startTime = Date.now();
  let currentIntervalMs = pollIntervalMs;

  while (Date.now() - startTime < pollTimeoutMs) {
    await context.sleep(currentIntervalMs);

    const tokenRequestBody = buildDeviceCodeTokenRequest(deviceCode, clientId, clientSecret);

    try {
      const tokenResponse = await axios.post(tokenEndpoint, tokenRequestBody.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: timeout || OIDC_DEFAULT_TIMEOUT_MS,
      });

      const applied = applyRemoteOidcTokenPayload(context.state, tokenResponse?.data || {}, {
        watcherName: context.watcherName,
        normalizeNumber: context.normalizeNumber,
        markDeviceCodeCompleted: true,
        allowMissingAccessToken: true,
      });
      if (!applied) {
        continue;
      }
      context.log.info(
        `OIDC device authorization for ${context.watcherName} completed successfully`,
      );
      return;
    } catch (e: any) {
      const result = handleTokenErrorResponse(e, currentIntervalMs, context);
      if (result.continuePolling) {
        currentIntervalMs = result.newIntervalMs;
      }
    }
  }

  throw new Error(
    `OIDC device authorization for ${context.watcherName} failed: polling timed out after ${pollTimeoutMs}ms`,
  );
}
