import Watcher from '../../watchers/Watcher';
import { Container } from '../../model/container';
import { getAgent } from '../manager';

/**
 * Agent Watcher.
 * Acts as a proxy for the remote watcher running on the agent.
 */
class AgentWatcher extends Watcher {
    /**
     * Watch main method.
     * Delegate to the agent client.
     */
    async watch(): Promise<any[]> {
        const agentName = this.agent;
        if (!agentName) {
            throw new Error('AgentWatcher must have an agent assigned');
        }
        const client = getAgent(agentName);
        if (!client) {
            throw new Error(`Agent ${agentName} not found`);
        }
        return client.watch(this.type, this.name);
    }

    /**
     * Watch a Container.
     * Delegate to the agent client.
     */
    async watchContainer(container: Container): Promise<any> {
        const agentName = this.agent;
        if (!agentName) {
            throw new Error('AgentWatcher must have an agent assigned');
        }
        const client = getAgent(agentName);
        if (!client) {
            throw new Error(`Agent ${agentName} not found`);
        }
        return client.watchContainer(this.type, this.name, container);
    }

    /**
     * Configuration schema.
     * Relaxed validation since the agent has already validated the config.
     */
    getConfigurationSchema() {
        return this.joi.object().unknown();
    }
}

export default AgentWatcher;
