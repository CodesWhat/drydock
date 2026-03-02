import joi from 'joi';
import { providerNames } from './icons.providers.js';

const iconRequestSchema = joi.object({
  provider: joi
    .string()
    .valid(...providerNames)
    .required(),
  slug: joi
    .string()
    .pattern(/^[a-z0-9][a-z0-9._-]{0,127}$/i)
    .required(),
});

export { iconRequestSchema };
