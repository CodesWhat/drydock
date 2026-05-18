import Joi from 'joi';
import { getBasicAuthConfigurationSchema } from './basicAuthConfigurationSchema.js';

describe('getBasicAuthConfigurationSchema', () => {
  test('accepts login and password credentials', () => {
    const schema = getBasicAuthConfigurationSchema(Joi);

    expect(
      schema.validate({
        login: 'drydock',
        password: 'token',
      }).error,
    ).toBeUndefined();
  });

  test('accepts base64 auth credentials', () => {
    const schema = getBasicAuthConfigurationSchema(Joi);

    expect(
      schema.validate({
        auth: 'ZHJ5ZG9jazp0b2tlbg==',
      }).error,
    ).toBeUndefined();
  });

  test('accepts empty string credentials', () => {
    const schema = getBasicAuthConfigurationSchema(Joi);

    expect(schema.validate('').error).toBeUndefined();
  });

  test('rejects login without password', () => {
    const schema = getBasicAuthConfigurationSchema(Joi);

    expect(
      schema.validate({
        login: 'drydock',
      }).error,
    ).toBeDefined();
  });

  test('rejects login mixed with auth', () => {
    const schema = getBasicAuthConfigurationSchema(Joi);

    expect(
      schema.validate({
        login: 'drydock',
        auth: 'ZHJ5ZG9jazp0b2tlbg==',
      }).error,
    ).toBeDefined();
  });

  test('rejects password mixed with auth', () => {
    const schema = getBasicAuthConfigurationSchema(Joi);

    expect(
      schema.validate({
        password: 'token',
        auth: 'ZHJ5ZG9jazp0b2tlbg==',
      }).error,
    ).toBeDefined();
  });

  // ── String-literal / field-name kill tests ─────────────────────────────────

  test('accepts empty string auth in credentials object (valid empty string)', () => {
    // Kills: StringLiteral "Stryker was here!" at line 4:87 replacing the '' in valid('')
    // auth field as empty string inside a credentials object must be valid
    const schema = getBasicAuthConfigurationSchema(Joi);
    expect(schema.validate({ auth: '' }).error).toBeUndefined();
  });

  test('requires password when login is provided (and-rule uses exact field name "password")', () => {
    // Kills: StringLiteral "" replacing "password" in .and('login', 'password')
    // {login: 'x'} must fail; if .and('login', '') were used it would pass
    const schema = getBasicAuthConfigurationSchema(Joi);
    const result = schema.validate({ login: 'drydock' });
    expect(result.error).toBeDefined();
    // The specific field name 'password' must appear in the error context
    expect(result.error?.message).toMatch(/password/i);
  });

  test('requires login when password is provided (and-rule uses exact field name "login")', () => {
    // Kills: StringLiteral "" replacing "login" in .and('login', 'password')
    // {password: 'x'} must fail; if .and('', 'password') were used it would pass
    const schema = getBasicAuthConfigurationSchema(Joi);
    const result = schema.validate({ password: 'secret' });
    expect(result.error).toBeDefined();
    expect(result.error?.message).toMatch(/login/i);
  });

  test('rejects object containing both login and auth (without-rule uses exact field names)', () => {
    // Kills: StringLiteral "" replacing "login" or "auth" in .without('login', 'auth')
    const schema = getBasicAuthConfigurationSchema(Joi);
    expect(schema.validate({ login: 'drydock', auth: 'ZHJ5ZG9jazp0b2tlbg==' }).error).toBeDefined();
  });

  test('rejects object containing both password and auth (without-rule uses exact field names)', () => {
    // Kills: StringLiteral "" replacing "password" or "auth" in .without('password', 'auth')
    const schema = getBasicAuthConfigurationSchema(Joi);
    expect(
      schema.validate({ password: 'token', auth: 'ZHJ5ZG9jazp0b2tlbg==' }).error,
    ).toBeDefined();
  });

  test('rejects login+password+auth together (without-rule: login field name matters)', () => {
    // Kills: StringLiteral "" replacing "login" in .without('login', 'auth')
    // When login+password are both provided (satisfying .and), the .without('login','auth')
    // must still reject when auth is also present.
    // With mutant .without('','auth'), the '' field is absent, so rule doesn't fire → passes.
    const schema = getBasicAuthConfigurationSchema(Joi);
    expect(
      schema.validate({
        login: 'drydock',
        password: 'secret',
        auth: 'ZHJ5ZG9jazp0b2tlbg==',
      }).error,
    ).toBeDefined();
  });

  test('rejects login+password+auth together (without-rule: auth field name matters)', () => {
    // Kills: StringLiteral "" replacing "auth" in .without('login', 'auth')
    // Same scenario but verifying the 'auth' field name in the without constraint.
    const schema = getBasicAuthConfigurationSchema(Joi);
    expect(
      schema.validate({
        login: 'drydock',
        password: 'secret',
        auth: 'ZHJ5ZG9jazp0b2tlbg==',
      }).error,
    ).toBeDefined();
  });

  test('rejects all three fields together via second without-rule (password field name matters)', () => {
    // Kills: StringLiteral "" replacing "password" in .without('password', 'auth')
    // login+password+auth should fail via .without('password','auth'); with mutant
    // .without('','auth') the '' field is absent, rule doesn't fire.
    const schema = getBasicAuthConfigurationSchema(Joi);
    expect(
      schema.validate({
        login: 'drydock',
        password: 'secret',
        auth: 'ZHJ5ZG9jazp0b2tlbg==',
      }).error,
    ).toBeDefined();
  });
});
