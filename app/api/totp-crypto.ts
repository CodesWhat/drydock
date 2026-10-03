/**
 * TOTP cryptography (spec 11.1.2, slice 1). Nothing here is wired into a login
 * flow yet: this module only generates, verifies, encrypts and digests.
 *
 * Rules the rest of the feature relies on:
 * - RFC 6238 over RFC 4226 with SHA-1. Parameters are persisted, not tunable.
 * - Seeds are encrypted with AES-256-GCM under an external key ring. The key
 *   ring never touches the store, and nothing in this file logs or echoes key,
 *   seed, ciphertext or code material. Failures carry a fixed message and a
 *   stable `code`, with no `cause`, because driver errors can quote their input.
 * - Every secret comparison goes through `timingSafeEqual` over fixed-length
 *   digests, and verification does the same work whether or not it matches.
 */
import crypto from 'node:crypto';
import { ddEnvVars } from '../configuration/index.js';

export type TotpCryptoErrorCode =
  | 'INVALID_ARGUMENT'
  | 'KEYRING_UNAVAILABLE'
  | 'KEYRING_INVALID'
  | 'KEY_NOT_FOUND'
  | 'DECRYPT_FAILED';

export class TotpCryptoError extends Error {
  readonly code: TotpCryptoErrorCode;

  constructor(code: TotpCryptoErrorCode, message: string) {
    super(message);
    this.name = 'TotpCryptoError';
    this.code = code;
  }
}

/* ------------------------------------------------------------------ */
/* HOTP / TOTP                                                         */
/* ------------------------------------------------------------------ */

export const TOTP_SEED_BYTES = 20;
export const TOTP_DIGITS = 6;
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_ALLOWED_SKEW_STEPS = 1;

const HOTP_MODULUS: Record<number, number> = {
  6: 1_000_000,
  7: 10_000_000,
  8: 100_000_000,
};

/** A fresh 160-bit seed. */
export function generateTotpSeed(): Buffer {
  return crypto.randomBytes(TOTP_SEED_BYTES);
}

/** RFC 4226 HOTP with HMAC-SHA-1. */
export function computeHotp(secret: Buffer, counter: number, digits: number = TOTP_DIGITS): string {
  const modulus = HOTP_MODULUS[digits];
  if (modulus === undefined) {
    throw new TotpCryptoError('INVALID_ARGUMENT', 'Unsupported TOTP digit count');
  }
  if (!Number.isSafeInteger(counter) || counter < 0) {
    throw new TotpCryptoError('INVALID_ARGUMENT', 'Invalid TOTP counter');
  }
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', secret).update(message).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const truncated =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3];
  return String(truncated % modulus).padStart(digits, '0');
}

/** The RFC 6238 time step containing `nowMs`. */
export function totpCounterAt(nowMs: number, periodSeconds: number = TOTP_PERIOD_SECONDS): number {
  if (!Number.isFinite(nowMs) || nowMs < 0) {
    throw new TotpCryptoError('INVALID_ARGUMENT', 'Invalid TOTP clock value');
  }
  if (!Number.isSafeInteger(periodSeconds) || periodSeconds <= 0) {
    throw new TotpCryptoError('INVALID_ARGUMENT', 'Invalid TOTP period');
  }
  return Math.floor(nowMs / 1000 / periodSeconds);
}

/** The code a correct authenticator shows at `nowMs`. */
export function generateTotp(
  secret: Buffer,
  nowMs: number,
  digits: number = TOTP_DIGITS,
  periodSeconds: number = TOTP_PERIOD_SECONDS,
): string {
  return computeHotp(secret, totpCounterAt(nowMs, periodSeconds), digits);
}

function sha256(value: string | Buffer): Buffer {
  return crypto.createHash('sha256').update(value).digest();
}

/**
 * Constant-time equality for strings of any length: both sides are hashed to a
 * fixed length first, so neither the length nor the content of the secret side
 * leaks through timing.
 */
function secretStringsEqual(left: string, right: string): boolean {
  return crypto.timingSafeEqual(sha256(left), sha256(right));
}

export interface VerifyTotpInput {
  secret: Buffer;
  code: string;
  nowMs: number;
  /** The counter of the last accepted code, or null/undefined for none yet. */
  lastAcceptedCounter?: number | null;
  skewSteps?: number;
  digits?: number;
  periodSeconds?: number;
}

export type VerifyTotpResult = { valid: true; counter: number } | { valid: false };

/**
 * Check `code` against steps `now-skew .. now+skew`. Every window is always
 * compared. A match is only valid when its counter is strictly greater than
 * `lastAcceptedCounter`, which rejects replay and a clock that moved backwards.
 * The caller must still persist the returned counter with a compare-and-set,
 * because two concurrent verifications can both see the same last counter.
 */
export function verifyTotp(input: VerifyTotpInput): VerifyTotpResult {
  const digits = input.digits ?? TOTP_DIGITS;
  const periodSeconds = input.periodSeconds ?? TOTP_PERIOD_SECONDS;
  const skewSteps = input.skewSteps ?? TOTP_ALLOWED_SKEW_STEPS;
  const candidate = typeof input.code === 'string' ? input.code : '';
  const shapeOk = new RegExp(`^[0-9]{${digits}}$`).test(candidate);

  let current: number;
  try {
    current = totpCounterAt(input.nowMs, periodSeconds);
  } catch {
    return { valid: false };
  }
  const last = input.lastAcceptedCounter ?? -1;

  let accepted = -1;
  for (let offset = -skewSteps; offset <= skewSteps; offset += 1) {
    const counter = current + offset;
    const expected = counter >= 0 ? computeHotp(input.secret, counter, digits) : '';
    const matches = secretStringsEqual(shapeOk ? candidate : '', expected);
    if (matches && shapeOk && counter > last && counter > accepted) {
      accepted = counter;
    }
  }
  return accepted >= 0 ? { valid: true, counter: accepted } : { valid: false };
}

/* ------------------------------------------------------------------ */
/* Key ring                                                            */
/* ------------------------------------------------------------------ */

export interface TotpKeyring {
  readonly activeKeyId: string;
  readonly keys: ReadonlyMap<string, Buffer>;
}

const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const KEY_BYTES = 32;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

function invalidKeyring(): TotpCryptoError {
  return new TotpCryptoError('KEYRING_INVALID', 'TOTP key ring is invalid');
}

/**
 * Parse the key ring file body: a JSON object mapping key ids to 32-byte base64
 * keys. `activeKeyId` selects the key new writes use; every other entry is
 * decrypt-only. A parse failure never echoes the input, because a malformed
 * key file is still a key file.
 */
export function parseTotpKeyring(json: string, activeKeyId: string): TotpKeyring {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw invalidKeyring();
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw invalidKeyring();
  }
  const keys = new Map<string, Buffer>();
  for (const [id, value] of Object.entries(parsed)) {
    if (!KEY_ID_PATTERN.test(id) || typeof value !== 'string' || !BASE64_PATTERN.test(value)) {
      throw invalidKeyring();
    }
    const decoded = Buffer.from(value, 'base64');
    if (decoded.length !== KEY_BYTES) {
      throw invalidKeyring();
    }
    keys.set(id, decoded);
  }
  if (!keys.has(activeKeyId)) {
    throw invalidKeyring();
  }
  return { activeKeyId, keys };
}

/**
 * Load the key ring from the resolved `DD_AUTH_TOTP_KEYRING` value and
 * `DD_AUTH_TOTP_ACTIVE_KEY_ID`. Returns undefined when neither is set (the
 * feature is simply not configured).
 *
 * Reads the post-`replaceSecrets()` configuration map, like the session secret
 * does: when `DD_AUTH_TOTP_KEYRING__FILE` is set, startup has already read that
 * file (bounded, regular-file and permission checked) and substituted its
 * contents into `DD_AUTH_TOTP_KEYRING`. So the key ring text does sit in the
 * in-memory configuration map; it is never persisted to the store, and
 * `getAuthenticationConfigurations()` skips `DD_AUTH_TOTP_*` so it is not
 * discovered as a provider.
 */
export function loadTotpKeyringFromEnv(
  env: Record<string, string | undefined> = ddEnvVars,
): TotpKeyring | undefined {
  const keyring = env.DD_AUTH_TOTP_KEYRING;
  const activeKeyId = env.DD_AUTH_TOTP_ACTIVE_KEY_ID;
  if (!keyring && !activeKeyId) {
    return undefined;
  }
  if (!keyring) {
    throw new TotpCryptoError('KEYRING_UNAVAILABLE', 'TOTP key ring is not configured');
  }
  if (!activeKeyId) {
    throw invalidKeyring();
  }
  return parseTotpKeyring(keyring, activeKeyId);
}

/* ------------------------------------------------------------------ */
/* Seed encryption                                                     */
/* ------------------------------------------------------------------ */

const NONCE_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const AAD_DOMAIN = 'drydock-totp-seed';

/** What the ciphertext is bound to: moving it to another row or parameter set fails. */
export interface TotpSeedBinding {
  subjectId: string;
  rowId: string;
  schemaVersion: number;
  algorithm: string;
  digits: number;
  periodSeconds: number;
  allowedSkewSteps: number;
}

export interface EncryptedTotpSeed {
  encryptionKeyId: string;
  secretNonce: string;
  secretCiphertext: string;
  secretAuthTag: string;
}

function additionalData(binding: TotpSeedBinding): Buffer {
  // JSON array, not a delimited string, so no field value can shift a boundary.
  return Buffer.from(
    JSON.stringify([
      AAD_DOMAIN,
      binding.schemaVersion,
      binding.subjectId,
      binding.rowId,
      binding.algorithm,
      binding.digits,
      binding.periodSeconds,
      binding.allowedSkewSteps,
    ]),
    'utf8',
  );
}

function lookupKey(keyring: TotpKeyring, keyId: string): Buffer {
  const found = keyring.keys.get(keyId);
  if (!found) {
    throw new TotpCryptoError('KEY_NOT_FOUND', 'TOTP encryption key is not available');
  }
  return found;
}

export function encryptTotpSeed(
  seed: Buffer,
  binding: TotpSeedBinding,
  keyring: TotpKeyring,
): EncryptedTotpSeed {
  const nonce = crypto.randomBytes(NONCE_BYTES);
  const cipher = crypto.createCipheriv(
    'aes-256-gcm',
    lookupKey(keyring, keyring.activeKeyId),
    nonce,
    {
      authTagLength: AUTH_TAG_BYTES,
    },
  );
  cipher.setAAD(additionalData(binding));
  const ciphertext = Buffer.concat([cipher.update(seed), cipher.final()]);
  return {
    encryptionKeyId: keyring.activeKeyId,
    secretNonce: nonce.toString('base64'),
    secretCiphertext: ciphertext.toString('base64'),
    secretAuthTag: cipher.getAuthTag().toString('base64'),
  };
}

function decryptFailed(): TotpCryptoError {
  return new TotpCryptoError('DECRYPT_FAILED', 'TOTP seed could not be decrypted');
}

export function decryptTotpSeed(
  encrypted: EncryptedTotpSeed,
  binding: TotpSeedBinding,
  keyring: TotpKeyring,
): Buffer {
  const key = lookupKey(keyring, encrypted.encryptionKeyId);
  const nonce = Buffer.from(encrypted.secretNonce, 'base64');
  const tag = Buffer.from(encrypted.secretAuthTag, 'base64');
  if (nonce.length !== NONCE_BYTES || tag.length !== AUTH_TAG_BYTES) {
    throw decryptFailed();
  }
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce, {
      authTagLength: AUTH_TAG_BYTES,
    });
    decipher.setAAD(additionalData(binding));
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted.secretCiphertext, 'base64')),
      decipher.final(),
    ]);
  } catch {
    throw decryptFailed();
  }
}

export function totpSeedNeedsRewrap(encrypted: EncryptedTotpSeed, keyring: TotpKeyring): boolean {
  return encrypted.encryptionKeyId !== keyring.activeKeyId;
}

/** Decrypt under the recorded key and encrypt again under the active one. */
export function rewrapTotpSeed(
  encrypted: EncryptedTotpSeed,
  binding: TotpSeedBinding,
  keyring: TotpKeyring,
): EncryptedTotpSeed {
  return encryptTotpSeed(decryptTotpSeed(encrypted, binding, keyring), binding, keyring);
}

/* ------------------------------------------------------------------ */
/* Recovery codes                                                      */
/* ------------------------------------------------------------------ */

export const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_BYTES = 16;
const RECOVERY_DIGEST_DOMAIN = 'drydock-totp-recovery\0';
const NORMALIZED_RECOVERY_PATTERN = /^[0-9a-f]{32}$/;

/**
 * `count` distinct codes of 128 random bits, shown as four dash-joined groups
 * of eight hex characters. The plaintext exists only in this return value.
 */
export function generateRecoveryCodes(count: number = RECOVERY_CODE_COUNT): string[] {
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new TotpCryptoError('INVALID_ARGUMENT', 'Invalid recovery code count');
  }
  const seen = new Set<string>();
  const codes: string[] = [];
  while (codes.length < count) {
    const hex = crypto.randomBytes(RECOVERY_CODE_BYTES).toString('hex');
    if (seen.has(hex)) {
      continue;
    }
    seen.add(hex);
    codes.push(hex.replace(/(.{8})(?=.)/g, '$1-'));
  }
  return codes;
}

/** Lowercase hex with separators and whitespace removed, or null if malformed. */
export function normalizeRecoveryCode(code: string): string | null {
  if (typeof code !== 'string') {
    return null;
  }
  const normalized = code.replace(/[\s-]/g, '').toLowerCase();
  return NORMALIZED_RECOVERY_PATTERN.test(normalized) ? normalized : null;
}

function digestNormalized(normalized: string): string {
  return sha256(`${RECOVERY_DIGEST_DOMAIN}${normalized}`).toString('hex');
}

/** SHA-256 hex digest persisted in place of the code. Throws on a malformed code. */
export function digestRecoveryCode(code: string): string {
  const normalized = normalizeRecoveryCode(code);
  if (normalized === null) {
    throw new TotpCryptoError('INVALID_ARGUMENT', 'Invalid recovery code');
  }
  return digestNormalized(normalized);
}

const MALFORMED_RECOVERY_DIGEST = digestNormalized('0'.repeat(32));

/**
 * The unused row whose digest matches `code`. Every row is compared, matching
 * or not, and a malformed code is compared against a dummy digest, so timing
 * reveals neither how many codes are left nor where a match sits.
 */
export function findRecoveryCodeMatch<T extends { codeDigest: string; usedAt: string | null }>(
  code: string,
  rows: readonly T[],
): T | undefined {
  const normalized = normalizeRecoveryCode(code);
  const probe = Buffer.from(
    normalized === null ? MALFORMED_RECOVERY_DIGEST : digestNormalized(normalized),
    'hex',
  );
  let match: T | undefined;
  for (const row of rows) {
    const stored = Buffer.from(row.codeDigest, 'hex');
    const equal = stored.length === probe.length && crypto.timingSafeEqual(stored, probe);
    if (equal && normalized !== null && row.usedAt === null && match === undefined) {
      match = row;
    }
  }
  return match;
}
