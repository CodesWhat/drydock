type ContainerRuntimeContextContainerRef = {
  id?: unknown;
};

type ContainerUpdateRuntimeContext = {
  operationId?: unknown;
  operationIds?: Record<string, unknown>;
  runtimeContext?: unknown;
};

export function normalizeRequestedOperationId(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmedOperationId = value.trim();
  return trimmedOperationId.length > 0 ? trimmedOperationId : undefined;
}

function getRequestedOperationIdFromContext(
  container: ContainerRuntimeContextContainerRef,
  runtimeContext?: unknown,
  seenContexts: Set<object> = new Set(),
): string | undefined {
  if (!runtimeContext || typeof runtimeContext !== 'object') {
    return undefined;
  }
  if (seenContexts.has(runtimeContext)) {
    return undefined;
  }
  seenContexts.add(runtimeContext);

  const typedRuntimeContext = runtimeContext as ContainerUpdateRuntimeContext;
  const directOperationId = normalizeRequestedOperationId(typedRuntimeContext.operationId);
  if (directOperationId) {
    return directOperationId;
  }

  const operationIds = typedRuntimeContext.operationIds;
  if (operationIds && typeof operationIds === 'object') {
    const mappedOperationId = normalizeRequestedOperationId(
      operationIds[String(container.id ?? '')],
    );
    if (mappedOperationId) {
      return mappedOperationId;
    }
  }

  return getRequestedOperationIdFromContext(
    container,
    typedRuntimeContext.runtimeContext,
    seenContexts,
  );
}

export function getRequestedOperationId(
  container: ContainerRuntimeContextContainerRef,
  runtimeContext?: unknown,
): string | undefined {
  return getRequestedOperationIdFromContext(container, runtimeContext);
}
