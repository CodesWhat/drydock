import type { Container, ContainerImage } from '../../model/container.js';

const REDACTED_RUNTIME_ENV_VALUE = '[REDACTED]';
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

function hasEnvKey(entry: unknown): entry is { key: string } {
  return (
    !!entry && typeof entry === 'object' && typeof (entry as { key?: unknown }).key === 'string'
  );
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error && typeof error.message === 'string' && error.message.trim() !== '') {
    return error.message;
  }
  if (typeof error === 'string' && error.trim() !== '') {
    return error;
  }
  if (
    error &&
    typeof error === 'object' &&
    typeof (error as { message?: unknown }).message === 'string' &&
    ((error as { message: string }).message || '').trim() !== ''
  ) {
    return (error as { message: string }).message;
  }
  return 'unknown error';
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

function redactContainerRuntimeDetails<T>(details: T): T {
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
        value: REDACTED_RUNTIME_ENV_VALUE,
      })),
  } as T;
}

export function redactContainerRuntimeEnv<T>(container: T): T {
  if (!container || typeof container !== 'object') {
    return container;
  }

  const containerWithDetails = container as ObjectWithDetails;
  if (!containerWithDetails.details) {
    return container;
  }

  return {
    ...containerWithDetails,
    details: redactContainerRuntimeDetails(containerWithDetails.details),
  } as T;
}

export function redactContainersRuntimeEnv<T>(containers: T): T {
  if (!Array.isArray(containers)) {
    return containers;
  }

  return containers.map((container) => redactContainerRuntimeEnv(container)) as T;
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
