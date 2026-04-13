type ContainerRuntimeContextContainerRef = {
  id?: unknown;
};

type ContainerUpdateRuntimeContext = {
  operationId?: unknown;
  operationIds?: Record<string, unknown>;
};

export function normalizeRequestedOperationId(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmedOperationId = value.trim();
  return trimmedOperationId.length > 0 ? trimmedOperationId : undefined;
}

export function getRequestedOperationId(
  container: ContainerRuntimeContextContainerRef,
  runtimeContext?: unknown,
): string | undefined {
  if (!runtimeContext || typeof runtimeContext !== 'object') {
    return undefined;
  }

  const typedRuntimeContext = runtimeContext as ContainerUpdateRuntimeContext;
  const directOperationId = normalizeRequestedOperationId(typedRuntimeContext.operationId);
  if (directOperationId) {
    return directOperationId;
  }

  const operationIds = typedRuntimeContext.operationIds;
  if (!operationIds || typeof operationIds !== 'object') {
    return undefined;
  }

  return normalizeRequestedOperationId(operationIds[String(container.id ?? '')]);
}
