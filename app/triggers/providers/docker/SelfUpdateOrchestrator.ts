import crypto from 'node:crypto';

const SELF_UPDATE_START_TIMEOUT_MS = 30_000;
const SELF_UPDATE_HEALTH_TIMEOUT_MS = 120_000;
const SELF_UPDATE_POLL_INTERVAL_MS = 1_000;
const SELF_UPDATE_ACK_TIMEOUT_MS = 3_000;

class SelfUpdateOrchestrator {
  getConfiguration;

  runtimeConfigManager;

  pullImage;

  cloneContainer;

  createContainer;

  insertContainerImageBackup;

  emitSelfUpdateStarting;

  createOperationId;

  constructor(options: Record<string, any> = {}) {
    this.getConfiguration = options.getConfiguration || (() => ({}));
    this.runtimeConfigManager = options.runtimeConfigManager;
    this.pullImage = options.pullImage;
    this.cloneContainer = options.cloneContainer;
    this.createContainer = options.createContainer;
    this.insertContainerImageBackup = options.insertContainerImageBackup || (() => undefined);
    this.emitSelfUpdateStarting = options.emitSelfUpdateStarting || (() => Promise.resolve());
    this.createOperationId = options.createOperationId || (() => crypto.randomUUID());
  }

  isSelfUpdate(container) {
    return container.image.name === 'drydock' || container.image.name.endsWith('/drydock');
  }

  findDockerSocketBind(spec) {
    const binds = spec?.HostConfig?.Binds;
    if (!Array.isArray(binds)) return undefined;
    for (const bind of binds) {
      const parts = bind.split(':');
      if (parts.length >= 2 && parts[1] === '/var/run/docker.sock') {
        return parts[0];
      }
    }
    return undefined;
  }

  async maybeNotify(container, logContainer, operationId?: string) {
    if (!this.isSelfUpdate(container)) {
      return;
    }

    logContainer.info('Self-update detected — notifying UI before proceeding');
    await this.emitSelfUpdateStarting({
      opId: operationId || this.createOperationId(),
      requiresAck: true,
      ackTimeoutMs: SELF_UPDATE_ACK_TIMEOUT_MS,
      startedAt: new Date().toISOString(),
    });
  }

  async execute(context, container, logContainer, operationId?: string) {
    const { dockerApi, auth, newImage, currentContainer, currentContainerSpec } = context;

    if (this.getConfiguration()?.dryrun) {
      logContainer.info('Do not replace the existing container because dry-run mode is enabled');
      return false;
    }

    const socketPath = this.findDockerSocketBind(currentContainerSpec);
    if (!socketPath) {
      throw new Error(
        'Self-update requires the Docker socket to be bind-mounted (e.g. /var/run/docker.sock:/var/run/docker.sock)',
      );
    }

    // Insert backup before starting the update.
    this.insertContainerImageBackup(context, container);

    // Pull the new image while we're still alive
    await this.pullImage(dockerApi, auth, newImage, logContainer);
    const cloneRuntimeConfigOptions = await this.runtimeConfigManager.getCloneRuntimeConfigOptions(
      dockerApi,
      currentContainerSpec,
      newImage,
      logContainer,
    );

    const oldName = currentContainerSpec.Name.replace(/^\//, '');
    const tempName = `drydock-old-${Date.now()}`;

    // Rename old container to free the name
    logContainer.info(`Rename container ${oldName} to ${tempName}`);
    await currentContainer.rename({ name: tempName });

    let newContainer;
    try {
      // Create new container with original name (don't start — port conflict)
      const containerToCreateInspect = this.cloneContainer(
        currentContainerSpec,
        newImage,
        cloneRuntimeConfigOptions,
      );
      newContainer = await this.createContainer(
        dockerApi,
        containerToCreateInspect,
        oldName,
        logContainer,
      );
    } catch (e) {
      // Rollback: rename old container back to original name
      logContainer.warn(`Failed to create new container, rolling back rename: ${e.message}`);
      await currentContainer.rename({ name: oldName });
      throw e;
    }

    // Spawn a helper container to orchestrate the stop/start/cleanup
    let newContainerId;
    try {
      newContainerId = (await newContainer.inspect()).Id;
    } catch (e) {
      logContainer.warn(`Failed to inspect new container, rolling back: ${e.message}`);
      try {
        await newContainer.remove({ force: true });
      } catch {
        /* best effort */
      }
      await currentContainer.rename({ name: oldName });
      throw e;
    }
    const oldContainerId = currentContainerSpec.Id;
    const socketMount = `${socketPath}:/var/run/docker.sock`;
    const selfUpdateOperationId = operationId || this.createOperationId();

    logContainer.info('Spawning helper container for self-update transition');
    try {
      await dockerApi
        .createContainer({
          Image: newImage,
          Cmd: ['node', 'dist/triggers/providers/docker/self-update-controller-entrypoint.js'],
          Env: [
            `DD_SELF_UPDATE_OP_ID=${selfUpdateOperationId}`,
            `DD_SELF_UPDATE_OLD_CONTAINER_ID=${oldContainerId}`,
            `DD_SELF_UPDATE_NEW_CONTAINER_ID=${newContainerId}`,
            `DD_SELF_UPDATE_OLD_CONTAINER_NAME=${oldName}`,
            `DD_SELF_UPDATE_START_TIMEOUT_MS=${SELF_UPDATE_START_TIMEOUT_MS}`,
            `DD_SELF_UPDATE_HEALTH_TIMEOUT_MS=${SELF_UPDATE_HEALTH_TIMEOUT_MS}`,
            `DD_SELF_UPDATE_POLL_INTERVAL_MS=${SELF_UPDATE_POLL_INTERVAL_MS}`,
          ],
          Labels: {
            'dd.self-update.helper': 'true',
            'dd.self-update.operation-id': selfUpdateOperationId,
          },
          HostConfig: {
            AutoRemove: true,
            Binds: [socketMount],
          },
          name: `drydock-self-update-${Date.now()}`,
        })
        .then((helperContainer) => helperContainer.start());
    } catch (e) {
      // Rollback: remove new container, rename old back
      logContainer.warn(`Failed to spawn helper container, rolling back: ${e.message}`);
      try {
        await newContainer.remove({ force: true });
      } catch {
        /* best effort */
      }
      await currentContainer.rename({ name: oldName });
      throw e;
    }

    logContainer.info('Helper container started — process will terminate when old container stops');
    return true;
  }
}

export default SelfUpdateOrchestrator;
