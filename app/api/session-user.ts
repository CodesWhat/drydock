/**
 * Reading and writing the serialized user inside an express-session payload.
 *
 * Split out of auth-session.ts so the authenticator chain can restore an
 * identity without pulling in the session store, its secret, and LokiJS behind
 * it. Nothing here touches state: it parses a string and validates its shape.
 *
 * Three shapes exist. The legacy `{ username }` shape is what every release up
 * to v1.7 wrote and stays readable. Schema v2 adds a `kind`: `local` carries the
 * stable subject fields (spec 11.1.2), `oidc` marks a session whose identity the
 * identity provider owns. Whether a parsed session is still *valid* (subject
 * version, factor assurance) is decided in totp-identity.ts, not here.
 */

import joi from 'joi';
import type { SessionUser } from './auth-types.js';

const SUBJECT_ID_PATTERN = /^[0-9a-f]{64}$/;

const legacySchema = joi
  .object({
    username: joi.string().required(),
  })
  .required()
  .unknown(false);

const v2LocalSchema = joi
  .object({
    v: joi.number().valid(2).required(),
    kind: joi.string().valid('local').required(),
    username: joi.string().required(),
    subjectId: joi.string().pattern(SUBJECT_ID_PATTERN).required(),
    providerId: joi.string().required(),
    assurance: joi.string().valid('password', 'totp', 'recovery').required(),
    factorVersion: joi.number().integer().min(0).required(),
  })
  .required()
  .unknown(false);

const v2OidcSchema = joi
  .object({
    v: joi.number().valid(2).required(),
    kind: joi.string().valid('oidc').required(),
    username: joi.string().required(),
  })
  .required()
  .unknown(false);

const validationOptions = { convert: false, stripUnknown: false };

type ParsedObject = Record<string, unknown>;

function validate(schema: joi.ObjectSchema, value: unknown): ParsedObject {
  const validated = schema.validate(value, validationOptions);
  if (validated.error) {
    throw new Error(validated.error.message);
  }
  return validated.value as ParsedObject;
}

/** Parse an already JSON-decoded session user into its typed shape. */
function parseSessionUserValue(value: unknown): SessionUser {
  const version = (value as ParsedObject | null)?.v;
  if (version === undefined) {
    return { username: validate(legacySchema, value).username as string };
  }

  const kind = (value as ParsedObject).kind;
  if (kind === 'oidc') {
    return {
      username: validate(v2OidcSchema, value).username as string,
      identity: { type: 'oidc' },
    };
  }

  const local = validate(v2LocalSchema, value);
  return {
    username: local.username as string,
    identity: {
      type: 'local',
      subjectId: local.subjectId as string,
      providerId: local.providerId as string,
      assurance: local.assurance as 'password' | 'totp' | 'recovery',
      factorVersion: local.factorVersion as number,
    },
  };
}

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

  return parseSessionUserValue(parsedUser);
}

/**
 * The stored form of a session user. A user with no identity serializes to the
 * legacy shape byte for byte, so a session that was legacy stays unchanged.
 */
export function serializeSessionUser(user: SessionUser): string {
  const { identity } = user;
  if (identity === undefined) {
    return JSON.stringify({ username: user.username });
  }
  if (identity.type === 'oidc') {
    return JSON.stringify({ v: 2, kind: 'oidc', username: user.username });
  }
  return JSON.stringify({
    v: 2,
    kind: 'local',
    username: user.username,
    subjectId: identity.subjectId,
    providerId: identity.providerId,
    assurance: identity.assurance,
    factorVersion: identity.factorVersion,
  });
}

/**
 * The username a stored session payload names, for code that scans raw session
 * rows (the concurrent-session limit, the upgrade rate-limit key). Accepts the
 * string form express-session stores and an already-decoded object, and
 * answers undefined for anything that would not deserialize. It says nothing
 * about whether the session is still valid.
 */
export function readSessionUsername(rawUser: unknown): string | undefined {
  let value = rawUser;
  if (typeof rawUser === 'string') {
    try {
      value = JSON.parse(rawUser);
    } catch {
      return undefined;
    }
  }
  if (value === null || typeof value !== 'object') {
    return undefined;
  }

  try {
    return parseSessionUserValue(value).username;
  } catch {
    return undefined;
  }
}
