/**
 * Reading the serialized user out of an express-session payload.
 *
 * Split out of auth-session.ts so the authenticator chain can restore an
 * identity without pulling in the session store, its secret, and LokiJS behind
 * it. Nothing here touches state: it parses a string and validates its shape.
 */

import joi from 'joi';
import type { SessionUser } from './auth-types.js';

const sessionUserSchema = joi
  .object({
    username: joi.string().required(),
  })
  .required()
  .unknown(false);

export function deserializeSessionUser(serializedUser: unknown): SessionUser {
  if (typeof serializedUser !== 'string') {
    throw new Error('Serialized user must be a JSON string');
  }

  let parsedUser: unknown;
  try {
    parsedUser = JSON.parse(serializedUser);
  } catch {
    throw new Error('Serialized user JSON is malformed');
  }

  const validatedUser = sessionUserSchema.validate(parsedUser, {
    convert: false,
    stripUnknown: false,
  });
  if (validatedUser.error) {
    throw new Error(validatedUser.error.message);
  }

  return validatedUser.value as SessionUser;
}
