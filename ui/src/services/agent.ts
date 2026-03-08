import { extractCollectionData } from '../utils/api';

const BASE_URL = '/api/agents';

export function getAgentIcon() {
  return 'sh-robot';
}

export async function getAgents() {
  const response = await fetch(BASE_URL, { credentials: 'include' });
  if (!response.ok) {
    throw new Error(`Failed to get agents: ${response.statusText}`);
  }
  const payload = await response.json();
  return extractCollectionData(payload);
}
