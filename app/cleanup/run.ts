import { recordAuditEvent } from '../api/audit-events.js';
import { listImageHosts } from '../api/images/hosts.js';
import logger from '../log/index.js';
import { sanitizeLogParam } from '../log/sanitize.js';
import * as registry from '../registry/index.js';
import { listActiveOperations } from '../store/update-operation.js';
import { getErrorMessage } from '../util/error.js';
import { executeCleanup } from './engine.js';
import type {
  CleanupDockerApi,
  CleanupHost,
  CleanupPolicy,
  CleanupRunResult,
  CleanupRunTrigger,
  CleanupType,
  CleanupTypeResult,
} from './types.js';

const log = logger.child({ component: 'cleanup' });

const lastRuns = new Map<string, CleanupRunResult>();
const hostsRunning = new Set<string>();

const REQUIRED_API_METHODS = [
  'listImages',
  'listContainers',
  'listNetworks',
  'getImage',
  'getContainer',
  'getVolume',
  'pruneNetworks',
  'pruneBuilder',
  'df',
] as const;

export function isCleanupDockerApi(value: unknown): value is CleanupDockerApi {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return REQUIRED_API_METHODS.every((method) => typeof candidate[method] === 'function');
}

export interface ResolvedCleanupHost {
  id: string;
  /** Present when the host can run cleanup; absent for an agent without Docker transport. */
  host?: CleanupHost;
}

/**
 * Hosts a policy covers: its `hosts` list, or every Docker watcher when the
 * list is empty. Local and agent-owned watchers are both hosts (agent ones
 * through the controller Docker transport, the same path as image prune).
 */
export function resolvePolicyHosts(policy: CleanupPolicy): ResolvedCleanupHost[] {
  return listImageHosts(registry.getState().watcher)
    .filter((host) => policy.hosts.length === 0 || policy.hosts.includes(host.id))
    .map((host) => {
      if (!isCleanupDockerApi(host.dockerApi)) {
        return { id: host.id };
      }
      return {
        id: host.id,
        host: {
          id: host.id,
          name: host.name,
          ...(host.agent ? { agent: host.agent } : {}),
          api: host.dockerApi,
        },
      };
    });
}

/** True while an update operation is active on the host. */
export function hasActiveUpdate(host: CleanupHost): boolean {
  return listActiveOperations().some(
    (operation) =>
      !operation.watcher || (operation.watcher === host.name && operation.agent === host.agent),
  );
}

export function isHostBusy(host: CleanupHost): boolean {
  return hostsRunning.has(host.id) || hasActiveUpdate(host);
}

function formatBytes(bytes: number): string {
  return `${bytes} bytes`;
}

function describeTypes(types: Partial<Record<CleanupType, CleanupTypeResult>>): string {
  return Object.entries(types)
    .map(
      ([type, result]) =>
        `${type} ${result.removed}/${result.candidates} removed, ${formatBytes(result.reclaimedBytes)}${
          result.errors.length > 0 ? `, ${result.errors.length} errors` : ''
        }`,
    )
    .join('; ');
}

function audit(result: CleanupRunResult): void {
  const mode = `${result.trigger}${result.dryRun ? ', dry run' : ''}`;
  let details: string;
  if (result.status === 'skipped') {
    details = `${result.policy} (${mode}): skipped, ${result.reason}`;
  } else if (result.status === 'error') {
    details = `${result.policy} (${mode}): ${result.error}`;
  } else {
    details = `${result.policy} (${mode}): ${describeTypes(result.types)}; ${formatBytes(result.totalReclaimedBytes)} total`;
  }
  const hasTypeErrors = Object.values(result.types).some((type) => type.errors.length > 0);
  recordAuditEvent({
    action: 'cleanup',
    status:
      result.status === 'error' || hasTypeErrors
        ? 'error'
        : result.status === 'skipped' || result.dryRun
          ? 'info'
          : 'success',
    containerName: result.host,
    details,
  });
  log.info(`Cleanup ${sanitizeLogParam(details)} on host ${sanitizeLogParam(result.host)}`);
}

function finish(result: CleanupRunResult): CleanupRunResult {
  lastRuns.set(`${result.policy}::${result.host}`, result);
  audit(result);
  return result;
}

/**
 * Run one policy on one host and record the outcome. Returns a skipped result
 * rather than running when the host is unsupported, already cleaning, or has
 * an update in flight, because an update's old container, backup image and
 * volumes exist in exactly the state cleanup would otherwise remove.
 */
export async function runCleanupOnHost(
  resolved: ResolvedCleanupHost,
  policy: CleanupPolicy,
  trigger: CleanupRunTrigger,
  dryRunOverride?: boolean,
): Promise<CleanupRunResult> {
  const dryRun = dryRunOverride ?? policy.dryRun;
  const startedAt = new Date().toISOString();
  const base = { policy: policy.name, host: resolved.id, trigger, dryRun, startedAt };
  const skip = (reason: NonNullable<CleanupRunResult['reason']>): CleanupRunResult =>
    finish({
      ...base,
      status: 'skipped',
      reason,
      finishedAt: new Date().toISOString(),
      totalReclaimedBytes: 0,
      types: {},
    });

  const { host } = resolved;
  if (!host) {
    return skip('unsupported-host');
  }
  if (hostsRunning.has(host.id)) {
    return skip('already-running');
  }
  if (hasActiveUpdate(host)) {
    return skip('update-in-progress');
  }

  hostsRunning.add(host.id);
  try {
    const execution = await executeCleanup(host, policy, { dryRun });
    return finish({
      ...base,
      status: 'completed',
      finishedAt: new Date().toISOString(),
      totalReclaimedBytes: execution.totalReclaimedBytes,
      types: execution.types,
    });
  } catch (error: unknown) {
    return finish({
      ...base,
      status: 'error',
      error: getErrorMessage(error),
      finishedAt: new Date().toISOString(),
      totalReclaimedBytes: 0,
      types: {},
    });
  } finally {
    hostsRunning.delete(host.id);
  }
}

export function getLastCleanupRuns(): CleanupRunResult[] {
  return [...lastRuns.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/** @internal test-only reset */
export function _resetCleanupStateForTesting(): void {
  lastRuns.clear();
  hostsRunning.clear();
}
