import joi from 'joi';
import { providerNames } from './providers.js';

/** The slug rule the icon proxy enforces; label overrides store only slugs that pass it. */
export const ICON_SLUG_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/i;

const iconRequestSchema = joi.object({
  provider: joi
    .string()
    .valid(...providerNames)
    .required(),
  slug: joi.string().pattern(ICON_SLUG_PATTERN).required(),
});

export { iconRequestSchema };
