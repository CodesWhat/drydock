import Dockerode from 'dockerode';
import type { Container, ContainerReport } from '../../model/container.js';
import DockerWatcher, {
  type DockerWatcherConfiguration,
} from '../../watchers/providers/docker/Docker.js';
import Watcher from '../../watchers/Watcher.js';
import { usesControllerDockerTransport } from '../controller-docker-transport.js';
import { PortwingDockerBridge } from '../PortwingDockerBridge.js';
import { getRequiredAgentClient } from './getRequiredAgentClient.js';

/**
 * Agent Watcher.
 * Acts as a proxy for the remote watcher running on the agent.
 */
class AgentWatcher extends Watcher {
  private controllerWatcher?: DockerWatcher;
  private controllerBridge?: PortwingDockerBridge;

  override async init(): Promise<void> {
    if (!usesControllerDockerTransport(this.type, this.configuration)) {
      return;
    }

    const client = getRequiredAgentClient(this.agent, 'AgentWatcher');
    const bridge = new PortwingDockerBridge(client);
    this.controllerBridge = bridge;
    try {
      const endpoint = await bridge.start();
      const dockerApi = new Dockerode({
        host: endpoint.host,
        port: endpoint.port,
        protocol: 'http',
        headers: { Authorization: endpoint.authorization },
      });
      const delegate = new DockerWatcher();
      delegate.initWatcher = async () => {
        delegate.dockerApi = dockerApi;
      };
      delegate.recreateDockerClient = delegate.initWatcher;
      await delegate.register(
        'watcher',
        'docker',
        this.name,
        { watchevents: false } as DockerWatcherConfiguration,
        this.agent,
      );
      this.controllerWatcher = delegate;
      this.dockerApi = delegate.dockerApi;
    } catch (error) {
      await bridge.stop();
      this.controllerBridge = undefined;
      throw error;
    }
  }

  /**
   * Watch main method.
   * Delegate to the agent client.
   */
  async watch(): Promise<ContainerReport[]> {
    if (this.controllerWatcher) {
      return this.controllerWatcher.watch();
    }
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
    if (this.controllerWatcher) {
      return this.controllerWatcher.watchContainer(container, _options);
    }
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

  override async deregisterComponent(): Promise<void> {
    try {
      await this.controllerWatcher?.deregister();
    } finally {
      this.controllerWatcher = undefined;
      this.dockerApi = undefined;
      await this.controllerBridge?.stop();
      this.controllerBridge = undefined;
    }
  }
}

export default AgentWatcher;
