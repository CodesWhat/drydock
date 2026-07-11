import { isRollbackContainerName } from '../../../model/container.js';
import { getErrorMessage } from '../../../util/error.js';
import {
  cleanupCreatedContainerCandidate,
  getCreatedContainerCandidate,
} from './created-container-candidate.js';
import { buildRollbackCascadeGuardError } from './rollback-cascade-guard.js';
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
  SelfUpdateHelperContainerCreateOptions,
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
  resolveFinalizeSecret: (operationId: string) => string;
  resolveHelperImage?: () => string | undefined;
  // touchOperation refreshes updatedAt immediately before the helper is spawned so the
  // grace window for the post-restart finalize is measured from after the (potentially
  // slow) image pull, not from prepare time.
  touchOperation?: (operationId: string) => void;
}

type HelperDockerConnection =
  | { mode: 'tcp'; host: string; port: number; protocol: string }
  | { mode: 'socket'; socketPath: string };

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

/**
 * Validate that a Docker TCP host value is a bare hostname or IP address.
 * Rejects values that contain a scheme prefix, path separator, `@`, or whitespace —
 * anything that is not a plain host suitable for passing to Dockerode.
 */
function validateTcpDockerHost(host: string): void {
  if (host.length === 0) {
    throw new Error('Docker TCP host must not be empty');
  }
  if (/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//u.test(host)) {
    throw new Error(`Docker TCP host must be a bare hostname or IP, not a URL (got: ${host})`);
  }
  if (host.includes('@')) {
    throw new Error(
      `Docker TCP host must be a bare hostname or IP, not a userinfo string (got: ${host})`,
    );
  }
  if (/\s/u.test(host)) {
    throw new Error(
      `Docker TCP host must be a bare hostname or IP without whitespace (got: ${host})`,
    );
  }
  if (host.includes('/') || host.includes('\\')) {
    throw new Error(
      `Docker TCP host must be a bare hostname or IP without path separators (got: ${host})`,
    );
  }
}

function resolveHelperDockerConnection(
  dependencies: Pick<SelfUpdateTransitionDependencies, 'findDockerSocketBind'>,
  dockerApi: SelfUpdateDockerApi,
  currentContainerSpec: SelfUpdateContainerSpec | undefined,
): HelperDockerConnection {
  // Socket-bind-first: when the target container has the Docker socket bind-mounted,
  // the helper MUST use that direct socket path. Using the TCP connection (which may
  // run through a proxy) would sever the helper the moment that proxy is stopped and
  // replaced — exactly the scenario in infrastructure update mode (dd.update.mode=infrastructure),
  // where the socket proxy itself is the container being updated. TCP is only the
  // fallback for deployments where Drydock reaches Docker purely over a remote TCP host
  // and has no local socket bind.
  const socketPath = dependencies.findDockerSocketBind(currentContainerSpec);
  if (socketPath) {
    return { mode: 'socket', socketPath };
  }

  const modemHost = dockerApi.modem?.host;
  if (typeof modemHost === 'string' && modemHost.length > 0) {
    validateTcpDockerHost(modemHost);
    return {
      mode: 'tcp',
      host: modemHost,
      port: Number(dockerApi.modem?.port) || 2375,
      protocol: dockerApi.modem?.protocol || 'http',
    };
  }

  throw new Error(
    'Self-update requires the Docker socket to be bind-mounted (e.g. /var/run/docker.sock:/var/run/docker.sock), or the watcher must be configured with a TCP Docker host',
  );
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

  const oldName = currentContainerSpec.Name.replace(/^\//, '');

  // Cascade guard: a container already carries the "-old-<epoch-ms>" rollback
  // rename suffix, meaning a previous self-update attempt failed mid-transition
  // and was never restored (see created-container-candidate.ts / the macvlan
  // incident). Renaming again from this name would nest a second rollback
  // rename on top of the first and could strand drydock's own updater.
  // Fail terminally — before any rename, pull, or create — instead of
  // compounding the mess, mirroring ContainerUpdateExecutor's guard for
  // regular (non-self) updates.
  if (isRollbackContainerName(oldName)) {
    throw buildRollbackCascadeGuardError(oldName);
  }

  const connection = resolveHelperDockerConnection(dependencies, dockerApi, currentContainerSpec);
  if (connection.mode === 'tcp') {
    logContainer.info(
      `Self-update helper will connect to Docker via TCP: ${connection.host}:${connection.port}`,
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
    // The container may have been created before a later step (e.g. an
    // additional-network connect) failed — reclaim it off the error before
    // renaming back so it doesn't orphan and squat the canonical name.
    await cleanupCreatedContainerCandidate(getCreatedContainerCandidate(e), oldName, logContainer);
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
  const selfUpdateOperationId = operationId || dependencies.createOperationId();
  const finalizeUrl = dependencies.resolveFinalizeUrl();
  const finalizeSecret = dependencies.resolveFinalizeSecret(selfUpdateOperationId);

  const baseEnv = [
    `DD_SELF_UPDATE_OP_ID=${selfUpdateOperationId}`,
    `DD_SELF_UPDATE_OLD_CONTAINER_ID=${oldContainerId}`,
    `DD_SELF_UPDATE_NEW_CONTAINER_ID=${newContainerId}`,
    `DD_SELF_UPDATE_OLD_CONTAINER_NAME=${oldName}`,
    `DD_SELF_UPDATE_FINALIZE_URL=${finalizeUrl}`,
    `DD_SELF_UPDATE_FINALIZE_SECRET=${finalizeSecret}`,
    `DD_SELF_UPDATE_START_TIMEOUT_MS=${SELF_UPDATE_START_TIMEOUT_MS}`,
    `DD_SELF_UPDATE_HEALTH_TIMEOUT_MS=${SELF_UPDATE_HEALTH_TIMEOUT_MS}`,
    `DD_SELF_UPDATE_POLL_INTERVAL_MS=${SELF_UPDATE_POLL_INTERVAL_MS}`,
  ];

  const tcpEnv =
    connection.mode === 'tcp'
      ? [
          `DD_SELF_UPDATE_DOCKER_HOST=${connection.host}`,
          `DD_SELF_UPDATE_DOCKER_PORT=${connection.port}`,
          `DD_SELF_UPDATE_DOCKER_PROTOCOL=${connection.protocol}`,
        ]
      : [];

  let hostConfig: SelfUpdateHelperContainerCreateOptions['HostConfig'];
  if (connection.mode === 'socket') {
    hostConfig = {
      AutoRemove: true,
      Binds: [`${connection.socketPath}:/var/run/docker.sock`],
    };
  } else {
    const networkMode = currentContainerSpec.HostConfig?.NetworkMode;
    hostConfig = {
      AutoRemove: true,
      ...(typeof networkMode === 'string' && networkMode.length > 0
        ? { NetworkMode: networkMode }
        : {}),
    };
  }

  dependencies.touchOperation?.(selfUpdateOperationId);
  logContainer.info('Spawning helper container for self-update transition');
  try {
    await dockerApi
      .createContainer({
        Image: dependencies.resolveHelperImage?.() ?? newImage,
        Cmd: ['node', 'dist/triggers/providers/docker/self-update-controller-entrypoint.js'],
        Env: [...baseEnv, ...tcpEnv],
        Labels: {
          'dd.self-update.helper': 'true',
          'dd.self-update.operation-id': selfUpdateOperationId,
          'dd.watch': 'false',
        },
        HostConfig: hostConfig,
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

export {
  executeSelfUpdateTransition,
  findDockerSocketBind,
  resolveHelperDockerConnection,
  validateTcpDockerHost,
};
