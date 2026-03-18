import { extractCollectionData } from '../utils/api';

const BASE_URL = '/api/v1/agents';

export interface ApiAgent {
  name: string;
  connected: boolean;
  host?: string;
  port?: string | number;
  [key: string]: unknown;
}

export async function getAgents(): Promise<ApiAgent[]> {
  const response = await fetch(BASE_URL, { credentials: 'include' });
  if (!response.ok) {
    throw new Error(`Failed to get agents: ${response.statusText}`);
  }
  const payload = await response.json();
  return extractCollectionData<ApiAgent>(payload);
}
