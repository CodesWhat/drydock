import type { Container, ContainerImage } from '../../model/container.js';
import { getErrorMessage } from '../../util/error.js';

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
];

export function isSensitiveKey(key: string): boolean {
  const upper = key.toUpperCase();
  return SENSITIVE_KEY_PATTERNS.some((pattern) => upper.includes(pattern));
}

export function getErrorStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }

  const response = (error as { response?: unknown }).response;
  if (!response || typeof response !== 'object') {
    return undefined;
  }

  const status = (response as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
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
        const sensitive = isSensitiveKey(entry.key);
        return {
          key: entry.key,
          value: sensitive ? '[REDACTED]' : entry.value,
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
  return `${container.image.registry.url}/${container.image.name}:${tag}`;
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
