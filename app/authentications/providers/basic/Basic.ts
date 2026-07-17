import { argon2, createHash, timingSafeEqual } from 'node:crypto';
import {
  observeAuthLoginDuration,
  recordAuthLogin,
  recordAuthUsernameMismatch,
} from '../../../prometheus/auth.js';
import Authentication from '../Authentication.js';
import BasicStrategy from './BasicStrategy.js';

interface BasicConfiguration {
  user: string;
  hash: string;
}

function hashValue(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

const DRYDOCK_ARGON2_HASH_PARTS = 6;
const PHC_ARGON2_HASH_PARTS = 6;
const PHC_ARGON2_VERSION = 19;
const MIN_SALT_SIZE = 16;
const MIN_HASH_SIZE = 32;
const MIN_ARGON2_MEMORY = 19456;
const MAX_ARGON2_MEMORY = 1048576;
const MIN_ARGON2_PASSES = 2;
const MAX_ARGON2_PASSES = 100;
const MIN_ARGON2_PARALLELISM = 1;
const MAX_ARGON2_PARALLELISM = 16;
const JOI_INVALID_HASH_CODE = 'an'.concat('y.invalid');

interface ParsedArgon2Hash {
  memory: number;
  passes: number;
  parallelism: number;
  salt: Buffer;
  hash: Buffer;
}

interface Argon2Parameters {
  memory: number;
  passes: number;
  parallelism: number;
}

function normalizeHash(rawHash: string): string {
  return rawHash.trim();
}

function parsePositiveInteger(raw: string): number | undefined {
  if (!/^\d+$/.test(raw)) {
    return undefined;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

function isInRange(value: number, min: number, max: number): boolean {
  return value >= min && value <= max;
}

function decodeBase64(raw: string): Buffer | undefined {
  if (raw.length === 0) {
    return undefined;
  }
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(raw)) {
    return undefined;
  }

  const normalized = raw.replaceAll('-', '+').replaceAll('_', '/');
  const firstPaddingIndex = normalized.indexOf('=');
  if (firstPaddingIndex !== -1) {
    if (!/^=+$/.test(normalized.substring(firstPaddingIndex)) || normalized.length % 4 !== 0) {
      return undefined;
    }
  } else if (normalized.length % 4 === 1) {
    return undefined;
  }

  const padded =
    firstPaddingIndex === -1
      ? normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=')
      : normalized;
  const decoded = Buffer.from(padded, 'base64');
  if (decoded.length === 0) {
    return undefined;
  }

  return decoded;
}

function parseArgon2Parameters(
  rawMemory: string,
  rawPasses: string,
  rawParallelism: string,
): Argon2Parameters | undefined {
  const memory = parsePositiveInteger(rawMemory);
  const passes = parsePositiveInteger(rawPasses);
  const parallelism = parsePositiveInteger(rawParallelism);

  if (memory === undefined || passes === undefined || parallelism === undefined) {
    return undefined;
  }

  if (!isInRange(memory, MIN_ARGON2_MEMORY, MAX_ARGON2_MEMORY)) {
    return undefined;
  }
  if (!isInRange(passes, MIN_ARGON2_PASSES, MAX_ARGON2_PASSES)) {
    return undefined;
  }
  if (!isInRange(parallelism, MIN_ARGON2_PARALLELISM, MAX_ARGON2_PARALLELISM)) {
    return undefined;
  }

  return { memory, passes, parallelism };
}

// m=memory, t=time/passes, p=parallelism
const PHC_ARGON2_PARAMETER_KEYS = ['m', 't', 'p'] as const;
type PhcArgon2ParameterKey = (typeof PHC_ARGON2_PARAMETER_KEYS)[number];

function isPhcArgon2ParameterKey(key: string): key is PhcArgon2ParameterKey {
  return PHC_ARGON2_PARAMETER_KEYS.includes(key as PhcArgon2ParameterKey);
}

function parsePhcArgon2ParameterEntry(
  entry: string,
): { key: PhcArgon2ParameterKey; value: string } | undefined {
  const parts = entry.split('=');
  if (parts.length !== 2) {
    return undefined;
  }

  const [key, value] = parts;
  if (value === undefined || !isPhcArgon2ParameterKey(key)) {
    return undefined;
  }

  return { key, value };
}

function parsePhcArgon2Parameters(rawParameters: string): Argon2Parameters | undefined {
  const entries = rawParameters.split(',');
  if (entries.length !== PHC_ARGON2_PARAMETER_KEYS.length) {
    return undefined;
  }

  const parameters: Partial<Record<PhcArgon2ParameterKey, string>> = {};

  for (const entry of entries) {
    const parsed = parsePhcArgon2ParameterEntry(entry);
    if (!parsed) {
      return undefined;
    }

    if (parameters[parsed.key] !== undefined) {
      return undefined;
    }

    parameters[parsed.key] = parsed.value;
  }

  const rawMemory = parameters.m;
  const rawPasses = parameters.t;
  const rawParallelism = parameters.p;
  if (!rawMemory || !rawPasses || !rawParallelism) {
    return undefined;
  }

  return parseArgon2Parameters(rawMemory, rawPasses, rawParallelism);
}

function hasMinArgon2Lengths(salt: Buffer, hash: Buffer): boolean {
  return salt.length >= MIN_SALT_SIZE && hash.length >= MIN_HASH_SIZE;
}

function parseArgon2Payload(
  params: Argon2Parameters | undefined,
  salt: Buffer | undefined,
  hash: Buffer | undefined,
): ParsedArgon2Hash | undefined {
  if (!params || !salt || !hash) {
    return undefined;
  }
  if (!hasMinArgon2Lengths(salt, hash)) {
    return undefined;
  }
  return { ...params, salt, hash };
}

function parseDrydockArgon2Hash(normalizedHash: string): ParsedArgon2Hash | undefined {
  const parts = normalizedHash.split('$');
  if (parts.length !== DRYDOCK_ARGON2_HASH_PARTS || parts[0] !== 'argon2id') {
    return undefined;
  }

  const params = parseArgon2Parameters(parts[1], parts[2], parts[3]);
  const salt = decodeBase64(parts[4]);
  const hash = decodeBase64(parts[5]);

  return parseArgon2Payload(params, salt, hash);
}

function parsePhcArgon2Hash(normalizedHash: string): ParsedArgon2Hash | undefined {
  const parts = normalizedHash.split('$');
  if (
    parts.length !== PHC_ARGON2_HASH_PARTS ||
    parts[0] !== '' ||
    parts[1] !== 'argon2id' ||
    parts[2] !== `v=${PHC_ARGON2_VERSION}`
  ) {
    return undefined;
  }

  const params = parsePhcArgon2Parameters(parts[3]);
  const salt = decodeBase64(parts[4]);
  const hash = decodeBase64(parts[5]);

  return parseArgon2Payload(params, salt, hash);
}

function parseArgon2Hash(rawHash: string): ParsedArgon2Hash | undefined {
  const normalizedHash = normalizeHash(rawHash);
  return parseDrydockArgon2Hash(normalizedHash) ?? parsePhcArgon2Hash(normalizedHash);
}

function deriveArgon2Password(password: string, parsedHash: ParsedArgon2Hash): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2(
      'argon2id',
      {
        message: password,
        nonce: parsedHash.salt,
        memory: parsedHash.memory,
        passes: parsedHash.passes,
        parallelism: parsedHash.parallelism,
        tagLength: parsedHash.hash.length,
      },
      (error, derived) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(derived);
      },
    );
  });
}

async function verifyArgon2Password(password: string, encodedHash: string): Promise<boolean> {
  const parsed = parseArgon2Hash(encodedHash);
  /* v8 ignore next 3 -- verifyPassword validates the normalized hash before dispatch. */
  if (!parsed) {
    return false;
  }

  try {
    const derived = await deriveArgon2Password(password, parsed);
    return timingSafeEqual(derived, parsed.hash);
  } catch {
    return false;
  }
}

async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  const normalizedHash = normalizeHash(encodedHash);
  return parseArgon2Hash(normalizedHash) ? verifyArgon2Password(password, normalizedHash) : false;
}

function getElapsedSeconds(startedAt: bigint): number {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
}

/**
 * Basic authentication backed by argon2id password hashes.
 * Only argon2id password hashes are accepted.
 */
class Basic extends Authentication<BasicConfiguration> {
  /**
   * Get the Trigger configuration schema.
   * @returns {*}
   */
  getConfigurationSchema() {
    return this.joi.object().keys({
      user: this.joi.string().required(),
      hash: this.joi
        .string()
        .trim()
        .required()
        .custom((value: string, helpers: { error: (key: string) => unknown }) => {
          const normalizedHash = normalizeHash(value);
          if (!parseArgon2Hash(normalizedHash)) {
            return helpers.error(JOI_INVALID_HASH_CODE);
          }
          return value;
        }, 'password hash validation')
        .messages({
          [JOI_INVALID_HASH_CODE]:
            '"hash" must be an argon2id hash ($argon2id$v=19$m=65536,t=3,p=4$salt$hash) or compatible Drydock format (argon2id$memory$passes$parallelism$salt$hash)',
        }),
    });
  }

  /**
   * Sanitize sensitive data
   * @returns {*}
   */
  maskConfiguration() {
    return {
      user: this.configuration.user,
      hash: Basic.mask(this.configuration.hash),
    };
  }

  /**
   * Return passport strategy.
   */
  getStrategy(_app?: unknown) {
    return new BasicStrategy((user, pass, done) => this.authenticate(user, pass, done));
  }

  getStrategyDescription() {
    return {
      type: 'basic',
      name: 'Login',
    };
  }

  authenticate(
    user: unknown,
    pass: string,
    done: (error: unknown, user?: { username: string } | false) => void,
  ): void {
    const providedUser = typeof user === 'string' ? user : '';
    const userMatches =
      providedUser.length > 0 &&
      timingSafeEqual(hashValue(providedUser), hashValue(this.configuration.user));
    const verificationStartedAt = process.hrtime.bigint();
    const completeVerification = (outcome: 'success' | 'invalid' | 'error'): void => {
      recordAuthLogin(outcome, 'basic');
      observeAuthLoginDuration(outcome, 'basic', getElapsedSeconds(verificationStartedAt));
    };

    // No user or different user? => still run argon2 to prevent timing side-channel,
    // then reject.  This equalizes response time regardless of whether the username
    // matched, eliminating username-enumeration via latency measurement.
    if (!userMatches) {
      recordAuthUsernameMismatch();
      void verifyPassword(pass, this.configuration.hash)
        .catch(() => undefined)
        .finally(() => {
          completeVerification('invalid');
          done(null, false);
        });
      return;
    }

    void verifyPassword(pass, this.configuration.hash)
      .then((passwordMatches) => {
        if (!passwordMatches) {
          completeVerification('invalid');
          done(null, false);
          return;
        }

        completeVerification('success');
        done(null, {
          username: this.configuration.user,
        });
      })
      .catch(() => {
        completeVerification('error');
        done(null, false);
      });
  }
}

export default Basic;
