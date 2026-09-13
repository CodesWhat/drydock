import { readJsonResponse } from '../utils/api';

interface AppInfos {
  name: string;
  version: string;
}

async function getAppInfos() {
  const response = await fetch('/api/v1/app', { credentials: 'include' });
  if (!response.ok) {
    throw new Error(`Failed to get app infos: ${response.statusText}`);
  }
  return readJsonResponse<AppInfos | null>(response);
}

export { getAppInfos };
