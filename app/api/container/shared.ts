// @ts-nocheck

const REDACTED_RUNTIME_ENV_VALUE = '[REDACTED]';

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

function redactContainerRuntimeDetails(details) {
  if (!details || typeof details !== 'object' || !Array.isArray(details.env)) {
    return details;
  }

  return {
    ...details,
    env: details.env
      .filter((entry) => entry && typeof entry === 'object' && typeof entry.key === 'string')
      .map((entry) => ({
        key: entry.key,
        value: REDACTED_RUNTIME_ENV_VALUE,
      })),
  };
}

export function redactContainerRuntimeEnv(container) {
  if (!container || typeof container !== 'object' || !container.details) {
    return container;
  }

  return {
    ...container,
    details: redactContainerRuntimeDetails(container.details),
  };
}

export function redactContainersRuntimeEnv(containers) {
  if (!Array.isArray(containers)) {
    return containers;
  }

  return containers.map((container) => redactContainerRuntimeEnv(container));
}

export function resolveContainerImageFullName(container, registryState, tagOverride?: string) {
  const tag = tagOverride || container.image.tag.value;
  const containerRegistry = registryState[container.image.registry.name];
  if (containerRegistry && typeof containerRegistry.getImageFullName === 'function') {
    return containerRegistry.getImageFullName(container.image, tag);
  }
  return `${container.image.registry.url}/${container.image.name}:${tag}`;
}

export async function resolveContainerRegistryAuth(
  container,
  registryState,
  {
    log,
    sanitizeLogParam,
  }: {
    log: { warn: (message: string) => void };
    sanitizeLogParam: (value: unknown, maxLength?: number) => string;
  },
) {
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
