/**
 * Pure helper for building a plain image reference string from its three parts:
 * registry URL, image name, and tag-or-digest.
 *
 * The registry URL is a v2 API base (e.g. "https://registry-1.docker.io/v2").
 * Cleaning is applied to the URL ONLY, before concatenation, so that a `/v2`
 * path segment inside the image name is never accidentally stripped.
 */
/**
 * Reduce a registry v2 API base to the host (and port, and any path prefix)
 * that appears in a Docker image reference: strip the scheme anchored to the
 * start, then strip /v2 only as a trailing path segment (with optional
 * trailing slash).
 *
 * Exported so callers that need to read a reference back apart can rebuild the
 * exact prefix `buildImageReference` puts on the front of one.
 */
export function cleanRegistryUrl(registryUrl: string): string {
  return registryUrl.replace(/^https?:\/\//, '').replace(/\/v2\/?$/, '');
}

export function buildImageReference(
  registryUrl: string,
  imageName: string,
  tagOrDigest: string,
): string {
  const cleanedUrl = cleanRegistryUrl(registryUrl);

  // Digests use '@' as separator; plain tags use ':'.
  const separator = tagOrDigest.includes(':') ? '@' : ':';

  return `${cleanedUrl}/${imageName}${separator}${tagOrDigest}`;
}
