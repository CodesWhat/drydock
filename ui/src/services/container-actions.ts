export interface BulkContainerUpdateAcceptedItem {
  containerId: string;
  containerName: string;
  operationId: string;
}

export interface BulkContainerUpdateRejectedItem {
  containerId: string;
  containerName: string;
  message: string;
  statusCode: number;
}

export interface BulkContainerUpdateResponse {
  message: string;
  accepted: BulkContainerUpdateAcceptedItem[];
  rejected: BulkContainerUpdateRejectedItem[];
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

async function updateContainer(containerId: string) {
  const response = await fetch(`/api/v1/containers/${containerId}/update`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body?.error || `Failed to update container: ${response.statusText}`);
  }
  return response.json();
}

async function updateContainers(containerIds: string[]): Promise<BulkContainerUpdateResponse> {
  const response = await fetch('/api/v1/containers/update', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ containerIds }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body?.error || `Failed to update containers: ${response.statusText}`);
  }
  return response.json();
}

type CancelUpdateOperationOutcome = 'cancelled' | 'cancel-requested';

async function cancelUpdateOperation(operationId: string): Promise<CancelUpdateOperationOutcome> {
  const response = await fetch(`/api/operations/${encodeURIComponent(operationId)}/cancel`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = new Error(body?.error || `Failed to cancel operation: ${response.statusText}`);
    (error as Error & { statusCode?: number }).statusCode = response.status;
    throw error;
  }
  return response.status === 202 ? 'cancel-requested' : 'cancelled';
}

export {
  cancelUpdateOperation,
  restartContainer,
  startContainer,
  stopContainer,
  updateContainer,
  updateContainers,
};
