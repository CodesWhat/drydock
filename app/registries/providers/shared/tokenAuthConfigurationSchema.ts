import type Joi from 'joi';

export function getTokenAuthConfigurationSchema(joi: typeof Joi): Joi.AlternativesSchema {
  const authSchema = joi.string().base64();

  return joi.alternatives([
    joi.string().valid(''),
    joi.object().max(0),
    joi.object().keys({
      login: joi.string().required(),
      password: joi.string().required(),
      token: joi.forbidden(),
      auth: joi.forbidden(),
    }),
    joi.object().keys({
      login: joi.string().required(),
      token: joi.string().required(),
      password: joi.forbidden(),
      auth: joi.forbidden(),
    }),
    joi.object().keys({
      auth: authSchema.required(),
      login: joi.forbidden(),
      password: joi.forbidden(),
      token: joi.forbidden(),
    }),
  ]);
}
