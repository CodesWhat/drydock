import type { AgentClient } from '../AgentClient.js';
import { getAgent } from '../manager.js';

export function getRequiredAgentClient(
  agentName: string | undefined,
  componentName: string,
): AgentClient {
  if (!agentName) {
    throw new Error(`${componentName} must have an agent assigned`);
  }

  const client = getAgent(agentName);
  if (!client) {
    throw new Error(`Agent ${agentName} not found`);
  }

  return client;
}
