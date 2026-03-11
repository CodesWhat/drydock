import { argon2, createHash, timingSafeEqual } from 'node:crypto';
import { createRequire } from 'node:module';
import Authentication from '../Authentication.js';
import BasicStrategy from './BasicStrategy.js';

const require = createRequire(import.meta.url);
const apacheMd5 = require('apache-md5') as (password: string, salt: string) => string;
const unixCrypt = require('unix-crypt-td-js') as (password: string, salt: string) => string;

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

interface ParsedMd5Hash {
  variant: 'apr1' | '1';
  salt: string;
  encodedHash: string;
}

interface ParsedCryptHash {
  salt: string;
  encodedHash: string;
}

type LegacyHashFormat = 'sha1' | 'apr1' | 'md5' | 'crypt' | 'plain';

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
  const parts = normalizeHash(rawHash).split('$');
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

const SHA1_DIGEST_SIZE = 20;

function parseShaHash(rawHash: string): Buffer | undefined {
  const normalizedHash = normalizeHash(rawHash);
  if (normalizedHash.length < 5) {
    return undefined;
  }
  const prefix = normalizedHash.substring(0, 5);
  if (prefix.toLowerCase() !== '{sha}') {
    return undefined;
  }
  const encoded = normalizedHash.substring(5);
  if (!encoded) {
    return undefined;
  }
  const decoded = Buffer.from(encoded, 'base64');
  if (decoded.length !== SHA1_DIGEST_SIZE) {
    return undefined;
  }
  return decoded;
}

function parseMd5Hash(rawHash: string): ParsedMd5Hash | undefined {
  const normalizedHash = normalizeHash(rawHash);
  if (!normalizedHash.startsWith('$apr1$') && !normalizedHash.startsWith('$1$')) {
    return undefined;
  }

  const parts = normalizedHash.split('$');
  if (parts.length < 4) {
    return undefined;
  }

  const variant = parts[1];
  const salt = parts[2];
  if ((variant !== 'apr1' && variant !== '1') || !salt) {
    return undefined;
  }

  return {
    variant,
    salt,
    encodedHash: normalizedHash,
  };
}

function parseCryptHash(rawHash: string): ParsedCryptHash | undefined {
  const normalizedHash = normalizeHash(rawHash);
  if (normalizedHash.length !== 13) {
    return undefined;
  }
  return {
    salt: normalizedHash.substring(0, 2),
    encodedHash: normalizedHash,
  };
}

function timingSafeEqualString(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  try {
    return timingSafeEqual(leftBuffer, rightBuffer);
  } catch {
    return false;
  }
}

function getLegacyHashFormat(hash: string): LegacyHashFormat | undefined {
  if (parseArgon2Hash(hash)) {
    return undefined;
  }
  if (parseShaHash(hash) !== undefined) {
    return 'sha1';
  }

  const md5Hash = parseMd5Hash(hash);
  if (md5Hash) {
    return md5Hash.variant === 'apr1' ? 'apr1' : 'md5';
  }

  if (parseCryptHash(hash)) {
    return 'crypt';
  }

  return 'plain';
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

function verifyShaPassword(password: string, encodedHash: string): boolean {
  const expectedDigest = parseShaHash(encodedHash);
  if (!expectedDigest) {
    return false;
  }

  try {
    const actualDigest = createHash('sha1').update(password).digest();
    return timingSafeEqual(actualDigest, expectedDigest);
  } catch {
    return false;
  }
}

function verifyMd5Password(password: string, encodedHash: string): boolean {
  const parsedHash = parseMd5Hash(encodedHash);
  if (!parsedHash) {
    return false;
  }

  try {
    const salt = `$${parsedHash.variant}$${parsedHash.salt}$`;
    const actualHash = apacheMd5(password, salt);
    return timingSafeEqualString(actualHash, parsedHash.encodedHash);
  } catch {
    return false;
  }
}

function verifyCryptPassword(password: string, encodedHash: string): boolean {
  const parsedHash = parseCryptHash(encodedHash);
  if (!parsedHash) {
    return false;
  }

  try {
    const actualHash = unixCrypt(password, parsedHash.salt);
    return timingSafeEqualString(actualHash, parsedHash.encodedHash);
  } catch {
    return false;
  }
}

function verifyPlainPassword(password: string, encodedHash: string): boolean {
  try {
    return timingSafeEqualString(password, normalizeHash(encodedHash));
  } catch {
    return false;
  }
}

async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  const normalizedHash = normalizeHash(encodedHash);
  if (parseArgon2Hash(normalizedHash)) {
    return await verifyArgon2Password(password, normalizedHash);
  }
  if (parseShaHash(normalizedHash)) {
    return verifyShaPassword(password, normalizedHash);
  }
  if (parseMd5Hash(normalizedHash)) {
    return verifyMd5Password(password, normalizedHash);
  }
  if (parseCryptHash(normalizedHash)) {
    return verifyCryptPassword(password, normalizedHash);
  }
  return verifyPlainPassword(password, normalizedHash);
}

function isLegacyHash(hash: string): boolean {
  return getLegacyHashFormat(hash) !== undefined;
}

/**
 * Basic authentication backed by argon2id password hashes.
 * Legacy v1.3.9 hash formats are accepted with deprecation warnings.
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
        .trim()
        .required()
        .custom((value: string, helpers: { error: (key: string) => unknown }) => {
          if (value.startsWith('argon2id$') && !parseArgon2Hash(value)) {
            return helpers.error('any.invalid');
          }
          return value;
        }, 'password hash validation')
        .messages({
          'any.invalid':
            '"hash" must be an argon2id hash (argon2id$memory$passes$parallelism$salt$hash) or a supported legacy v1.3.9 hash',
        }),
    });
  }

  /**
   * Init authentication. Log deprecation warning if legacy hash is detected.
   */
  initAuthentication(): void {
    const format = getLegacyHashFormat(this.configuration.hash);
    if (format) {
      this.log.warn(
        `Legacy password hash format detected (${format}) — v1.3.9 formats (SHA, APR1/MD5, crypt, plain) are deprecated and will be removed in v1.6.0. Migrate to argon2id hashing.`,
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
      usesLegacyHash: isLegacyHash(this.configuration.hash),
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

    void verifyPassword(pass, this.configuration.hash)
      .then((passwordMatches) => {
        if (!passwordMatches) {
          done(null, false);
          return;
        }

        done(null, {
          username: this.configuration.user,
        });
      })
      .catch(() => {
        done(null, false);
      });
  }
}

export default Basic;
