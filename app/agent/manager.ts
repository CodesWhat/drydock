import type { AgentClient } from './AgentClient.js';

const clients: AgentClient[] = [];

/**
 * Get all agent clients.
 * @returns {AgentClient[]} the list of agent clients
 */
export function getAgents(): AgentClient[] {
  return clients;
}

/**
 * Get an agent client by name.
 * @param name the name of the agent
 * @returns {AgentClient | undefined} the agent client
 */
export function getAgent(name: string): AgentClient | undefined {
  return clients.find((client) => client.name === name);
}

/**
 * Add an agent client.
 * @param client the agent client
 */
export function addAgent(client: AgentClient): void {
  clients.push(client);
}

/**
 * Remove agent client(s) by name.
 * @param name the name of the agent
 * @returns {boolean} true when one or more clients were removed
 */
export function removeAgent(name: string): boolean {
  const initialCount = clients.length;
  for (let index = clients.length - 1; index >= 0; index -= 1) {
    if (clients[index].name === name) {
      clients.splice(index, 1);
    }
  }
  return clients.length < initialCount;
}
