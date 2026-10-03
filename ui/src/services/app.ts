import { readJsonResponse } from '../utils/api';

interface AppInfos {
  name: string;
  /** Base version, prerelease suffix removed (1.6.1). */
  version: string;
  /** Full build identity (1.6.1-rc.15). Absent from a server older than this field. */
  build?: string;
}

async function getAppInfos() {
  const response = await fetch('/api/v1/app', { credentials: 'include' });
  if (!response.ok) {
    throw new Error(`Failed to get app infos: ${response.statusText}`);
  }
  return readJsonResponse<AppInfos | null>(response);
}

export { getAppInfos };
