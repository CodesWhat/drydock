/**
 * Returns the PAT token from the first credentialed GHCR registry instance,
 * or undefined if none is configured.
 *
 * GHCR tokens (github.com PATs) work for both the container registry and the
 * GitHub REST API, so the release-notes provider can reuse them when no
 * dedicated DD_RELEASE_NOTES_GITHUB_TOKEN is set.
 */

import { getState } from '../registry/index.js';

export function getGhcrTokenFallback(): string | undefined {
  const registryState = getState().registry;
  for (const instance of Object.values(registryState)) {
    // Duck-type: we only need the provider type and the token field.
    const cfg = (instance as { type?: string; configuration?: { token?: string } }).configuration;
    const type = (instance as { type?: string }).type;
    if (type === 'ghcr' && typeof cfg?.token === 'string' && cfg.token.length > 0) {
      return cfg.token;
    }
  }
  return undefined;
}
