import { AgentClient } from './AgentClient';

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
