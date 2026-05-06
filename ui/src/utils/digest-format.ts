/**
 * Short-form display helpers for image digest strings.
 */

const SHA256_PREFIX = 'sha256:';
const SHORT_HEX_LENGTH = 12;

/**
 * Return a compact representation of a digest string for display.
 *
 * - `sha256:<hex>` → `sha256:<first-12-hex>…`  (if hex ≥ 12 chars)
 * - `<hex>` (no prefix) → `<first-12-hex>…`     (if hex ≥ 12 chars)
 * - Anything shorter than 12 chars after the prefix → returned unchanged.
 */
export function formatShortDigest(digest: string): string {
  let hex = digest;
  let prefix = '';

  if (digest.startsWith(SHA256_PREFIX)) {
    hex = digest.slice(SHA256_PREFIX.length);
    prefix = SHA256_PREFIX;
  }

  if (hex.length <= SHORT_HEX_LENGTH) {
    return digest;
  }

  return `${prefix}${hex.slice(0, SHORT_HEX_LENGTH)}…`;
}
