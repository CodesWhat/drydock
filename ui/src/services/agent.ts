import type { ApiAgent, ApiAgentIdentity } from '../types/api';
import { extractCollectionData, readJsonResponse } from '../utils/api';

const BASE_URL = '/api/v1/agents';

export async function getAgentRoster(): Promise<ApiAgentIdentity[]> {
  const response = await fetch(`${BASE_URL}/roster`, { credentials: 'include' });
  if (!response.ok) throw new Error(`Failed to get agent roster: ${response.status}`);
  const payload = await readJsonResponse(response);
  if (
    !payload ||
    typeof payload !== 'object' ||
    !('data' in payload) ||
    !Array.isArray(payload.data)
  ) {
    throw new Error('Invalid agent roster response');
  }
  return payload.data.map((item: unknown) => {
    if (
      !item ||
      typeof item !== 'object' ||
      !('name' in item) ||
      typeof item.name !== 'string' ||
      item.name.length === 0
    ) {
      throw new Error('Invalid agent roster response');
    }
    return { name: item.name };
  });
}

export async function getAgents(): Promise<ApiAgent[]> {
  const response = await fetch(BASE_URL, { credentials: 'include' });
  if (!response.ok) {
    throw new Error(`Failed to get agents: ${response.statusText}`);
  }
  const payload = await readJsonResponse(response);
  return extractCollectionData<ApiAgent>(payload);
}
