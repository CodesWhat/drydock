import {
  deserializeSessionUser,
  readSessionUsername,
  serializeSessionUser,
} from './session-user.js';

const SUBJECT_ID = 'a'.repeat(64);

function v2Local(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    v: 2,
    kind: 'local',
    username: 'alice',
    subjectId: SUBJECT_ID,
    providerId: 'basic.default',
    assurance: 'password',
    factorVersion: 0,
    ...overrides,
  });
}

describe('deserializeSessionUser', () => {
  test('throws when input is not a string', () => {
    expect(() => deserializeSessionUser(42)).toThrow('Serialized user must be a JSON string');
    expect(() => deserializeSessionUser(null)).toThrow('Serialized user must be a JSON string');
    expect(() => deserializeSessionUser(undefined)).toThrow(
      'Serialized user must be a JSON string',
    );
    expect(() => deserializeSessionUser({ username: 'alice' })).toThrow(
      'Serialized user must be a JSON string',
    );
  });

  test('throws when input is malformed JSON', () => {
    expect(() => deserializeSessionUser('not-json')).toThrow('Serialized user JSON is malformed');
  });

  test('throws when parsed value fails schema validation (missing username)', () => {
    expect(() => deserializeSessionUser('{}')).toThrow();
  });

  test('throws when convert is effectively false: numeric username is rejected', () => {
    // If convert were true, Joi would coerce numbers to strings.
    // With convert: false, a numeric username should fail validation.
    expect(() => deserializeSessionUser('{"username": 42}')).toThrow();
  });

  test('throws when stripUnknown is effectively false: extra fields cause validation error', () => {
    // With stripUnknown: false and unknown(false), extra fields trigger an error.
    expect(() => deserializeSessionUser('{"username":"alice","extra":"field"}')).toThrow();
  });

  test('returns deserialized user with valid input', () => {
    const result = deserializeSessionUser('{"username":"alice"}');
    expect(result).toEqual({ username: 'alice' });
  });
});

describe('session user schema v2', () => {
  test('deserializes a local identity with its subject fields', () => {
    expect(deserializeSessionUser(v2Local())).toEqual({
      username: 'alice',
      identity: {
        type: 'local',
        subjectId: SUBJECT_ID,
        providerId: 'basic.default',
        assurance: 'password',
        factorVersion: 0,
      },
    });
  });

  test('deserializes an OIDC identity', () => {
    expect(deserializeSessionUser('{"v":2,"kind":"oidc","username":"alice"}')).toEqual({
      username: 'alice',
      identity: { type: 'oidc' },
    });
  });

  test.each([
    ['an unknown version', v2Local({ v: 3 })],
    ['an unknown kind', v2Local({ kind: 'saml' })],
    ['a missing subject id', v2Local({ subjectId: undefined })],
    ['a subject id that is not a sha256 hex digest', v2Local({ subjectId: 'ABC' })],
    ['an empty provider id', v2Local({ providerId: '' })],
    ['an unknown assurance', v2Local({ assurance: 'sms' })],
    ['a negative factor version', v2Local({ factorVersion: -1 })],
    ['a fractional factor version', v2Local({ factorVersion: 1.5 })],
    ['a string factor version', v2Local({ factorVersion: '1' })],
    ['an extra field', v2Local({ extra: true })],
    ['an empty username', v2Local({ username: '' })],
    [
      'an OIDC identity with subject fields',
      '{"v":2,"kind":"oidc","username":"a","subjectId":"x"}',
    ],
  ])('rejects %s', (_name, serialized) => {
    expect(() => deserializeSessionUser(serialized)).toThrow();
  });

  test('rejects a JSON value that is not an object', () => {
    expect(() => deserializeSessionUser('null')).toThrow();
    expect(() => deserializeSessionUser('[]')).toThrow();
    expect(() => deserializeSessionUser('"alice"')).toThrow();
  });
});

describe('serializeSessionUser', () => {
  test('writes the legacy shape byte for byte when there is no identity', () => {
    expect(serializeSessionUser({ username: 'alice' })).toBe('{"username":"alice"}');
  });

  test('writes a deterministic v2 local payload', () => {
    const user = {
      username: 'alice',
      identity: {
        type: 'local' as const,
        subjectId: SUBJECT_ID,
        providerId: 'basic.default',
        assurance: 'password' as const,
        factorVersion: 0,
      },
    };

    expect(serializeSessionUser(user)).toBe(v2Local());
    expect(deserializeSessionUser(serializeSessionUser(user))).toEqual(user);
  });

  test('writes a v2 OIDC payload', () => {
    expect(serializeSessionUser({ username: 'alice', identity: { type: 'oidc' } })).toBe(
      '{"v":2,"kind":"oidc","username":"alice"}',
    );
  });
});

describe('readSessionUsername', () => {
  test.each([
    ['a legacy string', '{"username":"alice"}'],
    ['a v2 local string', v2Local()],
    ['a v2 OIDC string', '{"v":2,"kind":"oidc","username":"alice"}'],
    ['a stored object', { username: 'alice' }],
    ['a stored v2 object', JSON.parse(v2Local())],
  ])('reads the username from %s', (_name, raw) => {
    expect(readSessionUsername(raw)).toBe('alice');
  });

  test.each([
    ['undefined', undefined],
    ['null', null],
    ['a number', 42],
    ['malformed JSON', 'not-json'],
    ['a JSON array', '[]'],
    ['an empty username', '{"username":""}'],
    ['a numeric username', '{"username":42}'],
    ['a schema-invalid v2 payload', v2Local({ assurance: 'sms' })],
  ])('returns undefined for %s', (_name, raw) => {
    expect(readSessionUsername(raw)).toBeUndefined();
  });
});
