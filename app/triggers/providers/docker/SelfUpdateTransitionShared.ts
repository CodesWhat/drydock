import {
  SELF_UPDATE_HEALTH_TIMEOUT_MS,
  SELF_UPDATE_POLL_INTERVAL_MS,
  SELF_UPDATE_START_TIMEOUT_MS,
} from './self-update-timeouts.js';

interface SelfUpdateTransitionDependencies {
  getConfiguration: () => { dryrun?: boolean } | undefined;
  findDockerSocketBind: (spec: Record<string, any> | undefined) => string | undefined;
  insertContainerImageBackup: (
    context: Record<string, any>,
    container: Record<string, any>,
  ) => void;
  pullImage: (
    dockerApi: Record<string, any>,
    auth: Record<string, any>,
    newImage: string,
    logContainer: Record<string, any>,
  ) => Promise<void>;
  getCloneRuntimeConfigOptions: (
    dockerApi: Record<string, any>,
    currentContainerSpec: Record<string, any>,
    newImage: string,
    logContainer: Record<string, any>,
  ) => Promise<Record<string, any>>;
  cloneContainer: (
    currentContainerSpec: Record<string, any>,
    newImage: string,
    cloneRuntimeConfigOptions: Record<string, any>,
  ) => Record<string, any>;
  createContainer: (
    dockerApi: Record<string, any>,
    containerToCreateInspect: Record<string, any>,
    oldContainerName: string,
    logContainer: Record<string, any>,
  ) => Promise<Record<string, any>>;
  createOperationId: () => string;
}

function findDockerSocketBind(spec: Record<string, any> | undefined): string | undefined {
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

async function executeSelfUpdateTransition(
  dependencies: SelfUpdateTransitionDependencies,
  context: Record<string, any>,
  container: Record<string, any>,
  logContainer: Record<string, any>,
  operationId?: string,
) {
  const { dockerApi, auth, newImage, currentContainer, currentContainerSpec } = context;

  if (dependencies.getConfiguration()?.dryrun) {
    logContainer.info('Do not replace the existing container because dry-run mode is enabled');
    return false;
  }

  const socketPath = dependencies.findDockerSocketBind(currentContainerSpec);
  if (!socketPath) {
    throw new Error(
      'Self-update requires the Docker socket to be bind-mounted (e.g. /var/run/docker.sock:/var/run/docker.sock)',
    );
  }

  dependencies.insertContainerImageBackup(context, container);

  await dependencies.pullImage(dockerApi, auth, newImage, logContainer);
  const cloneRuntimeConfigOptions = await dependencies.getCloneRuntimeConfigOptions(
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
    const containerToCreateInspect = dependencies.cloneContainer(
      currentContainerSpec,
      newImage,
      cloneRuntimeConfigOptions,
    );
    newContainer = await dependencies.createContainer(
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
  const selfUpdateOperationId = operationId || dependencies.createOperationId();

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

export { executeSelfUpdateTransition, findDockerSocketBind };
