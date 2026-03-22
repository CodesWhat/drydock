import type { Container } from '../../model/container.js';
import Trigger from '../../triggers/providers/Trigger.js';
import { getRequiredAgentClient } from './getRequiredAgentClient.js';

/**
 * Agent Trigger.
 * Acts as a proxy for the remote trigger running on the agent.
 */
class AgentTrigger extends Trigger {
  /**
   * Trigger method.
   * Delegates to the agent.
   */
  async trigger(container: Container): Promise<unknown> {
    const client = getRequiredAgentClient(this.agent, 'AgentTrigger');
    return client.runRemoteTrigger(container, this.type, this.name);
  }

  /**
   * Trigger batch method.
   * Delegates to the agent.
   */
  async triggerBatch(containers: Container[]): Promise<unknown> {
    const client = getRequiredAgentClient(this.agent, 'AgentTrigger');
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
