/**
 * Tests for the orphaned-factor guard, on the real TOTP store and the real
 * authenticator chain: what counts as orphaned is which subjects something
 * registered can still sign in.
 */
const { mockLog } = vi.hoisted(() => ({
  mockLog: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(), child: vi.fn() },
}));

vi.mock('../log/index.js', () => {
  mockLog.child.mockReturnValue(mockLog);
  return { default: mockLog };
});

import type { Database } from '../store/db/driver.js';
import * as totpStore from '../store/totp.js';
import { createMigratedMemoryDatabase } from '../test/sqlite-db.js';
import {
  type Authenticator,
  clearAuthenticators,
  registerAuthenticator,
} from './authenticator-chain.js';
import { deriveSubjectId } from './totp-identity.js';
import { enrollFactor, keyringOf, OLD_KEY } from './totp-offline.test.helpers.js';
import { assertNotShadowedByOrphanedFactor, listOrphanedFactors } from './totp-orphans.js';

const keyring = keyringOf({ k1: OLD_KEY }, 'k1');

let db: Database;

function registerAccount(providerId: string, username: string): string {
  const subjectId = deriveSubjectId(providerId, username);
  registerAuthenticator({
    id: providerId,
    persistsSession: false,
    localSubjectId: subjectId,
    authenticate: async () => undefined,
  } satisfies Authenticator);
  return subjectId;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLog.child.mockReturnValue(mockLog);
  db = createMigratedMemoryDatabase();
  totpStore.createCollections(db);
  clearAuthenticators();
  // The session authenticator: registered, and no local account of its own.
  registerAuthenticator({
    id: 'session',
    persistsSession: true,
    authenticate: async () => undefined,
  });
});

afterEach(() => {
  clearAuthenticators();
  db.close();
});

describe('which factors are orphaned', () => {
  test('none when nothing is enrolled', () => {
    registerAccount('basic.eve', 'eve');

    expect(listOrphanedFactors()).toEqual([]);
  });

  test('none while every factor belongs to an account that can still sign in', () => {
    registerAccount('basic.eve', 'eve');
    registerAccount('basic.bob', 'bob');
    enrollFactor('basic.eve', 'eve', keyring);
    enrollFactor('basic.bob', 'bob', keyring);

    expect(listOrphanedFactors()).toEqual([]);
  });

  test.each([
    ['its provider was renamed', 'basic.evelyn', 'eve'],
    ['its username was changed', 'basic.eve', 'evelyn'],
    ['both were changed', 'basic.evelyn', 'evelyn'],
  ])('a factor is orphaned when %s', (_label, providerId, username) => {
    const enrolled = enrollFactor('basic.eve', 'eve', keyring);
    registerAccount(providerId, username);

    expect(listOrphanedFactors().map((factor) => factor.factorId)).toEqual([enrolled.factorId]);
  });

  test('a factor is orphaned when its account was removed and nothing is registered', () => {
    const enrolled = enrollFactor('basic.eve', 'eve', keyring);

    expect(listOrphanedFactors().map((factor) => factor.factorId)).toEqual([enrolled.factorId]);
  });
});

describe('signing in beside an orphaned factor', () => {
  test('an account with no factor signs in as before when nothing is orphaned', () => {
    const guest = registerAccount('basic.guest', 'guest');
    registerAccount('basic.eve', 'eve');
    enrollFactor('basic.eve', 'eve', keyring);

    expect(() => assertNotShadowedByOrphanedFactor(guest)).not.toThrow();
    expect(mockLog.error).not.toHaveBeenCalled();
  });

  test('an account with no factor is refused: it may be the renamed owner of the orphan', () => {
    const orphan = enrollFactor('basic.eve', 'eve', keyring);
    const renamed = registerAccount('basic.evelyn', 'eve');

    expect(() => assertNotShadowedByOrphanedFactor(renamed)).toThrow(
      expect.objectContaining({ name: 'OrphanedFactorError', status: 503 }),
    );
    expect(mockLog.error).toHaveBeenCalledWith(
      expect.stringContaining(`provider=basic.eve subject=${orphan.subjectId}`),
    );
    expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining('totp rebind'));
  });

  test('an unrelated account with no factor is refused too: nothing tells it from the renamed one', () => {
    enrollFactor('basic.eve', 'eve', keyring);
    const guest = registerAccount('basic.guest', 'guest');

    expect(() => assertNotShadowedByOrphanedFactor(guest)).toThrow(
      expect.objectContaining({ name: 'OrphanedFactorError' }),
    );
  });

  test('an account with a factor of its own is never refused: it proves itself with that', () => {
    enrollFactor('basic.eve', 'eve', keyring);
    const bob = registerAccount('basic.bob', 'bob');
    enrollFactor('basic.bob', 'bob', keyring);

    expect(() => assertNotShadowedByOrphanedFactor(bob)).not.toThrow();
  });

  test('the refusal names how many factors are orphaned and never a username', () => {
    enrollFactor('basic.eve', 'private-name', keyring);
    enrollFactor('basic.gone', 'private-name', keyring);
    const guest = registerAccount('basic.guest', 'guest');

    expect(() => assertNotShadowedByOrphanedFactor(guest)).toThrow(
      'Local sign-in is refused: 2 two-factor factor(s) belong to accounts that are no longer configured',
    );
    expect(JSON.stringify(mockLog.error.mock.calls)).not.toContain('private-name');
  });

  test('a store that cannot answer is a fault, not a pass', () => {
    const guest = registerAccount('basic.guest', 'guest');
    db.exec('ALTER TABLE totp_factors RENAME TO totp_factors_away');

    expect(() => assertNotShadowedByOrphanedFactor(guest)).toThrow();
  });
});
