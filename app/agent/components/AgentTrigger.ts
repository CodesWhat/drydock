// @ts-nocheck
import Trigger from '../../triggers/providers/Trigger';
import { Container } from '../../model/container';
import { getAgent } from '../manager';

/**
 * Agent Trigger.
 * Acts as a proxy for the remote trigger running on the agent.
 */
class AgentTrigger extends Trigger {
    /**
     * Trigger method.
     * Delegates to the agent.
     */
    async trigger(container: Container): Promise<any> {
        const agentName = this.agent;
        if (!agentName) {
            throw new Error('AgentTrigger must have an agent assigned');
        }
        const client = getAgent(agentName);
        if (!client) {
            throw new Error(`Agent ${agentName} not found`);
        }
        return client.runRemoteTrigger(container, this.type, this.name);
    }

    /**
     * Trigger batch method.
     * Delegates to the agent.
     */
    async triggerBatch(containers: Container[]): Promise<any> {
        const agentName = this.agent;
        if (!agentName) {
            throw new Error('AgentTrigger must have an agent assigned');
        }
        const client = getAgent(agentName);
        if (!client) {
            throw new Error(`Agent ${agentName} not found`);
        }
        return client.runRemoteTriggerBatch(containers, this.type, this.name);
    }

    /**
     * Configuration schema.
     * Relaxed validation since the agent has already validated the config.
     */
    getConfigurationSchema() {
        return this.joi.object().unknown();
    }
}

export default AgentTrigger;
