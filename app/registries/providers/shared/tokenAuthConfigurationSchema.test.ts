import Joi from 'joi';
import { getTokenAuthConfigurationSchema } from './tokenAuthConfigurationSchema.js';

describe('getTokenAuthConfigurationSchema', () => {
  test('accepts empty string credentials', () => {
    const schema = getTokenAuthConfigurationSchema(Joi);
    expect(schema.validate('').error).toBeUndefined();
  });

  test('accepts empty object (no credentials)', () => {
    // The joi.object().max(0) alternative allows {}
    const schema = getTokenAuthConfigurationSchema(Joi);
    expect(schema.validate({}).error).toBeUndefined();
  });

  test('accepts login and password together', () => {
    // Kills: ObjectLiteral {} at line 9 — if keys({}) were used instead of the full keyset,
    // the forbidden() constraints would not apply and mixed inputs could sneak through.
    const schema = getTokenAuthConfigurationSchema(Joi);
    expect(schema.validate({ login: 'admin', password: 'secret' }).error).toBeUndefined();
  });

  test('accepts login and token together', () => {
    const schema = getTokenAuthConfigurationSchema(Joi);
    expect(schema.validate({ login: 'admin', token: 'my-token' }).error).toBeUndefined();
  });

  test('accepts base64 auth string', () => {
    // Kills: ObjectLiteral {} at line 21 — if keys({}) replaced the auth branch keyset,
    // the required() on auth would disappear and any object would be accepted.
    const schema = getTokenAuthConfigurationSchema(Joi);
    expect(schema.validate({ auth: 'dXNlcjpwYXNz' }).error).toBeUndefined();
  });

  test('rejects login+password combined with token (forbidden)', () => {
    // Kills: ObjectLiteral {} at line 9 — with empty keys, forbidden() on token vanishes
    const schema = getTokenAuthConfigurationSchema(Joi);
    expect(
      schema.validate({ login: 'admin', password: 'secret', token: 'tok' }).error,
    ).toBeDefined();
  });

  test('rejects login+password combined with auth (forbidden)', () => {
    // Kills: ObjectLiteral {} at line 9 — with empty keys, forbidden() on auth vanishes
    const schema = getTokenAuthConfigurationSchema(Joi);
    expect(
      schema.validate({ login: 'admin', password: 'secret', auth: 'dXNlcjpwYXNz' }).error,
    ).toBeDefined();
  });

  test('rejects login+token combined with password (forbidden)', () => {
    const schema = getTokenAuthConfigurationSchema(Joi);
    expect(
      schema.validate({ login: 'admin', token: 'tok', password: 'secret' }).error,
    ).toBeDefined();
  });

  test('rejects login+token combined with auth (forbidden)', () => {
    const schema = getTokenAuthConfigurationSchema(Joi);
    expect(
      schema.validate({ login: 'admin', token: 'tok', auth: 'dXNlcjpwYXNz' }).error,
    ).toBeDefined();
  });

  test('rejects auth combined with login (forbidden)', () => {
    // Kills: ObjectLiteral {} at line 21 — with empty keys, forbidden() on login vanishes
    const schema = getTokenAuthConfigurationSchema(Joi);
    expect(schema.validate({ auth: 'dXNlcjpwYXNz', login: 'admin' }).error).toBeDefined();
  });

  test('rejects auth combined with password (forbidden)', () => {
    // Kills: ObjectLiteral {} at line 21 — with empty keys, forbidden() on password vanishes
    const schema = getTokenAuthConfigurationSchema(Joi);
    expect(schema.validate({ auth: 'dXNlcjpwYXNz', password: 'secret' }).error).toBeDefined();
  });

  test('rejects auth combined with token (forbidden)', () => {
    // Kills: ObjectLiteral {} at line 21 — with empty keys, forbidden() on token vanishes
    const schema = getTokenAuthConfigurationSchema(Joi);
    expect(schema.validate({ auth: 'dXNlcjpwYXNz', token: 'tok' }).error).toBeDefined();
  });

  test('rejects login-only without password or token', () => {
    // login is required in both login+password and login+token branches
    // but neither branch allows login alone
    const schema = getTokenAuthConfigurationSchema(Joi);
    expect(schema.validate({ login: 'admin' }).error).toBeDefined();
  });

  test('rejects password-only without login', () => {
    const schema = getTokenAuthConfigurationSchema(Joi);
    expect(schema.validate({ password: 'secret' }).error).toBeDefined();
  });

  test('rejects non-base64 auth value', () => {
    const schema = getTokenAuthConfigurationSchema(Joi);
    expect(schema.validate({ auth: '!@#$%^not-base64' }).error).toBeDefined();
  });
});
