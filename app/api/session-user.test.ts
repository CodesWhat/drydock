import { deserializeSessionUser } from './session-user.js';

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
