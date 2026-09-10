import type { ApiAgent } from '../types/api';
import { extractCollectionData, readJsonResponse } from '../utils/api';

const BASE_URL = '/api/v1/agents';

export async function getAgents(): Promise<ApiAgent[]> {
  const response = await fetch(BASE_URL, { credentials: 'include' });
  if (!response.ok) {
    throw new Error(`Failed to get agents: ${response.statusText}`);
  }
  const payload = await readJsonResponse(response);
  return extractCollectionData<ApiAgent>(payload);
}
