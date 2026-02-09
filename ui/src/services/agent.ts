const BASE_URL = '/api/agents';

export function getAgentIcon() {
  return 'mdi-lan';
}

export async function getAgents() {
  const response = await fetch(BASE_URL, { credentials: "include" });
  if (!response.ok) {
    throw new Error(`Failed to get agents: ${response.statusText}`);
  }
  return response.json();
}

export default {
  getAgents,
};
