import type { Container, ContainerImage } from '../../model/container.js';
import { buildImageReference } from '../../registries/image-reference.js';
import { getErrorMessage, getErrorStatusCode } from '../../util/error.js';

type RegistryAuth = { username?: string; password?: string };

interface RegistryComponentLike {
  getImageFullName?: (image: ContainerImage, tagOrDigest: string) => string;
  getAuthPull?: () => Promise<RegistryAuth | undefined>;
}

interface ObjectWithDetails {
  details?: unknown;
  [key: string]: unknown;
}

interface ObjectWithEnv {
  env?: unknown;
  [key: string]: unknown;
}

function hasEnvKey(entry: unknown): entry is { key: string; value: string } {
  return (
    !!entry && typeof entry === 'object' && typeof (entry as { key?: unknown }).key === 'string'
  );
}

const SENSITIVE_KEY_PATTERNS = [
  'PASSWORD',
  'PASSWD',
  'SECRET',
  'TOKEN',
  'API_KEY',
  'APIKEY',
  'PRIVATE_KEY',
  'CREDENTIAL',
  'AUTH',
  'ACCESS_KEY',
  'ACCESSKEY',
  'CLIENTKEY',
  'SIGNINGKEY',
];

// Short tokens that require an exact segment match (split on '_') to prevent
// substring false positives. For example, 'PASS' would otherwise match
// 'COMPASS' or 'BYPASS' under a plain .includes() check. 'KEY' is here for the
// same reason ('MONKEY', 'KEYBOARD'): ENCRYPTION_KEY and LITELLM_MASTER_KEY are
// credentials that no compound pattern above names (#1523).
const SENSITIVE_SEGMENT_PATTERNS = ['PASS', 'PAT', 'KEY'];

export function isSensitiveKey(key: string): boolean {
  const upper = key.toUpperCase();
  if (SENSITIVE_KEY_PATTERNS.some((pattern) => upper.includes(pattern))) {
    return true;
  }
  const segments = upper.split('_');
  return SENSITIVE_SEGMENT_PATTERNS.some((pattern) => segments.includes(pattern));
}

export function hasUrlCredentials(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  try {
    // Parsed against a dummy base so scheme-relative values (e.g.
    // "//user:pass@host/path") resolve instead of throwing, since a bare
    // new URL() has no scheme to anchor them.
    const parsed = new URL(value, 'http://redaction.invalid');
    return parsed.username.length > 0 || parsed.password.length > 0;
  } catch {
    return false;
  }
}

export function isSensitiveEnvEntry(entry: { key: string; value?: unknown }): boolean {
  return isSensitiveKey(entry.key) || hasUrlCredentials(entry.value);
}

export const REDACTED_ENV_VALUE = '[REDACTED]';

/**
 * Details as they are written to the store (#1523): every env entry that
 * `isSensitiveEnvEntry` flags keeps its key but loses its value, and the API-only
 * `sensitive` marker is dropped so the result still passes the container schema.
 * Idempotent, so a row that is already redacted, or an already-classified payload
 * from an API response or an agent, comes out the same.
 */
export function redactRuntimeDetailsForStorage<T>(details: T): T {
  if (!details || typeof details !== 'object') {
    return details;
  }

  const detailsWithEnv = details as ObjectWithEnv;
  if (!Array.isArray(detailsWithEnv.env)) {
    return details;
  }

  return {
    ...detailsWithEnv,
    env: detailsWithEnv.env
      .filter((entry) => hasEnvKey(entry))
      .map((entry) => ({
        key: entry.key,
        value: isSensitiveEnvEntry(entry) ? REDACTED_ENV_VALUE : entry.value,
      })),
  } as T;
}

function classifyContainerRuntimeDetails<T>(details: T): T {
  if (!details || typeof details !== 'object') {
    return details;
  }

  const detailsWithEnv = details as ObjectWithEnv;
  if (!Array.isArray(detailsWithEnv.env)) {
    return details;
  }

  return {
    ...detailsWithEnv,
    env: detailsWithEnv.env
      .filter((entry) => hasEnvKey(entry))
      .map((entry) => {
        const sensitive = isSensitiveEnvEntry(entry);
        return {
          key: entry.key,
          value: sensitive ? REDACTED_ENV_VALUE : entry.value,
          sensitive,
        };
      }),
  } as T;
}

function classifyContainerRuntimeEnv<T>(container: T): T {
  if (!container || typeof container !== 'object') {
    return container;
  }

  const containerWithDetails = container as ObjectWithDetails;
  if (!containerWithDetails.details) {
    return container;
  }

  const redacted = {
    ...containerWithDetails,
    details: classifyContainerRuntimeDetails(containerWithDetails.details),
  };

  // Re-attach non-enumerable resultChanged so structuredClone-based copies don't
  // silently drop the function that the watcher cron relies on for change detection.
  const src = container as { resultChanged?: unknown };
  if (typeof src.resultChanged === 'function') {
    Object.defineProperty(redacted, 'resultChanged', {
      value: src.resultChanged,
      enumerable: false,
      writable: true,
      configurable: true,
    });
  }

  return redacted as T;
}

function classifyContainersRuntimeEnv<T>(containers: T): T {
  if (!Array.isArray(containers)) {
    return containers;
  }

  return containers.map((container) => classifyContainerRuntimeEnv(container)) as T;
}

export const redactContainerRuntimeEnv = classifyContainerRuntimeEnv;
export const redactContainersRuntimeEnv = classifyContainersRuntimeEnv;

/**
 * Spec 7.5: the API and SSE show where each label-owned field comes from
 * (`labelOwnedSources`) and never the declared layer behind it, which only the label
 * override editor endpoint serves. A container with no state is returned as is.
 */
export function projectLabelOwnedForApi<T>(container: T): T {
  if (!container || typeof container !== 'object') {
    return container;
  }
  const { labelOwned, ...rest } = container as { labelOwned?: Container['labelOwned'] };
  return labelOwned === undefined
    ? container
    : ({ ...rest, labelOwnedSources: labelOwned.sources } as T);
}

/** A container as the API serves it: runtime env classified, label-owned state projected. */
export function toApiContainer<T>(container: T): T {
  return projectLabelOwnedForApi(classifyContainerRuntimeEnv(container));
}

export function toApiContainers<T>(containers: T): T {
  return Array.isArray(containers)
    ? (containers.map((container) => toApiContainer(container)) as T)
    : containers;
}

export function resolveContainerImageFullName(
  container: Container,
  registryState: Record<string, RegistryComponentLike>,
  tagOverride?: string,
): string {
  const tag = tagOverride || container.image.tag.value;
  const containerRegistry = registryState[container.image.registry.name];
  if (containerRegistry && typeof containerRegistry.getImageFullName === 'function') {
    return containerRegistry.getImageFullName(container.image, tag);
  }
  // No registry component is available — controller mode runs registries on
  // the agents, not the controller. Delegate to the shared buildImageReference
  // helper (same logic as Registry.getImageFullName) so scanners receive a
  // plain image reference: registry.url is the v2 API base
  // (e.g. "https://registry-1.docker.io/v2"), which Trivy would otherwise
  // treat as a literal host, producing "https://https/v2/" DNS failures.
  // See issue #374.
  return buildImageReference(container.image.registry.url, container.image.name, tag);
}

export async function resolveContainerRegistryAuth(
  container: Container,
  registryState: Record<string, RegistryComponentLike>,
  {
    log,
    sanitizeLogParam,
  }: {
    log: { warn: (message: string) => void };
    sanitizeLogParam: (value: unknown, maxLength?: number) => string;
  },
): Promise<RegistryAuth | undefined> {
  try {
    const containerRegistry = registryState[container.image.registry.name];
    if (containerRegistry && typeof containerRegistry.getAuthPull === 'function') {
      return await containerRegistry.getAuthPull();
    }
  } catch (error: unknown) {
    log.warn(
      `Unable to retrieve registry auth for SBOM generation (container=${sanitizeLogParam(
        container.id,
      )}): ${sanitizeLogParam(getErrorMessage(error))}`,
    );
  }
  return undefined;
}

export { getErrorStatusCode };
