import type Joi from 'joi';

export function getSelfHostedBasicConfigurationSchema(joi: typeof Joi): Joi.ObjectSchema {
  const authSchema = joi.alternatives().try(joi.string().base64(), joi.string().valid(''));

  return joi
    .object()
    .keys({
      url: joi.string().uri().required(),
      login: joi.string(),
      password: joi.string(),
      auth: authSchema,
      cafile: joi.string(),
      insecure: joi.boolean(),
      clientcert: joi.string(),
      clientkey: joi.string(),
    })
    .and('login', 'password')
    .without('login', 'auth')
    .without('password', 'auth')
    .and('clientcert', 'clientkey');
}
