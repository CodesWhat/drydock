import { AgentClient, AgentClientConfig } from './AgentClient';
import log from '../log';
import { getState } from '../registry';
import { addAgent } from './manager';

export * from './manager';

export async function init(): Promise<void> {
    const registryState = getState();
    const agents = registryState.agent;

    Object.keys(agents).forEach((agentId) => {
        const agentComponent = agents[agentId];
        const name = agentComponent.name;
        const config = agentComponent.configuration as AgentClientConfig;

        if (!config.host || !config.secret) {
            log.warn(`Skipping agent ${name}: Missing host or secret`);
            return;
        }

        const client = new AgentClient(name, config);
        addAgent(client);
        // Start without awaiting to not block main init
        client.init();
    });
}
