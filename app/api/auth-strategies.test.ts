import type { Application, Request, Response } from 'express';
import { describe, expect, type Mock, test, vi } from 'vitest';
import type Authentication from '../authentications/providers/Authentication.js';
import type { StrategyDescription } from '../authentications/providers/Authentication.js';
import type { Authenticator } from './authenticator-chain.js';

const {
  mockGetState,
  mockGetAuthenticationRegistrationErrors,
  mockGetRegistrationWarnings,
  mockWarn,
} = vi.hoisted(() => ({
  mockGetState: vi.fn(),
  mockGetAuthenticationRegistrationErrors: vi.fn().mockReturnValue([]),
  mockGetRegistrationWarnings: vi.fn().mockReturnValue([]),
  mockWarn: vi.fn(),
}));

vi.mock('../registry/index.js', () => ({
  getState: mockGetState,
  getAuthenticationRegistrationErrors: mockGetAuthenticationRegistrationErrors,
  getRegistrationWarnings: mockGetRegistrationWarnings,
}));

vi.mock('../log/index.js', () => ({
  default: {
    child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
    warn: mockWarn,
  },
}));

import { API_KEY_AUTHENTICATOR_ID } from './api-key-auth.js';
import {
  getAuthStatus,
  getLogoutRedirectUrl,
  getStrategies,
  isAuthenticationReady,
  registerAuthenticators,
  resetAuthenticatorsForTests,
} from './auth-strategies.js';
import { getAuthenticators } from './authenticator-chain.js';
import { SESSION_AUTHENTICATOR_ID } from './session-principal.js';

function createAuthenticator(id: string): Authenticator {
  return {
    id,
    persistsSession: false,
    authenticate: () => Promise.resolve(undefined),
  };
}

function createMockAuthentication(overrides: {
  id: string;
  description: StrategyDescription;
  throwOnGetAuthenticator?: boolean;
}): Authentication {
  return {
    getId: () => overrides.id,
    getAuthenticator: overrides.throwOnGetAuthenticator
      ? () => {
          throw new Error('strategy error');
        }
      : () => createAuthenticator(overrides.id),
    getStrategyDescription: () => overrides.description,
  } as unknown as Authentication;
}

function createMockResponse(): Response {
  const res = { json: vi.fn() };
  return res as unknown as Response;
}

function getRegisteredIds(): string[] {
  return getAuthenticators().map((authenticator) => authenticator.id);
}

describe('auth-strategies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAuthenticatorsForTests();
  });

  describe('registerAuthenticators', () => {
    test('puts the session authenticator after every provider', () => {
      const auth = createMockAuthentication({
        id: 'basic.local',
        description: { type: 'basic', name: 'Local' },
      });
      mockGetState.mockReturnValue({ authentication: { local: auth } });

      registerAuthenticators({} as Application);

      expect(getRegisteredIds()).toEqual([
        API_KEY_AUTHENTICATOR_ID,
        'basic.local',
        SESSION_AUTHENTICATOR_ID,
      ]);
    });

    test('registers multiple providers in registry order', () => {
      const auth1 = createMockAuthentication({
        id: 'basic.local',
        description: { type: 'basic', name: 'Local' },
      });
      const auth2 = createMockAuthentication({
        id: 'oidc.google',
        description: { type: 'oidc', name: 'Google' },
      });
      mockGetState.mockReturnValue({ authentication: { local: auth1, google: auth2 } });

      registerAuthenticators({} as Application);

      expect(getRegisteredIds()).toEqual([
        API_KEY_AUTHENTICATOR_ID,
        'basic.local',
        'oidc.google',
        SESSION_AUTHENTICATOR_ID,
      ]);
    });

    test('puts credentialless anonymous authentication after the session fallback', () => {
      const basic = createMockAuthentication({
        id: 'basic.local',
        description: { type: 'basic', name: 'Local' },
      });
      const anonymous = createMockAuthentication({
        id: 'anonymous',
        description: { type: 'anonymous', name: 'Anonymous' },
      });
      const oidc = createMockAuthentication({
        id: 'oidc.google',
        description: { type: 'oidc', name: 'Google' },
      });
      mockGetState.mockReturnValue({ authentication: { basic, anonymous, oidc } });

      registerAuthenticators({} as Application);

      expect(getRegisteredIds()).toEqual([
        API_KEY_AUTHENTICATOR_ID,
        'basic.local',
        'oidc.google',
        SESSION_AUTHENTICATOR_ID,
        'anonymous',
      ]);
    });

    test('catches and logs errors from getAuthenticator without crashing', () => {
      const auth = createMockAuthentication({
        id: 'broken.auth',
        throwOnGetAuthenticator: true,
        description: { type: 'basic', name: 'Broken' },
      });
      mockGetState.mockReturnValue({ authentication: { broken: auth } });

      registerAuthenticators({} as Application);

      expect(getRegisteredIds()).toEqual([API_KEY_AUTHENTICATOR_ID, SESSION_AUTHENTICATOR_ID]);
      expect(mockWarn).toHaveBeenCalledWith(
        'Unable to apply authentication broken.auth (strategy error)',
      );
    });

    test('registers healthy providers even when one fails', () => {
      const healthy = createMockAuthentication({
        id: 'basic.local',
        description: { type: 'basic', name: 'Local' },
      });
      const broken = createMockAuthentication({
        id: 'broken.auth',
        throwOnGetAuthenticator: true,
        description: { type: 'basic', name: 'Broken' },
      });
      mockGetState.mockReturnValue({ authentication: { local: healthy, broken } });

      registerAuthenticators({} as Application);

      expect(getRegisteredIds()).toEqual([
        API_KEY_AUTHENTICATOR_ID,
        'basic.local',
        SESSION_AUTHENTICATOR_ID,
      ]);
    });

    test('hands the express app to each provider so it can mount its routes', () => {
      const app = {} as Application;
      const getAuthenticator = vi.fn(() => createAuthenticator('oidc.google'));
      mockGetState.mockReturnValue({
        authentication: {
          google: {
            getId: () => 'oidc.google',
            getAuthenticator,
            getStrategyDescription: () => ({ type: 'oidc', name: 'Google' }),
          } as unknown as Authentication,
        },
      });

      registerAuthenticators(app);

      expect(getAuthenticator).toHaveBeenCalledWith(app);
    });
  });

  describe('isAuthenticationReady', () => {
    test('is false before anything is registered', () => {
      expect(isAuthenticationReady()).toBe(false);
    });

    test('is false when every provider failed and only the session entry survives', () => {
      const broken = createMockAuthentication({
        id: 'broken.auth',
        throwOnGetAuthenticator: true,
        description: { type: 'basic', name: 'Broken' },
      });
      mockGetState.mockReturnValue({ authentication: { broken } });

      registerAuthenticators({} as Application);

      expect(getRegisteredIds()).toEqual([API_KEY_AUTHENTICATOR_ID, SESSION_AUTHENTICATOR_ID]);
      expect(isAuthenticationReady()).toBe(false);
    });

    test('is true once a provider joins the chain', () => {
      const auth = createMockAuthentication({
        id: 'basic.local',
        description: { type: 'basic', name: 'Local' },
      });
      mockGetState.mockReturnValue({ authentication: { local: auth } });

      registerAuthenticators({} as Application);

      expect(isAuthenticationReady()).toBe(true);
    });
  });

  describe('getAuthStatus', () => {
    test('returns unique providers sorted by name and registration errors', () => {
      const auth1 = createMockAuthentication({
        id: 'basic.z-auth',
        description: { type: 'basic', name: 'Zulu' },
      });
      const auth2 = createMockAuthentication({
        id: 'oidc.alpha',
        description: { type: 'oidc', name: 'Alpha' },
      });
      mockGetState.mockReturnValue({ authentication: { z: auth1, a: auth2 } });
      const errors = [{ provider: 'bad', message: 'fail' }];
      mockGetAuthenticationRegistrationErrors.mockReturnValue(errors);

      const res = createMockResponse();
      getAuthStatus({} as Request, res);

      expect((res.json as Mock).mock.calls[0][0]).toEqual({
        providers: [
          { type: 'oidc', name: 'Alpha' },
          { type: 'basic', name: 'Zulu' },
        ],
        errors,
      });
    });

    test('deduplicates strategies with same type and name', () => {
      const auth1 = createMockAuthentication({
        id: 'basic.first',
        description: { type: 'basic', name: 'Local' },
      });
      const auth2 = createMockAuthentication({
        id: 'basic.second',
        description: { type: 'basic', name: 'Local' },
      });
      mockGetState.mockReturnValue({ authentication: { a: auth1, b: auth2 } });
      mockGetAuthenticationRegistrationErrors.mockReturnValue([]);

      const res = createMockResponse();
      getAuthStatus({} as Request, res);

      const payload = (res.json as Mock).mock.calls[0][0];
      expect(payload.providers).toHaveLength(1);
      expect(payload.providers[0]).toEqual({ type: 'basic', name: 'Local' });
    });

    test('returns empty providers when no authentication configured', () => {
      mockGetState.mockReturnValue({ authentication: {} });
      mockGetAuthenticationRegistrationErrors.mockReturnValue([]);

      const res = createMockResponse();
      getAuthStatus({} as Request, res);

      expect((res.json as Mock).mock.calls[0][0]).toEqual({
        providers: [],
        errors: [],
      });
    });
  });

  describe('getStrategies', () => {
    test('returns strategies with registration warnings', () => {
      const auth = createMockAuthentication({
        id: 'basic.local',
        description: { type: 'basic', name: 'Local' },
      });
      mockGetState.mockReturnValue({ authentication: { local: auth } });
      mockGetAuthenticationRegistrationErrors.mockReturnValue([]);
      mockGetRegistrationWarnings.mockReturnValue(['Warning: config missing']);

      const res = createMockResponse();
      getStrategies({} as Request, res);

      expect((res.json as Mock).mock.calls[0][0]).toEqual({
        strategies: [{ type: 'basic', name: 'Local' }],
        warnings: ['Warning: config missing'],
      });
    });
  });

  describe('getLogoutRedirectUrl', () => {
    test('returns logoutUrl from first strategy that has one', () => {
      const auth1 = createMockAuthentication({
        id: 'basic.local',
        description: { type: 'basic', name: 'Local' },
      });
      const auth2 = createMockAuthentication({
        id: 'oidc.google',
        description: {
          type: 'oidc',
          name: 'Google',
          logoutUrl: 'https://accounts.google.com/logout',
        },
      });
      mockGetState.mockReturnValue({ authentication: { local: auth1, google: auth2 } });

      expect(getLogoutRedirectUrl()).toBe('https://accounts.google.com/logout');
    });

    test('returns undefined when no strategy has a logoutUrl', () => {
      const auth = createMockAuthentication({
        id: 'basic.local',
        description: { type: 'basic', name: 'Local' },
      });
      mockGetState.mockReturnValue({ authentication: { local: auth } });

      expect(getLogoutRedirectUrl()).toBeUndefined();
    });

    test('returns undefined when no authentication configured', () => {
      mockGetState.mockReturnValue({ authentication: {} });

      expect(getLogoutRedirectUrl()).toBeUndefined();
    });
  });

  describe('resetAuthenticatorsForTests', () => {
    test('empties the chain', () => {
      const auth = createMockAuthentication({
        id: 'basic.local',
        description: { type: 'basic', name: 'Local' },
      });
      mockGetState.mockReturnValue({ authentication: { local: auth } });
      registerAuthenticators({} as Application);
      expect(getAuthenticators()).toHaveLength(3);

      resetAuthenticatorsForTests();

      expect(getAuthenticators()).toEqual([]);
    });
  });
});
