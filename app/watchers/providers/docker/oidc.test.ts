import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test, vi } from 'vitest';

import {
  applyRemoteOidcTokenPayload,
  buildDeviceCodeTokenRequest,
  buildTokenRequestBody,
  createMutableOidcState,
  getOidcGrantType,
  getRemoteAuthResolution,
  handleTokenErrorResponse,
  isRemoteOidcTokenRefreshRequired,
  OIDC_ACCESS_TOKEN_REFRESH_WINDOW_MS,
} from './oidc.js';

function getFirstConfigString(value: any, paths: string[]) {
  for (const path of paths) {
    const nestedValue = path
      .split('.')
      .filter((item) => item !== '')
      .reduce((result, item) => {
        if (!result || typeof result !== 'object') {
          return undefined;
        }
        return result[item];
      }, value);
    if (typeof nestedValue === 'string' && nestedValue.trim() !== '') {
      return nestedValue.trim();
    }
  }
  return undefined;
}

describe('docker oidc module', () => {
  test('OidcContext should avoid any-typed log', () => {
    const source = fs.readFileSync(path.resolve(__dirname, './oidc.ts'), 'utf8');

    expect(source).not.toContain('log: any;');
  });

  test('auto-detects remote auth type when explicit type is not set', () => {
    expect(getRemoteAuthResolution({ bearer: 'token' }, getFirstConfigString).authType).toBe(
      'bearer',
    );
    expect(
      getRemoteAuthResolution({ user: 'alice', password: 'secret' }, getFirstConfigString).authType,
    ).toBe('basic');
    expect(
      getRemoteAuthResolution({ oidc: { tokenurl: 'https://idp/token' } }, getFirstConfigString)
        .authType,
    ).toBe('oidc');
  });

  test('resolves grant type using explicit config, refresh token, and device url fallback', () => {
    expect(
      getOidcGrantType({
        configuredGrantType: 'client_credentials',
        refreshToken: 'refresh-token',
        deviceUrl: 'https://idp/device',
      }),
    ).toBe('client_credentials');

    expect(
      getOidcGrantType({
        configuredGrantType: undefined,
        refreshToken: 'refresh-token',
        deviceUrl: 'https://idp/device',
      }),
    ).toBe('refresh_token');

    expect(
      getOidcGrantType({
        configuredGrantType: undefined,
        refreshToken: undefined,
        deviceUrl: 'https://idp/device',
      }),
    ).toBe('urn:ietf:params:oauth:grant-type:device_code');
  });

  test('builds token request body with refresh_token and optional parameters', () => {
    const body = buildTokenRequestBody(
      'refresh_token',
      {
        clientId: 'cid',
        clientSecret: 'secret',
        scope: 'scope-a',
        audience: 'https://api.example.com',
        resource: 'https://resource.example.com',
      },
      'refresh-token-1',
    );

    const serialized = body.toString();
    expect(serialized).toContain('grant_type=refresh_token');
    expect(serialized).toContain('refresh_token=refresh-token-1');
    expect(serialized).toContain('client_id=cid');
    expect(serialized).toContain('client_secret=secret');
    expect(serialized).toContain('scope=scope-a');
    expect(serialized).toContain('audience=https%3A%2F%2Fapi.example.com');
    expect(serialized).toContain('resource=https%3A%2F%2Fresource.example.com');
  });

  test('builds device-code poll request body with required grant and code', () => {
    const body = buildDeviceCodeTokenRequest('device-code-123', 'cid', 'secret');
    const serialized = body.toString();
    expect(serialized).toContain(
      'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code',
    );
    expect(serialized).toContain('device_code=device-code-123');
    expect(serialized).toContain('client_id=cid');
    expect(serialized).toContain('client_secret=secret');
  });

  test('stores OIDC token payload into mutable state and marks device completion', () => {
    const state: any = {};

    const applied = applyRemoteOidcTokenPayload(
      state,
      {
        access_token: 'access-1',
        refresh_token: 'refresh-1',
        expires_in: '60',
      },
      {
        watcherName: 'watcher-a',
        normalizeNumber: (value) => Number(value),
        markDeviceCodeCompleted: true,
      },
    );

    expect(applied).toBe(true);
    expect(state.accessToken).toBe('access-1');
    expect(state.refreshToken).toBe('refresh-1');
    expect(state.accessTokenExpiresAt).toBeTypeOf('number');
    expect(state.deviceCodeCompleted).toBe(true);
  });

  test('throws and returns polling instructions for token polling errors', () => {
    const log = {
      debug: vi.fn(),
    };

    expect(
      handleTokenErrorResponse(
        {
          response: { data: { error: 'authorization_pending' } },
        },
        1000,
        { watcherName: 'watcher-a', log },
      ),
    ).toEqual({
      continuePolling: true,
      newIntervalMs: 1000,
    });

    expect(
      handleTokenErrorResponse(
        {
          response: { data: { error: 'slow_down' } },
        },
        1000,
        { watcherName: 'watcher-a', log },
      ),
    ).toEqual({
      continuePolling: true,
      newIntervalMs: 6000,
    });

    expect(() =>
      handleTokenErrorResponse(
        {
          response: {
            data: {
              error: 'server_error',
              error_description: 'backend down',
            },
          },
        },
        1000,
        { watcherName: 'watcher-a', log },
      ),
    ).toThrow('backend down');
  });

  test('refresh requirement uses access token presence and expiry window', () => {
    const now = Date.now();
    expect(isRemoteOidcTokenRefreshRequired({}, now)).toBe(true);
    expect(isRemoteOidcTokenRefreshRequired({ accessToken: 'a1' }, now)).toBe(false);
    expect(
      isRemoteOidcTokenRefreshRequired(
        {
          accessToken: 'a1',
          accessTokenExpiresAt: now + OIDC_ACCESS_TOKEN_REFRESH_WINDOW_MS + 60_000,
        },
        now,
      ),
    ).toBe(false);
    expect(
      isRemoteOidcTokenRefreshRequired(
        {
          accessToken: 'a1',
          accessTokenExpiresAt: now + OIDC_ACCESS_TOKEN_REFRESH_WINDOW_MS - 10,
        },
        now,
      ),
    ).toBe(true);
  });

  test('createMutableOidcState keeps token fields non-enumerable and redacts JSON output', () => {
    const backing: {
      accessToken?: string;
      refreshToken?: string;
      accessTokenExpiresAt?: number;
      deviceCodeCompleted?: boolean;
    } = {
      accessToken: 'access-secret',
      refreshToken: 'refresh-secret',
      accessTokenExpiresAt: 12345,
      deviceCodeCompleted: true,
    };

    const state = createMutableOidcState({
      getAccessToken: () => backing.accessToken,
      setAccessToken: (value) => {
        backing.accessToken = value;
      },
      getRefreshToken: () => backing.refreshToken,
      setRefreshToken: (value) => {
        backing.refreshToken = value;
      },
      getAccessTokenExpiresAt: () => backing.accessTokenExpiresAt,
      setAccessTokenExpiresAt: (value) => {
        backing.accessTokenExpiresAt = value;
      },
      getDeviceCodeCompleted: () => backing.deviceCodeCompleted,
      setDeviceCodeCompleted: (value) => {
        backing.deviceCodeCompleted = value;
      },
    });

    expect(state.accessToken).toBe('access-secret');
    expect(state.refreshToken).toBe('refresh-secret');
    state.accessToken = 'rotated-access';
    state.refreshToken = 'rotated-refresh';
    expect(backing.accessToken).toBe('rotated-access');
    expect(backing.refreshToken).toBe('rotated-refresh');

    expect(Object.keys(state)).not.toContain('accessToken');
    expect(Object.keys(state)).not.toContain('refreshToken');

    const serialized = JSON.stringify(state);
    expect(serialized).toContain('"accessToken":"[REDACTED]"');
    expect(serialized).toContain('"refreshToken":"[REDACTED]"');
    expect(serialized).not.toContain('rotated-access');
    expect(serialized).not.toContain('rotated-refresh');

    const inspectValue = (state as any)[Symbol.for('nodejs.util.inspect.custom')]();
    expect(inspectValue).toEqual(
      expect.objectContaining({
        accessToken: '[REDACTED]',
        refreshToken: '[REDACTED]',
      }),
    );
  });

  test('createMutableOidcState keeps token values undefined when not configured', () => {
    const backing: {
      accessToken?: string;
      refreshToken?: string;
      accessTokenExpiresAt?: number;
      deviceCodeCompleted?: boolean;
    } = {};

    const state = createMutableOidcState({
      getAccessToken: () => backing.accessToken,
      setAccessToken: (value) => {
        backing.accessToken = value;
      },
      getRefreshToken: () => backing.refreshToken,
      setRefreshToken: (value) => {
        backing.refreshToken = value;
      },
      getAccessTokenExpiresAt: () => backing.accessTokenExpiresAt,
      setAccessTokenExpiresAt: (value) => {
        backing.accessTokenExpiresAt = value;
      },
      getDeviceCodeCompleted: () => backing.deviceCodeCompleted,
      setDeviceCodeCompleted: (value) => {
        backing.deviceCodeCompleted = value;
      },
    });

    expect((state as any).toJSON()).toEqual({
      accessToken: undefined,
      refreshToken: undefined,
      accessTokenExpiresAt: undefined,
      deviceCodeCompleted: undefined,
    });
  });
});
