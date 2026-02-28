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
});
