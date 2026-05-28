import { readJsonResponse } from '../utils/api';

async function getAppInfos() {
  const response = await fetch('/api/v1/app', { credentials: 'include' });
  if (!response.ok) {
    throw new Error(`Failed to get app infos: ${response.statusText}`);
  }
  return readJsonResponse(response);
}

export { getAppInfos };
