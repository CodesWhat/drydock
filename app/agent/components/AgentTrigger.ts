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
   * Delegates to the agent, threading runtimeContext so the controller's
   * operationId survives the controller→agent boundary (fixes #289).
   */
  async trigger(container: Container, runtimeContext?: unknown): Promise<unknown> {
    const client = getRequiredAgentClient(this.agent, 'AgentTrigger');
    return client.runRemoteTrigger(container, this.type, this.name, runtimeContext);
  }

  /**
   * Trigger batch method.
   * Delegates to the agent, threading runtimeContext for per-container operationId
   * resolution on the agent side (fixes #289).
   */
  async triggerBatch(containers: Container[], runtimeContext?: unknown): Promise<unknown> {
    const client = getRequiredAgentClient(this.agent, 'AgentTrigger');
    return client.runRemoteTriggerBatch(containers, this.type, this.name, runtimeContext);
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
