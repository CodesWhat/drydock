import Dockerode from 'dockerode';
import { pathToFileURL } from 'node:url';

type SelfUpdateControllerConfig = {
  opId: string;
  oldContainerId: string;
  oldContainerName: string;
  newContainerId: string;
  startTimeoutMs: number;
  healthTimeoutMs: number;
  pollIntervalMs: number;
};

const DEFAULT_START_TIMEOUT_MS = 30_000;
const DEFAULT_HEALTH_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_INTERVAL_MS = 1_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parsePositiveInt(rawValue: string | undefined, fallback: number): number {
  if (!rawValue) {
    return fallback;
  }
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
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
    startTimeoutMs: parsePositiveInt(
      process.env.DD_SELF_UPDATE_START_TIMEOUT_MS,
      DEFAULT_START_TIMEOUT_MS,
    ),
    healthTimeoutMs: parsePositiveInt(
      process.env.DD_SELF_UPDATE_HEALTH_TIMEOUT_MS,
      DEFAULT_HEALTH_TIMEOUT_MS,
    ),
    pollIntervalMs: parsePositiveInt(
      process.env.DD_SELF_UPDATE_POLL_INTERVAL_MS,
      DEFAULT_POLL_INTERVAL_MS,
    ),
  };
}

function isContainerAlreadyStoppedError(error: any): boolean {
  const statusCode = error?.statusCode ?? error?.status;
  if (statusCode === 304) {
    return true;
  }
  const message = String(error?.message || '').toLowerCase();
  return message.includes('is not running') || message.includes('already stopped');
}

function isContainerAlreadyStartedError(error: any): boolean {
  const statusCode = error?.statusCode ?? error?.status;
  if (statusCode === 304) {
    return true;
  }
  const message = String(error?.message || '').toLowerCase();
  return message.includes('already started');
}

function hasHealthcheck(containerInspect: any): boolean {
  return Boolean(containerInspect?.State?.Health);
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

  constructor(config: SelfUpdateControllerConfig) {
    this.docker = new Dockerode({ socketPath: '/var/run/docker.sock' });
    this.config = config;
  }

  logState(state: string, details?: string): void {
    const suffix = details ? ` - ${details}` : '';
    // eslint-disable-next-line no-console
    console.log(`[self-update:${this.config.opId}] ${state}${suffix}`);
  }

  async inspectContainer(containerId: string): Promise<any> {
    return this.docker.getContainer(containerId).inspect();
  }

  async stopOldContainer(): Promise<void> {
    this.logState('STOP_OLD');
    const oldContainer = this.docker.getContainer(this.config.oldContainerId);
    try {
      await oldContainer.stop();
    } catch (error: any) {
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
    } catch (error: any) {
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

  async rollback(error: any): Promise<never> {
    const reason = String(error?.message || error);
    const oldContainer = this.docker.getContainer(this.config.oldContainerId);
    const newContainer = this.docker.getContainer(this.config.newContainerId);

    try {
      this.logState('CLEANUP_CANDIDATE');
      await newContainer.remove({ force: true });
    } catch (cleanupError: any) {
      this.logState('CLEANUP_CANDIDATE_FAILED', String(cleanupError?.message || cleanupError));
    }

    try {
      await this.restoreOldContainerName(oldContainer);
    } catch (restoreNameError: any) {
      this.logState('ROLLBACK_RESTORE_NAME_FAILED', String(restoreNameError?.message || restoreNameError));
    }

    this.logState('ROLLBACK_START_OLD', reason);
    try {
      await oldContainer.start();
    } catch (rollbackError: any) {
      if (!isContainerAlreadyStartedError(rollbackError)) {
        this.logState(
          'ROLLBACK_START_OLD_FAILED',
          String(rollbackError?.message || rollbackError),
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
    } catch (error: any) {
      await this.rollback(error);
    }
  }
}

export async function runSelfUpdateController(): Promise<void> {
  const config = readConfigFromEnv();
  const controller = new SelfUpdateController(config);
  await controller.run();
}

const scriptEntrypointUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === scriptEntrypointUrl) {
  runSelfUpdateController().catch((error: any) => {
    // eslint-disable-next-line no-console
    console.error(`[self-update] controller failed: ${String(error?.message || error)}`);
    process.exitCode = 1;
  });
}
