export interface UpdateContainerBatchMetadata {
  batchId?: string;
  queuePosition?: number;
  queueTotal?: number;
}

function hasValidUpdateContainerBatchMetadata(
  metadata?: UpdateContainerBatchMetadata,
): metadata is {
  batchId: string;
  queuePosition: number;
  queueTotal: number;
} {
  return (
    !!metadata?.batchId &&
    Number.isSafeInteger(metadata.queuePosition) &&
    metadata.queuePosition > 0 &&
    Number.isSafeInteger(metadata.queueTotal) &&
    metadata.queueTotal > 0 &&
    metadata.queuePosition <= metadata.queueTotal
  );
}

async function startContainer(containerId: string) {
  const response = await fetch(`/api/v1/containers/${containerId}/start`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body?.error || `Failed to start container: ${response.statusText}`);
  }
  return response.json();
}

async function stopContainer(containerId: string) {
  const response = await fetch(`/api/v1/containers/${containerId}/stop`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body?.error || `Failed to stop container: ${response.statusText}`);
  }
  return response.json();
}

async function restartContainer(containerId: string) {
  const response = await fetch(`/api/v1/containers/${containerId}/restart`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body?.error || `Failed to restart container: ${response.statusText}`);
  }
  return response.json();
}

async function updateContainer(containerId: string, metadata?: UpdateContainerBatchMetadata) {
  const response = await fetch(`/api/v1/containers/${containerId}/update`, {
    method: 'POST',
    credentials: 'include',
    ...(hasValidUpdateContainerBatchMetadata(metadata)
      ? {
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(metadata),
        }
      : {}),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body?.error || `Failed to update container: ${response.statusText}`);
  }
  return response.json();
}

export { restartContainer, startContainer, stopContainer, updateContainer };
