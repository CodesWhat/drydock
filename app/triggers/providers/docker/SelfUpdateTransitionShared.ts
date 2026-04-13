import { getErrorMessage } from '../../../util/error.js';
import {
  SELF_UPDATE_HEALTH_TIMEOUT_MS,
  SELF_UPDATE_POLL_INTERVAL_MS,
  SELF_UPDATE_START_TIMEOUT_MS,
} from './self-update-timeouts.js';
import type {
  SelfUpdateConfiguration,
  SelfUpdateContainerRef,
  SelfUpdateContainerSpec,
  SelfUpdateCreatedContainer,
  SelfUpdateDockerApi,
  SelfUpdateExecutionContext,
  SelfUpdateLogger,
} from './self-update-types.js';

type SelfUpdateRuntimeConfigOptions = Record<string, unknown>;
type SelfUpdateContainerCreateSpec = Record<string, unknown>;

interface SelfUpdateTransitionDependencies {
  getConfiguration: () => SelfUpdateConfiguration | undefined;
  findDockerSocketBind: (spec: SelfUpdateContainerSpec | undefined) => string | undefined;
  insertContainerImageBackup: (
    context: SelfUpdateExecutionContext,
    container: SelfUpdateContainerRef,
  ) => void;
  pullImage: (
    dockerApi: SelfUpdateDockerApi,
    auth: unknown,
    newImage: string,
    logContainer: SelfUpdateLogger,
  ) => Promise<void>;
  getCloneRuntimeConfigOptions: (
    dockerApi: SelfUpdateDockerApi,
    currentContainerSpec: SelfUpdateContainerSpec,
    newImage: string,
    logContainer: SelfUpdateLogger,
  ) => Promise<SelfUpdateRuntimeConfigOptions>;
  cloneContainer: (
    currentContainerSpec: SelfUpdateContainerSpec,
    newImage: string,
    cloneRuntimeConfigOptions: SelfUpdateRuntimeConfigOptions,
  ) => SelfUpdateContainerCreateSpec;
  createContainer: (
    dockerApi: SelfUpdateDockerApi,
    containerToCreateInspect: SelfUpdateContainerCreateSpec,
    oldContainerName: string,
    logContainer: SelfUpdateLogger,
  ) => Promise<SelfUpdateCreatedContainer>;
  createOperationId: () => string;
  resolveFinalizeUrl: () => string;
  resolveFinalizeSecret: () => string;
  resolveHelperImage?: () => string | undefined;
}

function findDockerSocketBind(spec: SelfUpdateContainerSpec | undefined): string | undefined {
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
  context: SelfUpdateExecutionContext,
  container: SelfUpdateContainerRef,
  logContainer: SelfUpdateLogger,
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
  const tempName = `${oldName}-old-${Date.now()}`;

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
  } catch (e: unknown) {
    logContainer.warn(
      `Failed to create new container, rolling back rename: ${getErrorMessage(e, String(e))}`,
    );
    await currentContainer.rename({ name: oldName });
    throw e;
  }

  let newContainerId;
  try {
    newContainerId = (await newContainer.inspect()).Id;
  } catch (e: unknown) {
    logContainer.warn(
      `Failed to inspect new container, rolling back: ${getErrorMessage(e, String(e))}`,
    );
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
  const finalizeUrl = dependencies.resolveFinalizeUrl();
  const finalizeSecret = dependencies.resolveFinalizeSecret();

  logContainer.info('Spawning helper container for self-update transition');
  try {
    await dockerApi
      .createContainer({
        Image: dependencies.resolveHelperImage?.() ?? newImage,
        Cmd: ['node', 'dist/triggers/providers/docker/self-update-controller-entrypoint.js'],
        Env: [
          `DD_SELF_UPDATE_OP_ID=${selfUpdateOperationId}`,
          `DD_SELF_UPDATE_OLD_CONTAINER_ID=${oldContainerId}`,
          `DD_SELF_UPDATE_NEW_CONTAINER_ID=${newContainerId}`,
          `DD_SELF_UPDATE_OLD_CONTAINER_NAME=${oldName}`,
          `DD_SELF_UPDATE_FINALIZE_URL=${finalizeUrl}`,
          `DD_SELF_UPDATE_FINALIZE_SECRET=${finalizeSecret}`,
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
  } catch (e: unknown) {
    logContainer.warn(
      `Failed to spawn helper container, rolling back: ${getErrorMessage(e, String(e))}`,
    );
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
