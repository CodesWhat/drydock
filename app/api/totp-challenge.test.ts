vi.mock('../store/totp.js', () => ({ countUnusedRecoveryCodes: vi.fn(() => 3) }));
vi.mock('./auth-audit.js', () => ({ recordLoginAuditEvent: vi.fn() }));

import {
  createLoginChallenge,
  deleteLoginChallenge,
  getLoginChallenge,
  getLoginChallengeCountForTests,
  LOGIN_CHALLENGE_MAX_ENTRIES,
  LOGIN_CHALLENGE_MAX_FAILED_ATTEMPTS,
  LOGIN_CHALLENGE_MAX_PER_SUBJECT,
  LOGIN_CHALLENGE_TTL_MS,
  recordLoginChallengeFailure,
  resetLoginChallengesForTests,
} from './totp-challenge.js';

const input = {
  subjectId: 'subject',
  providerId: 'basic.default',
  username: 'alice',
  factorVersion: 1,
  remember: false,
};

describe('login challenge store', () => {
  beforeEach(() => {
    resetLoginChallengesForTests();
  });

  test('hands back a 32-byte base64url id and a five minute expiry', () => {
    const created = createLoginChallenge(input, 1_000);

    expect(created?.id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created?.expiresAt).toBe(1_000 + LOGIN_CHALLENGE_TTL_MS);
    expect(LOGIN_CHALLENGE_TTL_MS).toBe(300_000);
  });

  test('ids are unique and the table holds a digest, never the id', () => {
    const first = createLoginChallenge(input);
    const second = createLoginChallenge(input);

    expect(first?.id).not.toBe(second?.id);
    expect(getLoginChallenge(first?.id as string)?.username).toBe('alice');
  });

  test('treats malformed, non-string and unknown ids alike', () => {
    createLoginChallenge(input);

    expect(getLoginChallenge('short')).toBeUndefined();
    expect(getLoginChallenge('!'.repeat(43))).toBeUndefined();
    expect(getLoginChallenge(undefined as never)).toBeUndefined();
    expect(getLoginChallenge('a'.repeat(43))).toBeUndefined();
    expect(deleteLoginChallenge('short')).toBe(false);
    expect(deleteLoginChallenge(42 as never)).toBe(false);
    expect(deleteLoginChallenge('a'.repeat(43))).toBe(false);
  });

  test('an expired challenge reads as absent and is removed', () => {
    const created = createLoginChallenge(input, 0);

    expect(getLoginChallenge(created?.id as string, LOGIN_CHALLENGE_TTL_MS - 1)).toBeDefined();
    expect(getLoginChallenge(created?.id as string, LOGIN_CHALLENGE_TTL_MS)).toBeUndefined();
    expect(getLoginChallengeCountForTests()).toBe(0);
  });

  test('delete reports whether this call removed it, so only one caller wins', () => {
    const created = createLoginChallenge(input);

    expect(deleteLoginChallenge(created?.id as string)).toBe(true);
    expect(deleteLoginChallenge(created?.id as string)).toBe(false);
  });

  test('the fifth failed attempt removes the challenge, the fourth does not', () => {
    const created = createLoginChallenge(input);
    const challenge = getLoginChallenge(created?.id as string);
    if (!challenge) {
      throw new Error('challenge missing');
    }

    for (let attempt = 1; attempt < LOGIN_CHALLENGE_MAX_FAILED_ATTEMPTS; attempt += 1) {
      recordLoginChallengeFailure(created?.id as string, challenge);
      expect(getLoginChallenge(created?.id as string)).toBeDefined();
    }
    recordLoginChallengeFailure(created?.id as string, challenge);

    expect(LOGIN_CHALLENGE_MAX_FAILED_ATTEMPTS).toBe(5);
    expect(getLoginChallenge(created?.id as string)).toBeUndefined();
  });

  test('caps live challenges at 5,000 and refuses rather than evicting', () => {
    const first = createLoginChallenge(input, 0);
    for (let index = 1; index < LOGIN_CHALLENGE_MAX_ENTRIES; index += 1) {
      expect(createLoginChallenge({ ...input, subjectId: `subject-${index}` }, 0)).toBeDefined();
    }

    expect(LOGIN_CHALLENGE_MAX_ENTRIES).toBe(5000);
    expect(createLoginChallenge(input, 1)).toBeUndefined();
    expect(getLoginChallengeCountForTests()).toBe(5000);
    expect(getLoginChallenge(first?.id as string, 1)).toBeDefined();
  });

  test('a full table makes room by sweeping expired entries, oldest first, and stops at the first live one', () => {
    for (let index = 0; index < LOGIN_CHALLENGE_MAX_ENTRIES - 1; index += 1) {
      createLoginChallenge({ ...input, subjectId: `subject-${index}` }, 0);
    }
    const live = createLoginChallenge({ ...input, subjectId: 'live' }, 1_000);
    expect(getLoginChallengeCountForTests()).toBe(5000);

    const afterExpiry = createLoginChallenge(input, LOGIN_CHALLENGE_TTL_MS + 1);

    expect(afterExpiry).toBeDefined();
    expect(getLoginChallengeCountForTests()).toBe(2);
    expect(getLoginChallenge(live?.id as string, LOGIN_CHALLENGE_TTL_MS + 1)).toBeDefined();
  });

  describe('per-subject cap', () => {
    test('a subject holds at most five live challenges and a sixth replaces its oldest', () => {
      expect(LOGIN_CHALLENGE_MAX_PER_SUBJECT).toBe(5);
      const created = Array.from({ length: 5 }, (_, index) => createLoginChallenge(input, index));

      const sixth = createLoginChallenge(input, 10);

      expect(sixth).toBeDefined();
      expect(getLoginChallengeCountForTests()).toBe(5);
      expect(getLoginChallenge(created[0]?.id as string, 11)).toBeUndefined();
      for (const survivor of created.slice(1)) {
        expect(getLoginChallenge(survivor?.id as string, 11)).toBeDefined();
      }
      expect(getLoginChallenge(sixth?.id as string, 11)).toBeDefined();
    });

    test('one subject cannot push out another subject’s challenge', () => {
      const other = createLoginChallenge({ ...input, subjectId: 'other' }, 0);
      for (let index = 0; index < 50; index += 1) {
        createLoginChallenge(input, index + 1);
      }

      expect(getLoginChallenge(other?.id as string, 100)).toBeDefined();
      expect(getLoginChallengeCountForTests()).toBe(LOGIN_CHALLENGE_MAX_PER_SUBJECT + 1);
    });

    test('replacing within the subject still works when the table as a whole is full', () => {
      for (let index = 0; index < LOGIN_CHALLENGE_MAX_ENTRIES - 5; index += 1) {
        createLoginChallenge({ ...input, subjectId: `subject-${index}` }, 0);
      }
      for (let index = 0; index < 5; index += 1) {
        createLoginChallenge(input, 0);
      }
      expect(getLoginChallengeCountForTests()).toBe(LOGIN_CHALLENGE_MAX_ENTRIES);

      expect(createLoginChallenge(input, 1)).toBeDefined();
      expect(getLoginChallengeCountForTests()).toBe(LOGIN_CHALLENGE_MAX_ENTRIES);
      expect(createLoginChallenge({ ...input, subjectId: 'newcomer' }, 1)).toBeUndefined();
    });
  });
});
