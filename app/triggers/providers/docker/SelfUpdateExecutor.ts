import crypto from 'node:crypto';

const SELF_UPDATE_START_TIMEOUT_MS = 30_000;
const SELF_UPDATE_HEALTH_TIMEOUT_MS = 120_000;
const SELF_UPDATE_POLL_INTERVAL_MS = 1_000;

class SelfUpdateExecutor {
  getConfiguration;

  findDockerSocketBind;

  insertContainerImageBackup;

  pullImage;

  getCloneRuntimeConfigOptions;

  cloneContainer;

  createContainer;

  constructor(options: Record<string, any> = {}) {
    this.getConfiguration = options.getConfiguration || (() => ({}));
    this.findDockerSocketBind = options.findDockerSocketBind;
    this.insertContainerImageBackup = options.insertContainerImageBackup;
    this.pullImage = options.pullImage;
    this.getCloneRuntimeConfigOptions = options.getCloneRuntimeConfigOptions;
    this.cloneContainer = options.cloneContainer;
    this.createContainer = options.createContainer;
  }

  async execute(context, container, logContainer, operationId?: string) {
    const { dockerApi, auth, newImage, currentContainer, currentContainerSpec } = context;
    const configuration = this.getConfiguration();

    if (configuration.dryrun) {
      logContainer.info('Do not replace the existing container because dry-run mode is enabled');
      return false;
    }

    const socketPath = this.findDockerSocketBind(currentContainerSpec);
    if (!socketPath) {
      throw new Error(
        'Self-update requires the Docker socket to be bind-mounted (e.g. /var/run/docker.sock:/var/run/docker.sock)',
      );
    }

    this.insertContainerImageBackup(context, container);

    await this.pullImage(dockerApi, auth, newImage, logContainer);
    const cloneRuntimeConfigOptions = await this.getCloneRuntimeConfigOptions(
      dockerApi,
      currentContainerSpec,
      newImage,
      logContainer,
    );

    const oldName = currentContainerSpec.Name.replace(/^\//, '');
    const tempName = `drydock-old-${Date.now()}`;

    logContainer.info(`Rename container ${oldName} to ${tempName}`);
    await currentContainer.rename({ name: tempName });

    let newContainer;
    try {
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
      logContainer.warn(`Failed to create new container, rolling back rename: ${e.message}`);
      await currentContainer.rename({ name: oldName });
      throw e;
    }

    let newContainerId;
    try {
      newContainerId = (await newContainer.inspect()).Id;
    } catch (e) {
      logContainer.warn(`Failed to inspect new container, rolling back: ${e.message}`);
      try {
        await newContainer.remove({ force: true });
      } catch {
        // best effort
      }
      await currentContainer.rename({ name: oldName });
      throw e;
    }

    const oldContainerId = currentContainerSpec.Id;
    const socketMount = `${socketPath}:/var/run/docker.sock`;
    const selfUpdateOperationId = operationId || crypto.randomUUID();

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
      logContainer.warn(`Failed to spawn helper container, rolling back: ${e.message}`);
      try {
        await newContainer.remove({ force: true });
      } catch {
        // best effort
      }
      await currentContainer.rename({ name: oldName });
      throw e;
    }

    logContainer.info('Helper container started — process will terminate when old container stops');
    return true;
  }
}

export default SelfUpdateExecutor;
