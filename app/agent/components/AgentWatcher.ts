import type { Container, ContainerReport } from '../../model/container.js';
import Watcher from '../../watchers/Watcher.js';
import { getRequiredAgentClient } from './getRequiredAgentClient.js';

/**
 * Agent Watcher.
 * Acts as a proxy for the remote watcher running on the agent.
 */
class AgentWatcher extends Watcher {
  /**
   * Watch main method.
   * Delegate to the agent client.
   */
  async watch(): Promise<ContainerReport[]> {
    const client = getRequiredAgentClient(this.agent, 'AgentWatcher');
    return client.watch(this.type, this.name);
  }

  /**
   * Watch a Container.
   * Delegate to the agent client.
   * The `emitBatchEvent` option is intentionally not forwarded to the remote agent; the agent
   * manages its own event dispatch for its local watcher. Batch-event emission for remote
   * containers is handled by the controller after this method returns.
   */
  async watchContainer(
    container: Container,
    _options?: { emitBatchEvent?: boolean },
  ): Promise<ContainerReport> {
    const client = getRequiredAgentClient(this.agent, 'AgentWatcher');
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
