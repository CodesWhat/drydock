/**
 * Pure helper for building a plain image reference string from its three parts:
 * registry URL, image name, and tag-or-digest.
 *
 * The registry URL is a v2 API base (e.g. "https://registry-1.docker.io/v2").
 * Cleaning is applied to the URL ONLY, before concatenation, so that a `/v2`
 * path segment inside the image name is never accidentally stripped.
 */
export function buildImageReference(
  registryUrl: string,
  imageName: string,
  tagOrDigest: string,
): string {
  // Clean the registry URL: strip the scheme anchored to the start, then strip
  // /v2 only as a trailing path segment (with optional trailing slash).
  const cleanedUrl = registryUrl.replace(/^https?:\/\//, '').replace(/\/v2\/?$/, '');

  // Digests use '@' as separator; plain tags use ':'.
  const separator = tagOrDigest.includes(':') ? '@' : ':';

  return `${cleanedUrl}/${imageName}${separator}${tagOrDigest}`;
}
