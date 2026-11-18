const IMMUTABLE_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;

/**
 * Whether a value is a real content digest. A registry that omits Docker-Content-Digest makes
 * Drydock fall back to the tag as the "digest", and a reference built from that is mutable.
 */
export function isImmutableDigest(value: unknown): value is string {
  return typeof value === 'string' && IMMUTABLE_DIGEST_PATTERN.test(value);
}
