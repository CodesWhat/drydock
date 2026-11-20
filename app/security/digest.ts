const IMMUTABLE_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;

/**
 * Whether a value is a real content digest. A registry that omits Docker-Content-Digest makes
 * Drydock fall back to the tag as the "digest", and a reference built from that is mutable.
 */
export function isImmutableDigest(value: unknown): value is string {
  return typeof value === 'string' && IMMUTABLE_DIGEST_PATTERN.test(value);
}

/**
 * Whether a scanned reference is pinned to exactly this digest (`repo@sha256:...`, or
 * `repo:tag@sha256:...`). A tag reference, or a missing one, is not.
 */
export function isScannedRefPinnedTo(scannedRef: unknown, digest: unknown): boolean {
  return (
    isImmutableDigest(digest) && typeof scannedRef === 'string' && scannedRef.endsWith(`@${digest}`)
  );
}
