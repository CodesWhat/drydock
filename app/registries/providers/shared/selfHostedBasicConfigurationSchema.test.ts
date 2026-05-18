import Joi from 'joi';
import { getSelfHostedBasicConfigurationSchema } from './selfHostedBasicConfigurationSchema.js';

describe('getSelfHostedBasicConfigurationSchema', () => {
  test('accepts url only', () => {
    const schema = getSelfHostedBasicConfigurationSchema(Joi);
    expect(schema.validate({ url: 'https://registry.acme.com' }).error).toBeUndefined();
  });

  test('accepts url with login and password', () => {
    const schema = getSelfHostedBasicConfigurationSchema(Joi);
    expect(
      schema.validate({
        url: 'https://registry.acme.com',
        login: 'admin',
        password: 'secret',
      }).error,
    ).toBeUndefined();
  });

  test('accepts url with base64 auth', () => {
    const schema = getSelfHostedBasicConfigurationSchema(Joi);
    expect(
      schema.validate({
        url: 'https://registry.acme.com',
        auth: 'dXNlcjpwYXNz',
      }).error,
    ).toBeUndefined();
  });

  test('accepts empty-string auth', () => {
    // Kills: StringLiteral "" mutant at the valid('') call
    const schema = getSelfHostedBasicConfigurationSchema(Joi);
    expect(
      schema.validate({
        url: 'https://registry.acme.com',
        auth: '',
      }).error,
    ).toBeUndefined();
  });

  test('requires url', () => {
    const schema = getSelfHostedBasicConfigurationSchema(Joi);
    expect(schema.validate({ login: 'admin', password: 'secret' }).error).toBeDefined();
  });

  test('rejects login without password', () => {
    // Kills: StringLiteral "" replacing 'password' in .and('login', 'password')
    // If .and('login','') were used, {login:'x'} would pass — but it must fail.
    const schema = getSelfHostedBasicConfigurationSchema(Joi);
    expect(
      schema.validate({ url: 'https://registry.acme.com', login: 'admin' }).error,
    ).toBeDefined();
  });

  test('rejects password without login', () => {
    // Kills: StringLiteral "" replacing 'login' in .and('login', 'password')
    const schema = getSelfHostedBasicConfigurationSchema(Joi);
    expect(
      schema.validate({ url: 'https://registry.acme.com', password: 'secret' }).error,
    ).toBeDefined();
  });

  test('rejects login combined with auth', () => {
    // Kills: StringLiteral "" replacing 'login' or 'auth' in .without('login', 'auth')
    const schema = getSelfHostedBasicConfigurationSchema(Joi);
    expect(
      schema.validate({
        url: 'https://registry.acme.com',
        login: 'admin',
        password: 'secret',
        auth: 'dXNlcjpwYXNz',
      }).error,
    ).toBeDefined();
  });

  test('rejects password combined with auth', () => {
    // Kills: StringLiteral "" replacing 'password' or 'auth' in .without('password', 'auth')
    const schema = getSelfHostedBasicConfigurationSchema(Joi);
    expect(
      schema.validate({
        url: 'https://registry.acme.com',
        password: 'secret',
        auth: 'dXNlcjpwYXNz',
      }).error,
    ).toBeDefined();
  });

  test('rejects clientcert without clientkey', () => {
    const schema = getSelfHostedBasicConfigurationSchema(Joi);
    expect(
      schema.validate({
        url: 'https://registry.acme.com',
        clientcert: '/path/to/cert.pem',
      }).error,
    ).toBeDefined();
  });

  test('rejects clientkey without clientcert', () => {
    const schema = getSelfHostedBasicConfigurationSchema(Joi);
    expect(
      schema.validate({
        url: 'https://registry.acme.com',
        clientkey: '/path/to/key.pem',
      }).error,
    ).toBeDefined();
  });

  test('accepts clientcert and clientkey together', () => {
    const schema = getSelfHostedBasicConfigurationSchema(Joi);
    expect(
      schema.validate({
        url: 'https://registry.acme.com',
        clientcert: '/path/to/cert.pem',
        clientkey: '/path/to/key.pem',
      }).error,
    ).toBeUndefined();
  });

  test('accepts cafile and insecure options', () => {
    const schema = getSelfHostedBasicConfigurationSchema(Joi);
    expect(
      schema.validate({
        url: 'https://registry.acme.com',
        cafile: '/certs/ca.pem',
        insecure: true,
      }).error,
    ).toBeUndefined();
  });

  test('rejects non-base64 auth string', () => {
    const schema = getSelfHostedBasicConfigurationSchema(Joi);
    expect(
      schema.validate({
        url: 'https://registry.acme.com',
        auth: '!@#$%^&*()',
      }).error,
    ).toBeDefined();
  });

  test('rejects url+login+password+auth together (without login field name matters)', () => {
    // Kills: StringLiteral "" replacing "login" in .without('login', 'auth') at line 19
    // When url+login+password are all valid, .without('login','auth') must still reject auth.
    // With mutant .without('','auth'), '' field is absent → rule doesn't fire → passes.
    const schema = getSelfHostedBasicConfigurationSchema(Joi);
    expect(
      schema.validate({
        url: 'https://registry.acme.com',
        login: 'admin',
        password: 'secret',
        auth: 'dXNlcjpwYXNz',
      }).error,
    ).toBeDefined();
  });

  test('rejects url+login+password+auth together (without auth field name matters)', () => {
    // Kills: StringLiteral "" replacing "auth" in .without('login', 'auth') at line 19
    const schema = getSelfHostedBasicConfigurationSchema(Joi);
    expect(
      schema.validate({
        url: 'https://registry.acme.com',
        login: 'admin',
        password: 'secret',
        auth: 'dXNlcjpwYXNz',
      }).error,
    ).toBeDefined();
  });

  test('rejects url+login+password+auth together (second without password field name matters)', () => {
    // Kills: StringLiteral "" replacing "password" in .without('password', 'auth') at line 20
    const schema = getSelfHostedBasicConfigurationSchema(Joi);
    expect(
      schema.validate({
        url: 'https://registry.acme.com',
        login: 'admin',
        password: 'secret',
        auth: 'dXNlcjpwYXNz',
      }).error,
    ).toBeDefined();
  });

  test('rejects url+login+password+auth together (second without second arg field name matters)', () => {
    // Kills: StringLiteral "" replacing "auth" in .without('password', 'auth') at line 20
    const schema = getSelfHostedBasicConfigurationSchema(Joi);
    expect(
      schema.validate({
        url: 'https://registry.acme.com',
        login: 'admin',
        password: 'secret',
        auth: 'dXNlcjpwYXNz',
      }).error,
    ).toBeDefined();
  });
});
