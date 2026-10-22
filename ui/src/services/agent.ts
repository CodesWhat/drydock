import { extractCollectionData, readJsonResponse } from '../utils/api';
import { withLastKnown } from './last-known';

const BASE_URL = '/api/v1/agents';

interface ApiAgent {
  name: string;
  connected: boolean;
  host?: string;
  port?: string | number;
  [key: string]: unknown;
}

export async function getAgents(): Promise<ApiAgent[]> {
  return withLastKnown('agents', async () => {
    const response = await fetch(BASE_URL, { credentials: 'include' });
    if (!response.ok) {
      throw new Error(`Failed to get agents: ${response.statusText}`);
    }
    const payload = await readJsonResponse(response);
    return extractCollectionData<ApiAgent>(payload);
  });
}
