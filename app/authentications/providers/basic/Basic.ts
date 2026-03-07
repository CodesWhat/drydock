import { createHash, scryptSync, timingSafeEqual } from 'node:crypto';
import Authentication from '../Authentication.js';
import BasicStrategy from './BasicStrategy.js';

function hashValue(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

const SCRYPT_HASH_PARTS = 6;
const MIN_SALT_SIZE = 16;
const MIN_DERIVED_KEY_SIZE = 32;
const MIN_SCRYPT_N = 16384;
const MAX_SCRYPT_N = 262144;
const MIN_SCRYPT_R = 8;
const MAX_SCRYPT_R = 32;
const MIN_SCRYPT_P = 1;
const MAX_SCRYPT_P = 8;

interface ParsedScryptHash {
  N: number;
  r: number;
  p: number;
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

function isPowerOfTwo(value: number): boolean {
  return value > 0 && (value & (value - 1)) === 0;
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

function parseScryptHash(rawHash: string): ParsedScryptHash | undefined {
  const parts = rawHash.split('$');
  if (parts.length !== SCRYPT_HASH_PARTS || parts[0] !== 'scrypt') {
    return undefined;
  }

  const N = parsePositiveInteger(parts[1]);
  const r = parsePositiveInteger(parts[2]);
  const p = parsePositiveInteger(parts[3]);
  const salt = decodeBase64(parts[4]);
  const hash = decodeBase64(parts[5]);

  if (
    !N ||
    !r ||
    !p ||
    !salt ||
    !hash ||
    !isPowerOfTwo(N) ||
    N < MIN_SCRYPT_N ||
    N > MAX_SCRYPT_N ||
    r < MIN_SCRYPT_R ||
    r > MAX_SCRYPT_R ||
    p < MIN_SCRYPT_P ||
    p > MAX_SCRYPT_P ||
    salt.length < MIN_SALT_SIZE ||
    hash.length < MIN_DERIVED_KEY_SIZE
  ) {
    return undefined;
  }

  return { N, r, p, salt, hash };
}

function verifyPassword(password: string, encodedHash: string): boolean {
  const parsed = parseScryptHash(encodedHash);
  if (!parsed) {
    return false;
  }

  try {
    const maxmem = 128 * parsed.N * parsed.r + 1024 * parsed.r * parsed.p + 1024;
    const derived = scryptSync(password, parsed.salt, parsed.hash.length, {
      N: parsed.N,
      r: parsed.r,
      p: parsed.p,
      maxmem,
    });
    return timingSafeEqual(derived, parsed.hash);
  } catch {
    return false;
  }
}

/**
 * Basic authentication backed by scrypt password hashes.
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
          return parseScryptHash(value) ? value : helpers.error('any.invalid');
        }, 'scrypt hash validation')
        .messages({
          'any.invalid':
            '"hash" must be a scrypt hash in format scrypt$N$r$p$<salt-base64>$<hash-base64>',
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
