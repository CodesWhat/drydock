import { createHash } from 'node:crypto';

const { mockGetSubjectVersion, mockGetFactorBySubject, mockHasEnrolledUsername, mockWarn } =
  vi.hoisted(() => ({
    mockGetSubjectVersion: vi.fn(),
    mockHasEnrolledUsername: vi.fn(),
    mockGetFactorBySubject: vi.fn(),
    mockWarn: vi.fn(),
  }));

vi.mock('../store/totp.js', () => ({
  getSubjectVersion: mockGetSubjectVersion,
  getFactorBySubject: mockGetFactorBySubject,
  hasEnrolledUsername: mockHasEnrolledUsername,
}));

vi.mock('../log/index.js', () => ({
  default: { warn: mockWarn, info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import {
  checkSessionIdentity,
  deriveSubjectId,
  isSecondFactorRequired,
  resolveLocalIdentity,
} from './totp-identity.js';

function digest(providerId: string, username: string): string {
  return createHash('sha256').update(`${providerId}\0${username}`, 'utf8').digest('hex');
}

function localIdentity(overrides: Record<string, unknown> = {}) {
  return {
    type: 'local' as const,
    subjectId: deriveSubjectId('basic.default', 'alice'),
    providerId: 'basic.default',
    assurance: 'password' as const,
    factorVersion: 0,
    ...overrides,
  };
}

describe('totp-identity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasEnrolledUsername.mockReturnValue(false);
    mockGetSubjectVersion.mockReturnValue(0);
    mockGetFactorBySubject.mockReturnValue(undefined);
  });

  describe('deriveSubjectId', () => {
    test('is the sha256 hex of providerId, a NUL, and the exact username', () => {
      expect(deriveSubjectId('basic.default', 'alice')).toBe(digest('basic.default', 'alice'));
    });

    test('differs across providers sharing a username', () => {
      expect(deriveSubjectId('basic.one', 'alice')).not.toBe(deriveSubjectId('basic.two', 'alice'));
    });

    test('is case and whitespace exact', () => {
      expect(deriveSubjectId('basic.default', 'Alice')).not.toBe(
        deriveSubjectId('basic.default', 'alice'),
      );
      expect(deriveSubjectId('basic.default', 'alice ')).not.toBe(
        deriveSubjectId('basic.default', 'alice'),
      );
    });
  });

  describe('resolveLocalIdentity', () => {
    test('returns password assurance at the stored subject version', () => {
      mockGetSubjectVersion.mockReturnValue(3);

      expect(resolveLocalIdentity('basic.default', 'alice')).toEqual({
        subjectId: deriveSubjectId('basic.default', 'alice'),
        providerId: 'basic.default',
        assurance: 'password',
        factorVersion: 3,
      });
      expect(mockGetSubjectVersion).toHaveBeenCalledWith(deriveSubjectId('basic.default', 'alice'));
    });
  });

  describe('checkSessionIdentity', () => {
    test('an OIDC session is valid and never touches the store', () => {
      expect(checkSessionIdentity({ username: 'alice', identity: { type: 'oidc' } })).toBe('valid');
      expect(mockGetSubjectVersion).not.toHaveBeenCalled();
    });

    test('a legacy session is valid while no stored row for its username has a version', () => {
      expect(checkSessionIdentity({ username: 'alice' })).toBe('valid');
      expect(mockHasEnrolledUsername).toHaveBeenCalledWith('alice');
      expect(mockGetSubjectVersion).not.toHaveBeenCalled();
    });

    test('a legacy session is stale once a stored row for its username has a version, whatever providers are configured', () => {
      mockHasEnrolledUsername.mockReturnValue(true);

      expect(checkSessionIdentity({ username: 'alice' })).toBe('stale');
    });

    test('a local session at the current version with no factor is valid with one store read', () => {
      expect(checkSessionIdentity({ username: 'alice', identity: localIdentity() })).toBe('valid');
      expect(mockGetSubjectVersion).toHaveBeenCalledTimes(1);
      expect(mockGetFactorBySubject).not.toHaveBeenCalled();
    });

    test('a local session whose version differs is stale', () => {
      mockGetSubjectVersion.mockReturnValue(1);

      expect(checkSessionIdentity({ username: 'alice', identity: localIdentity() })).toBe('stale');
    });

    test('a local session newer than the store is stale', () => {
      expect(
        checkSessionIdentity({ username: 'alice', identity: localIdentity({ factorVersion: 4 }) }),
      ).toBe('stale');
    });

    test('a local password session is stale while a factor is active', () => {
      mockGetSubjectVersion.mockReturnValue(1);
      mockGetFactorBySubject.mockReturnValue({ factorId: 'f' });

      expect(
        checkSessionIdentity({ username: 'alice', identity: localIdentity({ factorVersion: 1 }) }),
      ).toBe('stale');
    });

    test.each(['totp', 'recovery'] as const)(
      'a local %s session is valid while a factor is active',
      (assurance) => {
        mockGetSubjectVersion.mockReturnValue(1);
        mockGetFactorBySubject.mockReturnValue({ factorId: 'f' });

        expect(
          checkSessionIdentity({
            username: 'alice',
            identity: localIdentity({ factorVersion: 1, assurance }),
          }),
        ).toBe('valid');
      },
    );

    test('a local password session is valid after the factor was removed at the same version', () => {
      mockGetSubjectVersion.mockReturnValue(2);
      mockGetFactorBySubject.mockReturnValue(undefined);

      expect(
        checkSessionIdentity({ username: 'alice', identity: localIdentity({ factorVersion: 2 }) }),
      ).toBe('valid');
    });

    test('a local session whose subject id does not match its provider and username is stale', () => {
      expect(
        checkSessionIdentity({
          username: 'alice',
          identity: localIdentity({ subjectId: deriveSubjectId('basic.default', 'mallory') }),
        }),
      ).toBe('stale');
      expect(mockGetSubjectVersion).not.toHaveBeenCalled();
    });

    test('a store failure is unavailable, warns, and never leaks the error text', () => {
      mockHasEnrolledUsername.mockImplementation(() => {
        throw new Error('totp collection not initialized');
      });

      expect(checkSessionIdentity({ username: 'alice' })).toBe('unavailable');
      expect(mockWarn).toHaveBeenCalledWith(
        'Unable to check session subject version (totp collection not initialized)',
      );
    });
  });

  describe('isSecondFactorRequired', () => {
    test('is true only while the subject has an active factor row', () => {
      mockGetFactorBySubject.mockReturnValueOnce({ factorId: 'f' });
      expect(isSecondFactorRequired('subject')).toBe(true);
      expect(mockGetFactorBySubject).toHaveBeenCalledWith('subject');

      mockGetFactorBySubject.mockReturnValueOnce(undefined);
      expect(isSecondFactorRequired('subject')).toBe(false);
    });

    test('lets a store fault propagate rather than answering "no factor"', () => {
      mockGetFactorBySubject.mockImplementationOnce(() => {
        throw new Error('totp collection not initialized');
      });
      expect(() => isSecondFactorRequired('subject')).toThrow('not initialized');
    });
  });
});
