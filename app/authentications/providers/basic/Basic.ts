import { argon2Sync, createHash, timingSafeEqual } from 'node:crypto';
import Authentication from '../Authentication.js';
import BasicStrategy from './BasicStrategy.js';

function hashValue(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

const ARGON2_HASH_PARTS = 6;
const MIN_SALT_SIZE = 16;
const MIN_HASH_SIZE = 32;
const MIN_ARGON2_MEMORY = 19456;
const MAX_ARGON2_MEMORY = 1048576;
const MIN_ARGON2_PASSES = 2;
const MAX_ARGON2_PASSES = 100;
const MIN_ARGON2_PARALLELISM = 1;
const MAX_ARGON2_PARALLELISM = 16;

interface ParsedArgon2Hash {
  memory: number;
  passes: number;
  parallelism: number;
  salt: Buffer;
  hash: Buffer;
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

function decodeBase64(raw: string): Buffer | undefined {
  if (raw.length === 0) {
    return undefined;
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw) || raw.length % 4 !== 0) {
    return undefined;
  }

  return Buffer.from(raw, 'base64');
}

function parseArgon2Hash(rawHash: string): ParsedArgon2Hash | undefined {
  const parts = rawHash.split('$');
  if (parts.length !== ARGON2_HASH_PARTS || parts[0] !== 'argon2id') {
    return undefined;
  }

  const memory = parsePositiveInteger(parts[1]);
  const passes = parsePositiveInteger(parts[2]);
  const parallelism = parsePositiveInteger(parts[3]);
  const salt = decodeBase64(parts[4]);
  const hash = decodeBase64(parts[5]);

  if (
    !memory ||
    !passes ||
    !parallelism ||
    !salt ||
    !hash ||
    memory < MIN_ARGON2_MEMORY ||
    memory > MAX_ARGON2_MEMORY ||
    passes < MIN_ARGON2_PASSES ||
    passes > MAX_ARGON2_PASSES ||
    parallelism < MIN_ARGON2_PARALLELISM ||
    parallelism > MAX_ARGON2_PARALLELISM ||
    salt.length < MIN_SALT_SIZE ||
    hash.length < MIN_HASH_SIZE
  ) {
    return undefined;
  }

  return { memory, passes, parallelism, salt, hash };
}

function parseShaHash(rawHash: string): Buffer | undefined {
  if (rawHash.length < 5) {
    return undefined;
  }
  const prefix = rawHash.substring(0, 5);
  if (prefix.toLowerCase() !== '{sha}') {
    return undefined;
  }
  const encoded = rawHash.substring(5);
  const decoded = decodeBase64(encoded);
  if (!decoded || decoded.length !== 20) {
    return undefined;
  }
  return decoded;
}

function verifyArgon2Password(password: string, encodedHash: string): boolean {
  const parsed = parseArgon2Hash(encodedHash);
  if (!parsed) {
    return false;
  }

  try {
    const derived = argon2Sync('argon2id', {
      message: password,
      nonce: parsed.salt,
      memory: parsed.memory,
      passes: parsed.passes,
      parallelism: parsed.parallelism,
      tagLength: parsed.hash.length,
    });
    return timingSafeEqual(derived, parsed.hash);
  } catch {
    return false;
  }
}

function verifyShaPassword(password: string, encodedHash: string): boolean {
  const expectedHash = parseShaHash(encodedHash);
  if (!expectedHash) {
    return false;
  }

  try {
    const actualHash = createHash('sha1').update(password).digest();
    return timingSafeEqual(actualHash, expectedHash);
  } catch {
    return false;
  }
}

function verifyPassword(password: string, encodedHash: string): boolean {
  if (parseArgon2Hash(encodedHash)) {
    return verifyArgon2Password(password, encodedHash);
  }
  if (parseShaHash(encodedHash)) {
    return verifyShaPassword(password, encodedHash);
  }
  return false;
}

function isLegacyShaHash(hash: string): boolean {
  return parseShaHash(hash) !== undefined;
}

/**
 * Basic authentication backed by argon2id password hashes.
 * Legacy SHA-1 {SHA} hashes are accepted with deprecation warnings.
 */
class Basic extends Authentication {
  /**
   * Get the Trigger configuration schema.
   * @returns {*}
   */
  getConfigurationSchema() {
    return this.joi.object().keys({
      user: this.joi.string().required(),
      hash: this.joi
        .string()
        .required()
        .custom((value: string, helpers: { error: (key: string) => unknown }) => {
          if (parseArgon2Hash(value) || parseShaHash(value)) {
            return value;
          }
          return helpers.error('any.invalid');
        }, 'password hash validation')
        .messages({
          'any.invalid':
            '"hash" must be an argon2id hash (argon2id$memory$passes$parallelism$salt$hash) or a legacy {SHA} hash',
        }),
    });
  }

  /**
   * Init authentication. Log deprecation warning if SHA hash detected.
   */
  initAuthentication(): void {
    if (isLegacyShaHash(this.configuration.hash)) {
      this.log.warn(
        'SHA-1 password hash detected — SHA-1 is deprecated and will be removed in v1.6.0. Migrate to argon2id hashing.',
      );
    }
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

  getMetadata(): Record<string, unknown> {
    return {
      usesLegacyHash: isLegacyShaHash(this.configuration.hash),
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

    // No user or different user? => reject
    if (!userMatches) {
      done(null, false);
      return;
    }

    const passwordMatches = verifyPassword(pass, this.configuration.hash);
    if (!passwordMatches) {
      done(null, false);
      return;
    }

    done(null, {
      username: this.configuration.user,
    });
  }
}

export default Basic;
