import Dockerode from 'dockerode';
import { getErrorMessage } from '../../../util/error.js';
import { toPositiveInteger } from '../../../util/parse.js';
import { sleep } from '../../../util/sleep.js';
import { probeSocketApiVersion } from '../../../watchers/providers/docker/socket-version-probe.js';
import {
  SELF_UPDATE_HEALTH_TIMEOUT_MS,
  SELF_UPDATE_POLL_INTERVAL_MS,
  SELF_UPDATE_START_TIMEOUT_MS,
} from './self-update-timeouts.js';

type SelfUpdateControllerConfig = {
  opId: string;
  oldContainerId: string;
  oldContainerName: string;
  newContainerId: string;
  startTimeoutMs: number;
  healthTimeoutMs: number;
  pollIntervalMs: number;
};

type ErrorWithStatusCode = {
  statusCode?: number;
  status?: number;
};

type ContainerInspectState = {
  State?: {
    Running?: boolean;
    Health?: {
      Status?: string;
    };
  };
  Name?: string;
};

function getErrorStatusCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const errorWithStatusCode = error as ErrorWithStatusCode;
  return errorWithStatusCode.statusCode ?? errorWithStatusCode.status;
}

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function readConfigFromEnv(): SelfUpdateControllerConfig {
  return {
    opId: process.env.DD_SELF_UPDATE_OP_ID || 'unknown',
    oldContainerId: getRequiredEnv('DD_SELF_UPDATE_OLD_CONTAINER_ID'),
    oldContainerName: process.env.DD_SELF_UPDATE_OLD_CONTAINER_NAME || 'drydock',
    newContainerId: getRequiredEnv('DD_SELF_UPDATE_NEW_CONTAINER_ID'),
    startTimeoutMs: toPositiveInteger(
      process.env.DD_SELF_UPDATE_START_TIMEOUT_MS,
      SELF_UPDATE_START_TIMEOUT_MS,
    ),
    healthTimeoutMs: toPositiveInteger(
      process.env.DD_SELF_UPDATE_HEALTH_TIMEOUT_MS,
      SELF_UPDATE_HEALTH_TIMEOUT_MS,
    ),
    pollIntervalMs: toPositiveInteger(
      process.env.DD_SELF_UPDATE_POLL_INTERVAL_MS,
      SELF_UPDATE_POLL_INTERVAL_MS,
    ),
  };
}

function isContainerAlreadyStoppedError(error: unknown): boolean {
  const statusCode = getErrorStatusCode(error);
  if (statusCode === 304) {
    return true;
  }
  const message = getErrorMessage(error, '').toLowerCase();
  return message.includes('is not running') || message.includes('already stopped');
}

function isContainerAlreadyStartedError(error: unknown): boolean {
  const statusCode = getErrorStatusCode(error);
  if (statusCode === 304) {
    return true;
  }
  const message = getErrorMessage(error, '').toLowerCase();
  return message.includes('already started');
}

function hasHealthcheck(containerInspect: ContainerInspectState): boolean {
  return Boolean(containerInspect.State?.Health);
}

function normalizeContainerName(name: string | undefined): string {
  if (!name) {
    return '';
  }
  return name.startsWith('/') ? name.slice(1) : name;
}

async function waitForPredicate(
  checkFn: () => Promise<{ ok: boolean; details?: string }>,
  timeoutMs: number,
  pollIntervalMs: number,
  failureMessage: string,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const checkResult = await checkFn();
    if (checkResult.ok) {
      return;
    }
    await sleep(pollIntervalMs);
  }
  throw new Error(failureMessage);
}

class SelfUpdateController {
  docker: Dockerode;

  config: SelfUpdateControllerConfig;

  constructor(config: SelfUpdateControllerConfig, docker?: Dockerode) {
    this.docker = docker ?? new Dockerode({ socketPath: '/var/run/docker.sock' });
    this.config = config;
  }

  logState(state: string, details?: string): void {
    const suffix = details ? ` - ${details}` : '';
    globalThis.console.log(`[self-update:${this.config.opId}] ${state}${suffix}`);
  }

  async inspectContainer(containerId: string): Promise<ContainerInspectState> {
    return this.docker.getContainer(containerId).inspect();
  }

  async stopOldContainer(): Promise<void> {
    this.logState('STOP_OLD');
    const oldContainer = this.docker.getContainer(this.config.oldContainerId);
    try {
      await oldContainer.stop();
    } catch (error: unknown) {
      if (!isContainerAlreadyStoppedError(error)) {
        throw error;
      }
    }
  }

  async waitOldContainerStopped(): Promise<void> {
    this.logState('WAIT_OLD_STOPPED');
    await waitForPredicate(
      async () => {
        const containerInspect = await this.inspectContainer(this.config.oldContainerId);
        return {
          ok: !containerInspect?.State?.Running,
          details: `old-running=${String(containerInspect?.State?.Running)}`,
        };
      },
      this.config.startTimeoutMs,
      this.config.pollIntervalMs,
      `Timed out waiting for old container ${this.config.oldContainerId} to stop`,
    );
  }

  async startNewContainer(): Promise<void> {
    this.logState('START_NEW');
    const newContainer = this.docker.getContainer(this.config.newContainerId);
    try {
      await newContainer.start();
    } catch (error: unknown) {
      if (!isContainerAlreadyStartedError(error)) {
        throw error;
      }
    }
  }

  async waitNewContainerRunning(): Promise<void> {
    this.logState('WAIT_NEW_RUNNING');
    await waitForPredicate(
      async () => {
        const containerInspect = await this.inspectContainer(this.config.newContainerId);
        return {
          ok: Boolean(containerInspect?.State?.Running),
          details: `new-running=${String(containerInspect?.State?.Running)}`,
        };
      },
      this.config.startTimeoutMs,
      this.config.pollIntervalMs,
      `Timed out waiting for new container ${this.config.newContainerId} to enter running state`,
    );
  }

  async waitNewContainerHealthy(): Promise<void> {
    const initialInspect = await this.inspectContainer(this.config.newContainerId);
    if (!hasHealthcheck(initialInspect)) {
      this.logState('HEALTH_GATE', 'Skipped (container has no healthcheck)');
      return;
    }

    this.logState('HEALTH_GATE');
    await waitForPredicate(
      async () => {
        const containerInspect = await this.inspectContainer(this.config.newContainerId);
        const healthStatus = containerInspect?.State?.Health?.Status;
        if (healthStatus === 'healthy') {
          return { ok: true, details: 'healthy' };
        }
        if (healthStatus === 'unhealthy') {
          throw new Error(`New container became unhealthy (${this.config.newContainerId})`);
        }
        return { ok: false, details: `health=${healthStatus || 'none'}` };
      },
      this.config.healthTimeoutMs,
      this.config.pollIntervalMs,
      `Timed out waiting for new container ${this.config.newContainerId} to become healthy`,
    );
  }

  async commitUpdate(): Promise<void> {
    this.logState('COMMIT');
    const oldContainer = this.docker.getContainer(this.config.oldContainerId);
    await oldContainer.remove({ force: true });
    this.logState('SUCCEEDED');
  }

  async restoreOldContainerName(oldContainer: Dockerode.Container): Promise<void> {
    const oldContainerInspect = await oldContainer.inspect();
    const currentName = normalizeContainerName(oldContainerInspect?.Name);
    if (!currentName || currentName === this.config.oldContainerName) {
      return;
    }

    this.logState('ROLLBACK_RESTORE_NAME', `${currentName} -> ${this.config.oldContainerName}`);
    await oldContainer.rename({ name: this.config.oldContainerName });
  }

  async rollback(error: unknown): Promise<never> {
    const reason = getErrorMessage(error, String(error));
    const oldContainer = this.docker.getContainer(this.config.oldContainerId);
    const newContainer = this.docker.getContainer(this.config.newContainerId);

    try {
      this.logState('CLEANUP_CANDIDATE');
      await newContainer.remove({ force: true });
    } catch (cleanupError: unknown) {
      this.logState(
        'CLEANUP_CANDIDATE_FAILED',
        getErrorMessage(cleanupError, String(cleanupError)),
      );
    }

    try {
      await this.restoreOldContainerName(oldContainer);
    } catch (restoreNameError: unknown) {
      this.logState(
        'ROLLBACK_RESTORE_NAME_FAILED',
        getErrorMessage(restoreNameError, String(restoreNameError)),
      );
    }

    this.logState('ROLLBACK_START_OLD', reason);
    try {
      await oldContainer.start();
    } catch (rollbackError: unknown) {
      if (!isContainerAlreadyStartedError(rollbackError)) {
        this.logState(
          'ROLLBACK_START_OLD_FAILED',
          getErrorMessage(rollbackError, String(rollbackError)),
        );
      }
    }

    this.logState('FAILED_WITH_ROLLBACK', reason);
    throw error;
  }

  async run(): Promise<void> {
    this.logState(
      'PREPARE',
      `old=${this.config.oldContainerName}(${this.config.oldContainerId}), new=${this.config.newContainerId}`,
    );
    try {
      await this.stopOldContainer();
      await this.waitOldContainerStopped();
      await this.startNewContainer();
      await this.waitNewContainerRunning();
      await this.waitNewContainerHealthy();
      await this.commitUpdate();
    } catch (error: unknown) {
      await this.rollback(error);
    }
  }
}

export async function runSelfUpdateController(): Promise<void> {
  const config = readConfigFromEnv();
  const socketPath = '/var/run/docker.sock';
  const apiVersion = await probeSocketApiVersion(socketPath);
  const dockerOpts: Dockerode.DockerOptions = { socketPath };
  if (apiVersion) {
    dockerOpts.version = `v${apiVersion}`;
  }
  const controller = new SelfUpdateController(config, new Dockerode(dockerOpts));
  await controller.run();
}

export async function runSelfUpdateControllerEntrypoint(
  runner: () => Promise<void> = runSelfUpdateController,
): Promise<void> {
  try {
    await runner();
  } catch (error: unknown) {
    globalThis.console.error(
      `[self-update] controller failed: ${getErrorMessage(error, String(error))}`,
    );
    process.exitCode = 1;
  }
}

export {
  getRequiredEnv as testable_getRequiredEnv,
  toPositiveInteger as testable_parsePositiveInt,
};
