import type Joi from 'joi';

export function getBasicAuthConfigurationSchema(joi: typeof Joi): Joi.AlternativesSchema {
  const authSchema = joi.alternatives().try(joi.string().base64(), joi.string().valid(''));

  const credentialsSchema = joi
    .object()
    .keys({
      login: joi.string(),
      password: joi.string(),
      auth: authSchema,
    })
    .and('login', 'password')
    .without('login', 'auth')
    .without('password', 'auth');

  return joi.alternatives().try(joi.string().allow(''), credentialsSchema);
}
