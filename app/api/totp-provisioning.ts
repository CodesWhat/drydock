/**
 * What an authenticator app needs to enroll: the seed as RFC 4648 base32 and
 * the `otpauth:` URI that carries it. The backend returns text, never a QR
 * image; the UI draws the code locally so the secret never leaves the page.
 */

import { TOTP_DIGITS, TOTP_PERIOD_SECONDS } from './totp-crypto.js';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const OTPAUTH_ISSUER = 'Drydock';

/** RFC 4648 base32 without padding, the encoding authenticator apps expect. */
export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

/**
 * The provisioning URI. The label is `Drydock:<username>@<host>` so two
 * instances, or two accounts, are told apart in the app; every part is
 * percent-encoded so a username cannot add a parameter or end the path.
 */
export function buildOtpauthUri(input: { secret: string; username: string; host: string }): string {
  const label = `${encodeURIComponent(OTPAUTH_ISSUER)}:${encodeURIComponent(
    `${input.username}@${input.host}`,
  )}`;
  const query = new URLSearchParams({
    secret: input.secret,
    issuer: OTPAUTH_ISSUER,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}
