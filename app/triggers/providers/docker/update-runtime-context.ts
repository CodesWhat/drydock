type ContainerRuntimeContextContainerRef = {
  id?: unknown;
};

type ContainerUpdateRuntimeContext = {
  operationId?: unknown;
  // Accept Map for new callers (preferred — no prototype-pollution risk when
  // keys come from a remote payload) or Record for legacy in-process callers
  // (request-update.buildAcceptedUpdateRuntimeContext, populated from
  // server-generated UUIDs).
  operationIds?: Map<string, unknown> | Record<string, unknown>;
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
  if (operationIds) {
    const key = String(container.id ?? '');
    const rawValue =
      operationIds instanceof Map
        ? operationIds.get(key)
        : typeof operationIds === 'object'
          ? // Look up via Object.hasOwn + Reflect.get so a key derived from
            // remote input (e.g. "__proto__") cannot reach the prototype
            // chain (CodeQL js/remote-property-injection).
            Object.hasOwn(operationIds, key)
            ? Reflect.get(operationIds, key)
            : undefined
          : undefined;
    const mappedOperationId = normalizeRequestedOperationId(rawValue);
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
