import type { Application, Request, Response } from 'express';
import type { Strategy } from 'passport';
import { describe, expect, type Mock, test, vi } from 'vitest';
import type Authentication from '../authentications/providers/Authentication.js';
import type { StrategyDescription } from '../authentications/providers/Authentication.js';

const {
  mockPassportUse,
  mockGetState,
  mockGetAuthenticationRegistrationErrors,
  mockGetRegistrationWarnings,
} = vi.hoisted(() => ({
  mockPassportUse: vi.fn(),
  mockGetState: vi.fn(),
  mockGetAuthenticationRegistrationErrors: vi.fn().mockReturnValue([]),
  mockGetRegistrationWarnings: vi.fn().mockReturnValue([]),
}));

vi.mock('passport', () => ({
  default: { use: mockPassportUse },
}));

vi.mock('../registry/index.js', () => ({
  getState: mockGetState,
  getAuthenticationRegistrationErrors: mockGetAuthenticationRegistrationErrors,
  getRegistrationWarnings: mockGetRegistrationWarnings,
}));

vi.mock('../log/index.js', () => ({
  default: {
    child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
    warn: vi.fn(),
  },
}));

import {
  getAllIds,
  getAuthStatus,
  getLogoutRedirectUrl,
  getStrategies,
  registerStrategies,
  resetStrategyIdsForTests,
} from './auth-strategies.js';

function createMockAuthentication(overrides: {
  id: string;
  strategy?: Strategy;
  description: StrategyDescription;
  throwOnGetStrategy?: boolean;
}): Authentication {
  return {
    getId: () => overrides.id,
    getStrategy: overrides.throwOnGetStrategy
      ? () => {
          throw new Error('strategy error');
        }
      : () => overrides.strategy ?? ({} as Strategy),
    getStrategyDescription: () => overrides.description,
  } as unknown as Authentication;
}

function createMockResponse(): Response {
  const res = { json: vi.fn() };
  return res as unknown as Response;
}

describe('auth-strategies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStrategyIdsForTests();
  });

  describe('getAllIds', () => {
    test('returns empty array initially', () => {
      expect(getAllIds()).toEqual([]);
    });

    test('returns a copy of the strategy IDs array', () => {
      const auth = createMockAuthentication({
        id: 'basic.local',
        description: { type: 'basic', name: 'Local' },
      });
      mockGetState.mockReturnValue({ authentication: { local: auth } });

      registerStrategies({} as Application);

      const ids = getAllIds();
      ids.push('mutated');
      expect(getAllIds()).toEqual(['basic.local']);
    });
  });

  describe('registerStrategies', () => {
    test('registers each authentication strategy with passport', () => {
      const strategy = {} as Strategy;
      const auth = createMockAuthentication({
        id: 'basic.local',
        strategy,
        description: { type: 'basic', name: 'Local' },
      });
      mockGetState.mockReturnValue({ authentication: { local: auth } });

      registerStrategies({} as Application);

      expect(mockPassportUse).toHaveBeenCalledWith('basic.local', strategy);
      expect(getAllIds()).toEqual(['basic.local']);
    });

    test('registers multiple strategies', () => {
      const auth1 = createMockAuthentication({
        id: 'basic.local',
        description: { type: 'basic', name: 'Local' },
      });
      const auth2 = createMockAuthentication({
        id: 'oidc.google',
        description: { type: 'oidc', name: 'Google' },
      });
      mockGetState.mockReturnValue({ authentication: { local: auth1, google: auth2 } });

      registerStrategies({} as Application);

      expect(mockPassportUse).toHaveBeenCalledTimes(2);
      expect(getAllIds()).toEqual(['basic.local', 'oidc.google']);
    });

    test('catches and logs errors from getStrategy without crashing', () => {
      const auth = createMockAuthentication({
        id: 'broken.auth',
        throwOnGetStrategy: true,
        description: { type: 'basic', name: 'Broken' },
      });
      mockGetState.mockReturnValue({ authentication: { broken: auth } });

      registerStrategies({} as Application);

      expect(mockPassportUse).not.toHaveBeenCalled();
      expect(getAllIds()).toEqual([]);
    });

    test('registers healthy strategies even when one fails', () => {
      const healthy = createMockAuthentication({
        id: 'basic.local',
        description: { type: 'basic', name: 'Local' },
      });
      const broken = createMockAuthentication({
        id: 'broken.auth',
        throwOnGetStrategy: true,
        description: { type: 'basic', name: 'Broken' },
      });
      mockGetState.mockReturnValue({ authentication: { local: healthy, broken } });

      registerStrategies({} as Application);

      expect(mockPassportUse).toHaveBeenCalledTimes(1);
      expect(getAllIds()).toEqual(['basic.local']);
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

  describe('resetStrategyIdsForTests', () => {
    test('clears strategy IDs', () => {
      const auth = createMockAuthentication({
        id: 'basic.local',
        description: { type: 'basic', name: 'Local' },
      });
      mockGetState.mockReturnValue({ authentication: { local: auth } });
      registerStrategies({} as Application);
      expect(getAllIds()).toHaveLength(1);

      resetStrategyIdsForTests();

      expect(getAllIds()).toEqual([]);
    });
  });
});
