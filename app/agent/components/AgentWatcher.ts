import Dockerode from 'dockerode';
import type { Container, ContainerReport } from '../../model/container.js';
import DockerWatcher, {
  type DockerWatcherConfiguration,
} from '../../watchers/providers/docker/Docker.js';
import Watcher from '../../watchers/Watcher.js';
import { usesControllerDockerTransport } from '../controller-docker-transport.js';
import { getAgent } from '../manager.js';
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
   * Whether this watcher's maintenance window is currently open.
   *
   * Mirrors `DockerWatcher.isMaintenanceWindowOpen()` so that
   * `Trigger.deferAutoUpdateForMaintenanceWindow` gates an agent-owned container's auto-install
   * exactly like a local one (DR-96): before this method existed, `AgentWatcher` exposed no
   * `isMaintenanceWindowOpen`, so that gate always treated the watcher as unresolvable and
   * failed open, letting agent-owned auto-updates install regardless of the configured window
   * while the UI (reading the same watcher's masked `maintenancewindowopen` field) still
   * reported the update as deferred.
   *
   * With controller Docker transport the delegate IS a live `DockerWatcher`, so its own state
   * is authoritative and this just proxies to it. Otherwise the real watcher runs on the
   * remote agent process; the freshest state the controller has is the masked
   * `maintenancewindowopen` boolean from that agent's most recent watcher-snapshot report
   * (`AgentClient.getWatcherSnapshot`), refreshed on every one of the agent's own scan cycles —
   * so once a closed window opens, the agent's next scheduled report (not a controller-side
   * poll) is what lets a previously deferred install through.
   *
   * Before a snapshot has arrived (or the field is simply absent — an older agent that
   * predates this field, or a watcher with no window configured), fall back to the
   * handshake-time `configuration` and, failing that, fail open: same "unconfigured window
   * lets updates through" default `DockerWatcher.isMaintenanceWindowOpen()` itself applies, and
   * what keeps a pre-fix (or old-agent) container's updates ungated rather than newly and
   * silently blocked.
   */
  isMaintenanceWindowOpen(): boolean {
    if (this.controllerWatcher) {
      return this.controllerWatcher.isMaintenanceWindowOpen();
    }

    const client = this.agent ? getAgent(this.agent) : undefined;
    const snapshotConfiguration = client?.getWatcherSnapshot(this.type, this.name)?.configuration;
    const configuration = (snapshotConfiguration ?? this.configuration) as
      | { maintenancewindowopen?: unknown }
      | undefined;
    const maskedOpen = configuration?.maintenancewindowopen;
    return typeof maskedOpen === 'boolean' ? maskedOpen : true;
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
