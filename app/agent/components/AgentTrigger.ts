import type { Container } from '../../model/container.js';
import DockerTrigger, {
  type DockerTriggerConfiguration,
} from '../../triggers/providers/docker/Docker.js';
import Trigger from '../../triggers/providers/Trigger.js';
import { usesControllerDockerTransport } from '../controller-docker-transport.js';
import { getRequiredAgentClient } from './getRequiredAgentClient.js';

/**
 * Agent Trigger.
 * Acts as a proxy for the remote trigger running on the agent.
 */
class AgentTrigger extends Trigger {
  private controllerTrigger?: DockerTrigger;

  private requireControllerTrigger(capability: string): DockerTrigger {
    if (!this.controllerTrigger) {
      throw new Error(
        `AgentTrigger ${this.getId()} cannot provide local Docker capability ${capability}; the agent does not advertise controller Docker transport`,
      );
    }
    return this.controllerTrigger;
  }

  override async init(): Promise<void> {
    if (!usesControllerDockerTransport(this.type, this.configuration)) {
      await super.init();
      return;
    }
    const delegate = new DockerTrigger();
    await delegate.register(
      'trigger',
      'docker',
      this.name,
      {} as DockerTriggerConfiguration,
      this.agent,
    );
    this.controllerTrigger = delegate;
  }

  /**
   * Trigger method.
   * Delegates to the agent, threading runtimeContext so the controller's
   * operationId survives the controller→agent boundary (fixes #289).
   */
  async trigger(container: Container, runtimeContext?: unknown): Promise<unknown> {
    if (this.controllerTrigger) {
      return this.controllerTrigger.trigger(container, runtimeContext);
    }
    const client = getRequiredAgentClient(this.agent, 'AgentTrigger');
    return client.runRemoteTrigger(container, this.type, this.name, runtimeContext);
  }

  /**
   * Trigger batch method.
   * Delegates to the agent, threading runtimeContext for per-container operationId
   * resolution on the agent side (fixes #289).
   */
  async triggerBatch(containers: Container[], runtimeContext?: unknown): Promise<unknown> {
    if (this.controllerTrigger) {
      return this.controllerTrigger.triggerBatch(containers, runtimeContext);
    }
    const client = getRequiredAgentClient(this.agent, 'AgentTrigger');
    return client.runRemoteTriggerBatch(containers, this.type, this.name, runtimeContext);
  }

  getWatcher(...args: Parameters<DockerTrigger['getWatcher']>) {
    return this.requireControllerTrigger('getWatcher').getWatcher(...args);
  }

  override async preview(container: Container): Promise<Record<string, unknown>> {
    if (!this.controllerTrigger) {
      return super.preview(container);
    }
    return this.controllerTrigger.preview(container);
  }

  pullImage(...args: Parameters<DockerTrigger['pullImage']>) {
    return this.requireControllerTrigger('pullImage').pullImage(...args);
  }

  getCurrentContainer(...args: Parameters<DockerTrigger['getCurrentContainer']>) {
    return this.requireControllerTrigger('getCurrentContainer').getCurrentContainer(...args);
  }

  inspectContainer(...args: Parameters<DockerTrigger['inspectContainer']>) {
    return this.requireControllerTrigger('inspectContainer').inspectContainer(...args);
  }

  stopAndRemoveContainer(...args: Parameters<DockerTrigger['stopAndRemoveContainer']>) {
    return this.requireControllerTrigger('stopAndRemoveContainer').stopAndRemoveContainer(...args);
  }

  recreateContainer(...args: Parameters<DockerTrigger['recreateContainer']>) {
    return this.requireControllerTrigger('recreateContainer').recreateContainer(...args);
  }

  reconcileInProgressContainerUpdateOperation(
    ...args: Parameters<DockerTrigger['reconcileInProgressContainerUpdateOperation']>
  ) {
    return this.requireControllerTrigger(
      'reconcileInProgressContainerUpdateOperation',
    ).reconcileInProgressContainerUpdateOperation(...args);
  }

  /**
   * Configuration schema.
   * Relaxed validation since the agent has already validated the config.
   */
  getConfigurationSchema() {
    return this.joi.object().unknown();
  }

  override async deregisterComponent(): Promise<void> {
    if (this.controllerTrigger) {
      const delegate = this.controllerTrigger;
      this.controllerTrigger = undefined;
      await delegate.deregister();
      return;
    }
    await super.deregisterComponent();
  }
}

export default AgentTrigger;
