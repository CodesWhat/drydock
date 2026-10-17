import { extractCollectionData, readJsonResponse } from '../utils/api';
import { ApiError, errorMessage } from '../utils/error';

export interface ContainerBackup {
  id: string;
  containerId: string;
  containerName: string;
  containerIdentityKey?: string;
  imageName: string;
  imageTag: string;
  imageDigest?: string;
  timestamp: string;
  triggerName: string;
}

async function getBackups(containerId: string) {
  const response = await fetch(`/api/v1/containers/${containerId}/backups`, {
    credentials: 'include',
  });
  if (!response.ok) {
    throw new ApiError(response.statusText, response.status);
  }
  const payload = await readJsonResponse(response);
  return extractCollectionData<ContainerBackup>(payload);
}

async function rollback(containerId: string, backupId?: string) {
  const options: RequestInit = {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-DD-Confirm-Action': 'container-rollback',
    },
  };
  if (backupId) {
    options.body = JSON.stringify({ backupId });
  }
  const response = await fetch(`/api/v1/containers/${containerId}/rollback`, options);
  if (!response.ok) {
    let details = '';
    try {
      const body = await response.json();
      details = typeof body?.error === 'string' && body.error.trim() ? ` (${body.error})` : '';
    } catch (e: unknown) {
      const parseErrorMessage = errorMessage(e, '');
      details = parseErrorMessage ? ` (${parseErrorMessage})` : '';
    }
    throw new ApiError(`${response.statusText}${details}`, response.status);
  }
  return readJsonResponse(response);
}

export { getBackups, rollback };
