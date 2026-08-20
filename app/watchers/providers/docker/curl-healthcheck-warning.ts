import { getCurlHealthcheckOverrideStartupWarning } from '../../../compatibility/curl-healthcheck.js';

interface WarnableLog {
  warn: (message: string) => void;
}

/**
 * Warn once at watcher startup when this container's own HEALTHCHECK
 * override still shells out to curl. curl was removed from the Docker image
 * in v1.7.0, so those overrides start failing on upgrade (see
 * DEPRECATIONS.md). Kept in its own module so Docker.ts only needs the
 * import and a single call site.
 */
export async function warnIfCurlHealthcheckOverride(log: WarnableLog): Promise<void> {
  const warning = await getCurlHealthcheckOverrideStartupWarning();
  if (warning) {
    log.warn(warning);
  }
}
