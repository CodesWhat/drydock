import crypto from 'node:crypto';

/**
 * RFC 9562 UUID v7 — time-ordered 128-bit identifier.
 *
 * Layout (128 bits):
 *   48-bit unix timestamp (milliseconds)
 *   4-bit version (0b0111 = 7)
 *   12-bit random
 *   2-bit variant (0b10)
 *   62-bit random
 *
 * Sort-by-string matches chronology, which makes scan cycles grep-friendly in logs.
 * No external dependency — supply-chain cleanliness.
 */
export function uuidv7(): string {
  const now = BigInt(Date.now());
  const timestampHex = now.toString(16).padStart(12, '0');

  const randBytes = crypto.randomBytes(10);
  // Byte 0 carries the version (top 4 bits = 0b0111).
  randBytes[0] = (randBytes[0] & 0x0f) | 0x70;
  // Byte 2 carries the variant (top 2 bits = 0b10).
  randBytes[2] = (randBytes[2] & 0x3f) | 0x80;
  const rand = randBytes.toString('hex');

  return `${timestampHex.slice(0, 8)}-${timestampHex.slice(8, 12)}-${rand.slice(0, 4)}-${rand.slice(4, 8)}-${rand.slice(8, 20)}`;
}
