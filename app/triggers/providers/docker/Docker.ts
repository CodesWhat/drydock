import crypto from 'node:crypto';
import pLimit from 'p-limit';
import parse from 'parse-docker-image-name';
import { getSelfUpdateFinalizeSecretForOperation } from '../../../api/internal-self-update.js';
import {
  getSecurityConfiguration,
  getServerConfiguration,
  getStoreConfiguration,
} from '../../../configuration/index.js';
import {
  emitContainerUpdateApplied,
  emitContainerUpdateFailed,
  emitSecurityAlert,
  emitSelfUpdateStarting,
} from '../../../event/index.js';
import { deriveContainerIdentityKey, fullName } from '../../../model/container.js';
import { getAuditCounter } from '../../../prometheus/audit.js';
import { getRollbackCounter } from '../../../prometheus/rollback.js';
import { buildImageReference, cleanRegistryUrl } from '../../../registries/image-reference.js';
import { getState } from '../../../registry/index.js';
import { resolveConfiguredPath } from '../../../runtime/paths.js';
import { getTrivyDatabaseStatus } from '../../../security/runtime.js';
import { offloadSbomDocuments } from '../../../security/sbom-migration.js';
import { createSbomStorage } from '../../../security/sbom-storage.js';
import {
  generateImageSbom,
  scanImageForVulnerabilities,
  scanImageWithDedup,
  verifyImageSignature,
} from '../../../security/scan.js';
import { getSchedulerScanIntervalMs } from '../../../security/scheduler.js';
import * as auditStore from '../../../store/audit.js';
import * as backupStore from '../../../store/backup.js';
import * as storeContainer from '../../../store/container.js';
import { cacheSecurityState } from '../../../store/container.js';
import { isMemoryStore, save as saveStore } from '../../../store/index.js';
import type { ContainerIdentityFilter } from '../../../store/update-operation.js';
import * as updateOperationStore from '../../../store/update-operation.js';
import { classifyDuplicateOpTerminalStatus } from '../../../updates/duplicate-op-classification.js';
import { buildContainerLockKey, withContainerUpdateLocks } from '../../../updates/update-locks.js';
import { createContainerBackupScope } from '../../../util/backup.js';
import { getErrorMessage } from '../../../util/error.js';
import { getDockerWatcherSourceKey } from '../../../watchers/providers/docker/container-init.js';
import { runHook } from '../../hooks/HookRunner.js';
import Trigger, { type TriggerConfiguration } from '../Trigger.js';
import ContainerRuntimeConfigManager from './ContainerRuntimeConfigManager.js';
import ContainerUpdateExecutor from './ContainerUpdateExecutor.js';
import { syncComposeFileTag } from './compose-file-sync.js';
import { attachCreatedContainerCandidate } from './created-container-candidate.js';
import { startHealthMonitor } from './HealthMonitor.js';
import HookExecutor from './HookExecutor.js';
import RegistryResolver from './RegistryResolver.js';
import RollbackMonitor from './RollbackMonitor.js';
import SecurityGate, { type SecurityStatePatch } from './SecurityGate.js';
import SelfUpdateOrchestrator, { type SelfUpdateClassification } from './SelfUpdateOrchestrator.js';
import { RetainSelfUpdateLifecycleError } from './SelfUpdateTransitionShared.js';
import {
  markSelfUpdateOperationFailed as markSelfUpdateOperationFailedFromStore,
  markSelfUpdateOperationSkipped as markSelfUpdateOperationSkippedFromStore,
  prepareSelfUpdateOperation as preparePersistedSelfUpdateOperation,
} from './self-update-operation.js';
import type { SelfUpdateDockerApi, SelfUpdateObservedHelperRuntime } from './self-update-types.js';
import UpdateLifecycleExecutor, {
  type PostPullHookOptions,
  type SelfUpdateLifecycleResult,
} from './UpdateLifecycleExecutor.js';
import { getRequestedOperationId } from './update-runtime-context.js';

const PULL_PROGRESS_LOG_INTERVAL_MS = 2000;
const DEFAULT_PULL_TIMEOUT_MS = 600_000;
const MAX_SIGNED_32_BIT_TIMEOUT_MS = 2_147_483_647;
const NON_SELF_UPDATE_HEALTH_TIMEOUT_MS = 120_000;
const NON_SELF_UPDATE_HEALTH_POLL_INTERVAL_MS = 1_000;
const TRIGGER_BATCH_CONCURRENCY = 3;

type ComposeRollbackTerminalPatch =
  | {
      status: 'rolled-back';
      phase: 'rolled-back';
      rollbackReason?: string;
      lastError: string;
    }
  | {
      status: 'failed';
      phase: 'rollback-failed';
      rollbackReason?: string;
      lastError: string;
    };

function isSelfUpdateLifecycleResult(value: unknown): value is SelfUpdateLifecycleResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as SelfUpdateLifecycleResult).updated === 'boolean' &&
    typeof (value as SelfUpdateLifecycleResult).operationId === 'string'
  );
}

export interface DockerTriggerConfiguration extends TriggerConfiguration {
  prune: boolean;
  dryrun: boolean;
  autoremovetimeout: number;
  pulltimeout: number;
  helpercompletiontimeout: number;
  backupcount: number;
}

export type DockerContainerHandle = Awaited<ReturnType<ContainerUpdateExecutor['createContainer']>>;

type ContainerFullNameReference = {
  name: string;
  watcher?: unknown;
};

type DirectLocalDockerWatcher = {
  agent?: unknown;
  configuration?: {
    host?: unknown;
    socket?: unknown;
    protocol?: unknown;
    port?: unknown;
  };
  dockerApi: unknown;
};

type AuthoritativeLocalDockerRuntime = {
  dockerApi: unknown;
  identity: { id: string; name: string };
  sourceKey: string;
};

function normalizeNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return normalized === '' ? undefined : normalized;
}

function isDirectLocalDockerWatcher(
  registryId: string,
  watcher: unknown,
): watcher is DirectLocalDockerWatcher {
  if (!registryId.startsWith('docker.') || !watcher || typeof watcher !== 'object') {
    return false;
  }
  const candidate = watcher as DirectLocalDockerWatcher;
  if (normalizeNonEmptyString(candidate.agent)) {
    return false;
  }
  if (normalizeNonEmptyString(candidate.configuration?.host)) {
    return false;
  }
  return !!candidate.dockerApi;
}

function getPreferredLabelValue(labels, ddKey, _logger?) {
  return labels?.[ddKey];
}

function hasRepoTags(image) {
  return Array.isArray(image.RepoTags) && image.RepoTags.length > 0;
}

function getComposeRollbackTerminalPatch(error: unknown): ComposeRollbackTerminalPatch | undefined {
  /* v8 ignore next 3 -- compose rollback errors are object errors; primitive input is defensive. */
  if (!error || typeof error !== 'object') {
    return undefined;
  }

  const outcome = (error as Record<string, unknown>).composeRollbackOutcome;
  if (!outcome || typeof outcome !== 'object') {
    return undefined;
  }

  const record = outcome as Record<string, unknown>;
  const rollbackReason =
    typeof record.rollbackReason === 'string' && record.rollbackReason.trim() !== ''
      ? record.rollbackReason
      : undefined;
  const lastError =
    typeof record.lastError === 'string' && record.lastError.trim() !== ''
      ? record.lastError
      : getErrorMessage(error);

  if (record.status === 'rolled-back') {
    return {
      status: 'rolled-back',
      phase: 'rolled-back',
      ...(rollbackReason ? { rollbackReason } : {}),
      lastError,
    };
  }

  if (record.status === 'rollback-failed') {
    return {
      status: 'failed',
      phase: 'rollback-failed',
      ...(rollbackReason ? { rollbackReason } : {}),
      lastError,
    };
  }

  return undefined;
}

function getOperationIdentityFilter(operation: {
  agent?: unknown;
  watcher?: unknown;
  container?: { agent?: unknown; watcher?: unknown };
}): ContainerIdentityFilter | undefined {
  const container = operation.container;
  /* v8 ignore next 6 -- operation identity filters are requested for watcher-scoped operations. */
  const watcher =
    typeof container?.watcher === 'string'
      ? container.watcher
      : typeof operation.watcher === 'string'
        ? operation.watcher
        : undefined;

  if (!watcher) {
    return undefined;
  }

  /* v8 ignore next 5 -- container snapshots carry agent when the operation is agent-owned. */
  const agent =
    typeof container?.agent === 'string'
      ? container.agent
      : typeof operation.agent === 'string'
        ? operation.agent
        : undefined;

  return {
    ...(agent !== undefined ? { agent } : {}),
    watcher,
  };
}

function getRollbackStateContainerId(
  operation: {
    containerId?: unknown;
    container?: { id?: unknown };
  },
  container: { id?: unknown },
): string | undefined {
  const candidates = [operation.containerId, operation.container?.id, container.id];
  for (const candidate of candidates) {
    /* v8 ignore next 3 -- rollback operations carry string ids from at least one source. */
    if (typeof candidate === 'string' && candidate.trim() !== '') {
      return candidate;
    }
  }
  /* v8 ignore next -- update operations always carry at least one container id source. */
  return undefined;
}

function normalizeListedImage(registry, image) {
  const imageParsed = parse(image.RepoTags[0]);
  return registry.normalizeImage({
    registry: {
      url: imageParsed.domain ? imageParsed.domain : '',
    },
    tag: {
      value: imageParsed.tag,
    },
    name: imageParsed.path,
  });
}

function shouldKeepImage(imageNormalized, container) {
  if (imageNormalized.registry.name !== container.image.registry.name) {
    return true;
  }
  if (imageNormalized.name !== container.image.name) {
    return true;
  }
  if (imageNormalized.tag.value === container.updateKind.localValue) {
    return true;
  }
  if (imageNormalized.tag.value === container.updateKind.remoteValue) {
    return true;
  }
  if (
    container.updateKind.kind === 'digest' &&
    imageNormalized.tag.value === container.image.tag.value
  ) {
    return true;
  }
  return false;
}

function getContainerFullNameForLifecycle(container: ContainerFullNameReference): string {
  return `${container.watcher}_${container.name}`;
}

function getErrorNumberField(error: unknown, field: 'statusCode' | 'status'): number | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }
  const value = (error as Record<string, unknown>)[field];
  return typeof value === 'number' ? value : undefined;
}

function getErrorStringField(error: unknown, field: 'message' | 'reason'): string | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }
  const value = (error as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : undefined;
}

function getErrorJsonMessage(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }
  const json = (error as { json?: unknown }).json;
  if (!json || typeof json !== 'object') {
    return undefined;
  }
  const jsonMessage = (json as { message?: unknown }).message;
  return typeof jsonMessage === 'string' ? jsonMessage : undefined;
}

const HOOK_EXECUTOR_ORCHESTRATOR_METHODS = ['recordHookAudit'] as const;
const SELF_UPDATE_ORCHESTRATOR_METHODS = [
  'pullImage',
  'cloneContainer',
  'createContainer',
  'insertContainerImageBackup',
] as const;
const CONTAINER_UPDATE_ORCHESTRATOR_METHODS = [
  'getRollbackConfig',
  'stopContainer',
  'waitContainerRemoved',
  'removeContainer',
  'createContainer',
  'startContainer',
  'pullImage',
  'cloneContainer',
  'isContainerNotFoundError',
  'recordRollbackTelemetry',
  'hasHealthcheckConfigured',
  'waitForContainerHealthy',
  'bindPulledImageIdentity',
] as const;
const ROLLBACK_MONITOR_ORCHESTRATOR_METHODS = ['getCurrentContainer', 'inspectContainer'] as const;
const UPDATE_LIFECYCLE_ORCHESTRATOR_METHODS = [
  'createTriggerContext',
  'maybeScanAndGateUpdate',
  'verifySignaturePreUpdate',
  'scanAndGatePostPull',
  'buildHookConfig',
  'recordHookConfigurationAudit',
  'runPreUpdateHook',
  'isSelfUpdate',
  'isInfrastructureUpdate',
  'prepareSelfUpdateOperation',
  'maybeNotifySelfUpdate',
  'executeSelfUpdate',
  'markSelfUpdateOperationFailed',
  'markSelfUpdateOperationSkipped',
  'runPreRuntimeUpdateLifecycle',
  'performContainerUpdate',
  'runPostUpdateHook',
  'cleanupOldImages',
  'getRollbackConfig',
  'maybeStartAutoRollbackMonitor',
] as const;
const SECURITY_GATE_ORCHESTRATOR_METHODS = ['recordSecurityAudit'] as const;

type DockerTriggerCallbackName =
  | (typeof HOOK_EXECUTOR_ORCHESTRATOR_METHODS)[number]
  | (typeof SELF_UPDATE_ORCHESTRATOR_METHODS)[number]
  | (typeof CONTAINER_UPDATE_ORCHESTRATOR_METHODS)[number]
  | (typeof ROLLBACK_MONITOR_ORCHESTRATOR_METHODS)[number]
  | (typeof UPDATE_LIFECYCLE_ORCHESTRATOR_METHODS)[number]
  | (typeof SECURITY_GATE_ORCHESTRATOR_METHODS)[number];

type DockerTriggerOrchestrator = Pick<Docker, DockerTriggerCallbackName>;

type RollbackTelemetryPayload = {
  container: unknown;
  outcome: 'success' | 'error' | 'info';
  reason: string;
  details: string;
  fromVersion?: string;
  toVersion?: string;
};

type PulledImageIdentityOutcome = {
  imageIdentity?: string;
  /**
   * The local image ID the pull resolved to, carried on the outcomes that
   * could not be bound to a manifest digest. It is not a security binding and
   * the gate still refuses to run against it, but it is an immutable handle on
   * the exact image that was pulled, which is what lets a caller recreate
   * several containers from one image without a digest (DR-54).
   */
  localImageId?: string;
  unboundWarn: boolean;
  reason?: string;
};

type PulledImageIdentityBinding = {
  imageIdentity?: string;
  skipSecurityGate?: boolean;
};

/**
 * The image that was actually pulled, as the identity-binding code sees it:
 * the reference string handed to the pull, plus the parsed repository parts of
 * that same reference with any `@sha256:...` suffix already removed.
 */
type PulledImageReference = {
  reference: string;
  parsedImage: { domain?: string; path?: string };
  /** The pulled tag, trimmed. Undefined for a digest-only `repo@sha256:...`. */
  tag?: string;
};

/**
 * What the caller knows about the pull that the binding code cannot work out
 * for itself.
 *
 * Passing this object at all says the caller, not the binder, names the image
 * this pull is for. It replaces the update candidate's digest
 * (`container.result.digest`) as the tie-break between several `RepoDigests`,
 * and it makes an unresolved tie fail closed instead of picking one candidate
 * deterministically: a manual rollback pulls the image its backup retained,
 * which the candidate's digest describes nothing about (DR-64).
 */
type PulledImageIdentityOptions = {
  /**
   * The digest to prefer when the daemon records several `RepoDigests` for the
   * pulled repository, or `null` for "no preference, and do not fall back to
   * the update candidate's digest". The field is required so that the empty
   * object cannot express the same thing by accident: dropping the candidate
   * tie-break is a decision, not a default.
   */
  preferredDigest: string | null;
};

/**
 * How `selectPulledRepoDigest` breaks a tie between several `RepoDigests`, and
 * what it does when nothing breaks it.
 */
type PulledDigestTieBreak = {
  /** The digest to prefer, when the caller or the watcher knows one. */
  preferredDigest?: string;
  /**
   * True when the caller named the image this pull is for. Every candidate
   * still standing at the end is then a manifest that caller has already said
   * this pull is not, so the digest resolves to nothing and the binding policy
   * decides, rather than a lexicographic pick deploying one of them (DR-64).
   */
  callerPinned: boolean;
};

type PulledImageInspectApi = {
  getImage?: (imageRef: string) => {
    inspect: () => Promise<{
      Id?: string;
      RepoDigests?: string[];
    }>;
  };
};

function buildOrchestratorCallback<K extends keyof DockerTriggerOrchestrator>(
  orchestrator: DockerTriggerOrchestrator,
  callbackName: K,
): DockerTriggerOrchestrator[K] {
  return ((...args: Parameters<DockerTriggerOrchestrator[K]>) =>
    (
      orchestrator[callbackName] as (
        ...callbackArgs: Parameters<DockerTriggerOrchestrator[K]>
      ) => ReturnType<DockerTriggerOrchestrator[K]>
    ).apply(orchestrator, args)) as DockerTriggerOrchestrator[K];
}

function pickOrchestratorCallbacks<K extends keyof DockerTriggerOrchestrator>(
  orchestrator: DockerTriggerOrchestrator,
  callbackNames: readonly K[],
): Pick<DockerTriggerOrchestrator, K> {
  const callbacks = {} as Pick<DockerTriggerOrchestrator, K>;
  for (const callbackName of callbackNames) {
    callbacks[callbackName] = buildOrchestratorCallback(orchestrator, callbackName);
  }
  return callbacks;
}

/**
 * Replace a Docker container with an updated one.
 */
class Docker<
  TConfiguration extends DockerTriggerConfiguration = DockerTriggerConfiguration,
> extends Trigger<TConfiguration> {
  public strictAgentMatch = true;

  registryResolver: RegistryResolver;

  runtimeConfigManager: ContainerRuntimeConfigManager;

  securityGate?: SecurityGate;

  hookExecutor: HookExecutor;

  selfUpdateOrchestrator: SelfUpdateOrchestrator;

  containerUpdateExecutor: ContainerUpdateExecutor;

  updateLifecycleExecutor: UpdateLifecycleExecutor;

  rollbackMonitor: RollbackMonitor;

  constructor() {
    super();

    this.registryResolver = new RegistryResolver();
    this.runtimeConfigManager = new ContainerRuntimeConfigManager({
      getPreferredLabelValue,
      getLogger: () => this.log,
    });
    const getCloneRuntimeConfigOptions =
      this.runtimeConfigManager.getCloneRuntimeConfigOptions.bind(this.runtimeConfigManager);
    const buildRuntimeConfigCompatibilityError =
      this.runtimeConfigManager.buildRuntimeConfigCompatibilityError.bind(
        this.runtimeConfigManager,
      );
    this.hookExecutor = new HookExecutor({
      runHook,
      getPreferredLabelValue,
      getLogger: () => this.log,
      ...pickOrchestratorCallbacks(this, HOOK_EXECUTOR_ORCHESTRATOR_METHODS),
    });
    this.selfUpdateOrchestrator = new SelfUpdateOrchestrator({
      getConfiguration: () => this.configuration,
      runtimeConfigManager: this.runtimeConfigManager,
      ...pickOrchestratorCallbacks(this, SELF_UPDATE_ORCHESTRATOR_METHODS),
      emitSelfUpdateStarting,
      resolveFinalizeUrl: () => this.getSelfUpdateFinalizeUrl(),
      resolveFinalizeSecret: (operationId) => this.getSelfUpdateFinalizeSecret(operationId),
      resolveObserverNetworkMode: () => this.resolveObserverNetworkMode(),
      resolveObservedHelperRuntime: (context, container) =>
        this.resolveObservedHelperRuntime(context, container),
      finalizeObservedHelperOperation: (operationId, status, lastError) =>
        this.finalizeObservedHelperOperation(operationId, status, lastError),
      resolveHelperImage: (container) => {
        if (this.isSelfUpdate(container)) {
          return undefined;
        }
        const drydockContainer = storeContainer
          .getContainers()
          .find((c) => c.image?.name === 'drydock' || c.image?.name?.endsWith('/drydock'));
        if (!drydockContainer) {
          return undefined;
        }
        const { name, tag, registry } = drydockContainer.image ?? {};
        if (!name || !tag?.value) {
          return undefined;
        }
        // The helper container is spawned from this reference without ever being
        // pulled, so it must match how the Docker daemon names the image locally.
        // Provider-specific getImageFullName implementations already encode that
        // normalization (e.g. Hub strips the registry-1.docker.io/ host prefix
        // the daemon also omits) — delegate to the resolved registry manager
        // rather than reconstructing the same logic here (#644).
        try {
          const registryManager = this.resolveRegistryManager(drydockContainer, this.log);
          return registryManager.getImageFullName(drydockContainer.image, tag.value);
        } catch {
          // No compatible registry manager — fall back to manual construction below.
        }
        // registry.url is the v2 API base (e.g. "https://ghcr.io/v2" or
        // "https://ghcr.io/v2/"). Docker's POST /containers/create rejects
        // that form with HTTP 400.  Delegate to buildImageReference which
        // strips the scheme and the trailing /v2[/] segment before
        // concatenation, matching Registry.getImageFullName exactly.
        if (!registry?.url) {
          return `${name}:${tag.value}`;
        }
        const builtReference = buildImageReference(registry.url, name, tag.value);
        // Mirrors Hub.getImageFullName: when no registry manager resolved (so
        // this manual fallback ran instead), a Docker Hub registry URL still
        // needs its host stripped — the daemon stores Hub images under the
        // short name, not under registry-1.docker.io/. Anchored at the start
        // only so non-Hub references pass through untouched (#644).
        return builtReference.replace(
          /^(?:registry-1\.docker\.io|index\.docker\.io|docker\.io)\//,
          '',
        );
      },
      touchOperation: (operationId) => {
        updateOperationStore.updateOperation(operationId, {});
      },
    });
    this.containerUpdateExecutor = new ContainerUpdateExecutor({
      getConfiguration: () => this.configuration,
      getTriggerId: () => this.getId(),
      ...pickOrchestratorCallbacks(this, CONTAINER_UPDATE_ORCHESTRATOR_METHODS),
      getCloneRuntimeConfigOptions,
      buildRuntimeConfigCompatibilityError,
      persistRollbackState: (containerId, outcome, rollbackInfo) => {
        const containerCurrent = storeContainer.getContainer(containerId);
        if (!containerCurrent) {
          return;
        }
        if (outcome === 'rolled-back') {
          storeContainer.updateContainer({
            ...containerCurrent,
            updateRollback: {
              recordedAt: new Date().toISOString(),
              // Use the strongest candidate identity from the registry result.
              // Digest is preferred, but some registries only provide tag data.
              // The rollback gate compares against this same field on the next
              // update attempt so tag-only updates can still be blocked.
              targetDigest: containerCurrent.result?.digest ?? containerCurrent.result?.tag ?? '',
              reason: rollbackInfo?.reason ?? '',
              lastError: rollbackInfo?.lastError ?? '',
            },
          });
        } else {
          // Success — clear any prior rollback state
          storeContainer.updateContainer({
            ...containerCurrent,
            updateRollback: undefined,
          } as typeof containerCurrent);
        }
      },
      scheduleDeferredReconciliation: (containerName, operationId, delayMs) => {
        setTimeout(async () => {
          try {
            // Resolve by operation ID first — avoids cross-agent name collision
            // when both agents share the same default watcher name ('local') (#386).
            const operationContainerId =
              updateOperationStore.getOperationById(operationId)?.containerId;
            const container =
              (operationContainerId
                ? storeContainer.getContainer(operationContainerId)
                : undefined) ??
              storeContainer
                .getContainers()
                .find(
                  (c) =>
                    c.name === containerName &&
                    (c.agent ?? undefined) === (this.agent ?? undefined),
                );
            if (!container) {
              return;
            }
            const watcher = this.getWatcher(container);
            const dockerApi = watcher.dockerApi as Parameters<
              typeof this.containerUpdateExecutor.reconcileInProgressContainerUpdateOperation
            >[0];
            const logContainer = this.log?.child?.({ container: containerName }) ?? {
              info: () => {},
              warn: () => {},
              debug: () => {},
            };
            await this.containerUpdateExecutor.reconcileInProgressContainerUpdateOperation(
              dockerApi,
              container,
              logContainer,
            );
          } catch (e: unknown) {
            this.log?.warn?.(
              `Deferred reconciliation failed for ${containerName}: ${String((e as Error)?.message ?? e)}`,
            );
            // Prevent the operation from being permanently stuck in-progress:
            // if the reconciliation callback itself throws, mark the operation
            // terminal as failed — unless it has already been terminalized by
            // another path or is a self-update (whose termination is owned by
            // the finalize callback, with startup reconciliation as the fallback).
            const deferredOperation = updateOperationStore.getOperationById(operationId);
            if (
              deferredOperation &&
              deferredOperation.kind !== 'self-update' &&
              (deferredOperation.status === 'queued' || deferredOperation.status === 'in-progress')
            ) {
              updateOperationStore.markOperationTerminal(operationId, {
                status: 'failed',
                phase: 'failed',
                lastError: getErrorMessage(e),
              });
            }
          }
        }, delayMs);
      },
    });
    this.rollbackMonitor = new RollbackMonitor({
      getPreferredLabelValue,
      getLogger: () => this.log,
      ...pickOrchestratorCallbacks(this, ROLLBACK_MONITOR_ORCHESTRATOR_METHODS),
      startHealthMonitor,
      getTriggerInstance: () => this,
      resolveContainerBackupScope: (container) => this.resolveContainerBackupScope(container),
    });
    const updateLifecycleCallbacks = pickOrchestratorCallbacks(
      this,
      UPDATE_LIFECYCLE_ORCHESTRATOR_METHODS,
    );
    this.updateLifecycleExecutor = new UpdateLifecycleExecutor({
      logger: {
        getLogger: () => this.log,
      },
      context: {
        getContainerFullName: (container) => getContainerFullNameForLifecycle(container),
        createTriggerContext: updateLifecycleCallbacks.createTriggerContext,
      },
      security: {
        maybeScanAndGateUpdate: updateLifecycleCallbacks.maybeScanAndGateUpdate,
        verifySignaturePreUpdate: updateLifecycleCallbacks.verifySignaturePreUpdate,
        scanAndGatePostPull: updateLifecycleCallbacks.scanAndGatePostPull,
      },
      hooks: {
        buildHookConfig: updateLifecycleCallbacks.buildHookConfig,
        recordHookConfigurationAudit: updateLifecycleCallbacks.recordHookConfigurationAudit,
        runPreUpdateHook: updateLifecycleCallbacks.runPreUpdateHook,
        runPostUpdateHook: updateLifecycleCallbacks.runPostUpdateHook,
      },
      selfUpdate: {
        isSelfUpdate: updateLifecycleCallbacks.isSelfUpdate,
        isInfrastructureUpdate: updateLifecycleCallbacks.isInfrastructureUpdate,
        prepareSelfUpdateOperation: updateLifecycleCallbacks.prepareSelfUpdateOperation,
        maybeNotifySelfUpdate: updateLifecycleCallbacks.maybeNotifySelfUpdate,
        executeSelfUpdate: updateLifecycleCallbacks.executeSelfUpdate,
        markSelfUpdateOperationFailed: updateLifecycleCallbacks.markSelfUpdateOperationFailed,
        markSelfUpdateOperationSkipped: updateLifecycleCallbacks.markSelfUpdateOperationSkipped,
      },
      runtimeUpdate: {
        runPreRuntimeUpdateLifecycle: updateLifecycleCallbacks.runPreRuntimeUpdateLifecycle,
        performContainerUpdate: updateLifecycleCallbacks.performContainerUpdate,
        setOperationPhase: (operationId: string, phase: 'scanning' | 'sbom-generating') => {
          updateOperationStore.updateOperation(operationId, { phase });
        },
      },
      postUpdate: {
        cleanupOldImages: updateLifecycleCallbacks.cleanupOldImages,
        getRollbackConfig: updateLifecycleCallbacks.getRollbackConfig,
        maybeStartAutoRollbackMonitor: updateLifecycleCallbacks.maybeStartAutoRollbackMonitor,
        pruneOldBackups: (container, backupCount) =>
          backupStore.pruneOldBackups(this.resolveContainerBackupScope(container), backupCount),
        getBackupCount: () => this.configuration?.backupcount,
      },
      telemetry: {
        emitContainerUpdateApplied,
        emitContainerUpdateFailed,
      },
    });
  }

  getSecurityGate() {
    if (!this.securityGate) {
      this.securityGate = new SecurityGate({
        getSecurityConfiguration,
        verifyImageSignature,
        scanImageForVulnerabilities,
        generateImageSbom,
        getContainer: (id) => storeContainer.getContainer(id),
        updateContainer: storeContainer.updateContainer,
        cacheSecurityState,
        emitSecurityAlert,
        fullName,
        scanImageWithDedup,
        getTrivyDbUpdatedAt: async () => {
          const status = await getTrivyDatabaseStatus();
          return status?.updatedAt;
        },
        getScanIntervalMs: () => getSchedulerScanIntervalMs(),
        offloadSbom: async (sbom, subjectDigest) => {
          if (isMemoryStore()) {
            return sbom;
          }
          const rootDir = resolveConfiguredPath(
            (getStoreConfiguration() as { path?: string }).path || '/store',
            { label: 'DD_STORE_PATH' },
          );
          return offloadSbomDocuments({
            sbom,
            subjectDigest,
            storage: createSbomStorage({ rootDir }),
          });
        },
        pruneImage: async (image, dockerApi) => {
          try {
            await dockerApi?.getImage(image).remove();
          } catch {
            /* swallow */
          }
        },
        ...pickOrchestratorCallbacks(this, SECURITY_GATE_ORCHESTRATOR_METHODS),
      });
    }
    return this.securityGate;
  }

  isContainerNotFoundError(error: unknown) {
    if (!error) {
      return false;
    }

    const statusCode =
      getErrorNumberField(error, 'statusCode') ?? getErrorNumberField(error, 'status');
    if (statusCode === 404) {
      return true;
    }

    const errorMessage = `${getErrorStringField(error, 'message') ?? ''} ${getErrorStringField(error, 'reason') ?? ''} ${getErrorJsonMessage(error) ?? ''}`;
    return errorMessage.toLowerCase().includes('no such container');
  }

  /**
   * Get the Trigger configuration schema.
   * @returns {*}
   */
  getConfigurationSchema() {
    return this.joi.object().keys({
      prune: this.joi.boolean().default(false),
      dryrun: this.joi.boolean().default(false),
      autoremovetimeout: this.joi.number().default(10_000),
      pulltimeout: this.joi
        .number()
        .integer()
        .positive()
        .max(MAX_SIGNED_32_BIT_TIMEOUT_MS)
        .default(DEFAULT_PULL_TIMEOUT_MS),
      helpercompletiontimeout: this.joi
        .number()
        .integer()
        .positive()
        .max(MAX_SIGNED_32_BIT_TIMEOUT_MS)
        .default(DEFAULT_PULL_TIMEOUT_MS),
      backupcount: this.joi.number().default(3),
    });
  }

  /**
   * Get watcher responsible for the container.
   * @param container
   * @returns {*}
   */

  getWatcher(container) {
    const watcherId = container?.agent
      ? `${container.agent}.docker.${container.watcher}`
      : `docker.${container.watcher}`;
    const watcher = getState().watcher[watcherId];
    if (!watcher) {
      const containerIdOrName = container?.id || container?.name || 'unknown';
      throw new Error(`No watcher found for container ${containerIdOrName} (${watcherId})`);
    }
    return watcher;
  }

  normalizeRegistryHost(registryUrlOrName) {
    return this.registryResolver.normalizeRegistryHost(registryUrlOrName);
  }

  buildRegistryLookupCandidates(image) {
    return this.registryResolver.buildRegistryLookupCandidates(image);
  }

  isRegistryManagerCompatible(registry, options = {}) {
    return this.registryResolver.isRegistryManagerCompatible(registry, options);
  }

  createAnonymousRegistryManager(container, logContainer) {
    return this.registryResolver.createAnonymousRegistryManager(container, logContainer);
  }

  resolveRegistryManager(container, logContainer, options = {}) {
    const registryName = container?.image?.registry?.name;
    const registryState = getState().registry || {};
    const requireNormalizeImage =
      this.configuration.prune === true && !this.isSelfUpdate(container);
    return this.registryResolver.resolveRegistryManager(container, logContainer, registryState, {
      ...options,
      requireNormalizeImage,
      registryName,
    });
  }

  /**
   * Get current container.
   * @param dockerApi
   * @param container
   * @returns {Promise<*>}
   */
  async getCurrentContainer(dockerApi, container) {
    this.log.debug(`Get container ${container.id}`);
    try {
      return await dockerApi.getContainer(container.id);
    } catch (e: unknown) {
      this.log.warn(`Error when getting container ${container.id}`);
      throw e;
    }
  }

  /**
   * Inspect container.
   * @param container
   * @returns {Promise<*>}
   */
  async inspectContainer(container, logContainer) {
    this.log.debug(`Inspect container ${container.id}`);
    try {
      return await container.inspect();
    } catch (e: unknown) {
      logContainer.warn(`Error when inspecting container ${container.id}`);
      throw e;
    }
  }

  /**
   * Prune previous image versions.
   * @param dockerApi
   * @param registry
   * @param container
   * @param logContainer
   * @returns {Promise<void>}
   */
  async pruneImages(dockerApi, registry, container, logContainer) {
    logContainer.info('Pruning previous tags');
    try {
      // Get all pulled images
      const images = await dockerApi.listImages();

      // Find all pulled images to remove
      const imagesToRemove = images
        .filter((image) => hasRepoTags(image))
        .map((image) => ({
          image,
          normalizedImage: normalizeListedImage(registry, image),
        }))
        .filter(({ normalizedImage }) => !shouldKeepImage(normalizedImage, container))
        .map(({ image }) => image)
        .map((imageToRemove) => dockerApi.getImage(imageToRemove.Id));
      await Promise.all(
        imagesToRemove.map((imageToRemove) => {
          logContainer.info(`Prune image ${imageToRemove.name}`);
          return imageToRemove.remove();
        }),
      );
    } catch (e: unknown) {
      logContainer.warn(
        `Some errors occurred when trying to prune previous tags (${getErrorMessage(e)})`,
      );
    }
  }

  formatPullProgress(progressEvent) {
    const progressDetail = progressEvent?.progressDetail || {};
    if (
      typeof progressDetail.current === 'number' &&
      typeof progressDetail.total === 'number' &&
      progressDetail.total > 0
    ) {
      const percentage = Math.round((progressDetail.current * 100) / progressDetail.total);
      return `${progressDetail.current}/${progressDetail.total} (${percentage}%)`;
    }
    if (
      progressEvent &&
      typeof progressEvent.progress === 'string' &&
      progressEvent.progress.trim() !== ''
    ) {
      return progressEvent.progress;
    }
    return undefined;
  }

  createPullProgressLogger(logContainer, imageName) {
    let lastLogAt = 0;
    let lastProgressSnapshot = '';
    const logProgress = (progressEvent, force = false) => {
      if (!progressEvent || typeof logContainer.debug !== 'function') {
        return;
      }

      const status = progressEvent.status || 'progress';
      const layer = progressEvent.id ? ` layer=${progressEvent.id}` : '';
      const progress = this.formatPullProgress(progressEvent);
      const progressSnapshot = progress ? `${status}${layer} ${progress}` : `${status}${layer}`;
      const now = Date.now();

      if (
        !force &&
        now - lastLogAt < PULL_PROGRESS_LOG_INTERVAL_MS &&
        progressSnapshot === lastProgressSnapshot
      ) {
        return;
      }
      if (!force && now - lastLogAt < PULL_PROGRESS_LOG_INTERVAL_MS) {
        return;
      }

      lastLogAt = now;
      lastProgressSnapshot = progressSnapshot;
      logContainer.debug(`Pull progress for ${imageName}: ${progressSnapshot}`);
    };

    return {
      onProgress: (progressEvent) => logProgress(progressEvent),
      onDone: (progressEvent) => logProgress(progressEvent, true),
    };
  }

  /**
   * Pull new image.
   * @param dockerApi
   * @param auth
   * @param newImage
   * @param logContainer
   * @returns {Promise<void>}
   */

  async pullImage(dockerApi, auth, newImage, logContainer) {
    logContainer.info(`Pull image ${newImage}`);
    try {
      const pullProgressLogger = this.createPullProgressLogger(logContainer, newImage);
      const pullTimeout = this.configuration.pulltimeout ?? DEFAULT_PULL_TIMEOUT_MS;
      const abortController = new AbortController();
      let pullStream;

      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const settle = (error?: unknown) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timeout);
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        };
        const destroyPullStream = (stream) => {
          if (typeof stream?.destroy !== 'function') {
            return;
          }
          try {
            stream.destroy();
          } catch {
            // The timeout remains the authoritative failure if stream cleanup throws.
          }
        };
        const timeout = setTimeout(() => {
          const timeoutError = new Error(`Pull image ${newImage} timed out after ${pullTimeout}ms`);
          settle(timeoutError);
          abortController.abort(timeoutError);
          destroyPullStream(pullStream);
        }, pullTimeout);

        void dockerApi
          .pull(newImage, {
            authconfig: auth,
            abortSignal: abortController.signal,
          })
          .then(
            (stream) => {
              pullStream = stream;
              if (settled) {
                destroyPullStream(stream);
                return;
              }
              try {
                dockerApi.modem.followProgress(
                  stream,
                  (error, output) => {
                    if (settled) {
                      return;
                    }
                    if (Array.isArray(output) && output.length > 0) {
                      pullProgressLogger.onDone(output.at(-1));
                    }
                    settle(error);
                  },
                  (progressEvent) => {
                    if (!settled) {
                      pullProgressLogger.onProgress(progressEvent);
                    }
                  },
                );
              } catch (error: unknown) {
                settle(error);
              }
            },
            (error) => settle(error),
          );
      });
      logContainer.info(`Image ${newImage} pulled with success`);
    } catch (e: unknown) {
      logContainer.warn(`Error when pulling image ${newImage} (${getErrorMessage(e)})`);
      throw e;
    }
  }

  /**
   * Pull the image a rollback is about to recreate from, resolving the pull
   * credentials the same way every other pull on this trigger does.
   *
   * Neither recreate path pulls for itself: `Docker.recreateContainer` goes
   * straight to `createContainer`, and the compose one runs its runtime
   * refresh with `skipPull` so the manual rollback in `app/api/backup.ts`,
   * which pulls before it calls in, is not made to pull twice. That leaves the
   * caller owning the pull, and the automatic rollback never did one. It only
   * logged that it was about to. A backup image that is no longer on the host
   * then failed at create, after the running container had already been
   * removed (DR-110).
   *
   * `rollbackImage` is whatever `buildRollbackImageReference` produced, so a
   * backup with a captured digest pulls `repo:tag@sha256:...` and the daemon
   * resolves it by digest: a retag between the backup and the rollback cannot
   * change what comes back.
   */
  async pullRollbackImage(dockerApi, rollbackImage, container, logContainer) {
    const registry = this.resolveRegistryManager(container, logContainer, {
      allowAnonymousFallback: true,
    });
    const auth = await registry.getAuthPull();
    await this.pullImage(dockerApi, auth, rollbackImage, logContainer);
  }

  /**
   * Stop a container.
   * @param container
   * @param containerName
   * @param containerId
   * @param logContainer
   * @returns {Promise<void>}
   */

  async stopContainer(container, containerName, containerId, logContainer) {
    logContainer.info(`Stop container ${containerName} with id ${containerId}`);
    try {
      await container.stop();
      logContainer.info(`Container ${containerName} with id ${containerId} stopped with success`);
    } catch (e: unknown) {
      logContainer.warn(`Error when stopping container ${containerName} with id ${containerId}`);
      throw e;
    }
  }

  /**
   * Remove a container.
   * @param container
   * @param containerName
   * @param containerId
   * @param logContainer
   * @returns {Promise<void>}
   */
  async removeContainer(container, containerName, containerId, logContainer) {
    logContainer.info(`Remove container ${containerName} with id ${containerId}`);
    try {
      await container.remove();
      logContainer.info(`Container ${containerName} with id ${containerId} removed with success`);
    } catch (e: unknown) {
      logContainer.warn(`Error when removing container ${containerName} with id ${containerId}`);
      throw e;
    }
  }

  /**
   * Wait for a container to be removed.
   */
  async waitContainerRemoved(container, containerName, containerId, logContainer) {
    logContainer.info(`Wait container ${containerName} with id ${containerId}`);
    try {
      await container.wait({
        condition: 'removed',
        abortSignal: AbortSignal.timeout(this.configuration.autoremovetimeout),
      });
      logContainer.info(
        `Container ${containerName} with id ${containerId} auto-removed successfully`,
      );
    } catch (e: unknown) {
      logContainer.warn(
        e,
        `Error while waiting for container ${containerName} with id ${containerId}`,
      );
      throw e;
    }
  }

  /**
   * Create a new container.
   * @param dockerApi
   * @param containerToCreate
   * @param containerName
   * @param logContainer
   * @returns {Promise<*>}
   */
  async createContainer(dockerApi, containerToCreate, containerName, logContainer) {
    logContainer.info(`Create container ${containerName}`);
    let newContainer: DockerContainerHandle | undefined;
    try {
      let containerToCreatePayload = containerToCreate;
      const endpointsConfig = containerToCreate.NetworkingConfig?.EndpointsConfig || {};
      const endpointNetworkNames = Object.keys(endpointsConfig);
      const additionalNetworkNames = [];

      if (endpointNetworkNames.length > 1) {
        const primaryNetworkName = this.runtimeConfigManager.getPrimaryNetworkName(
          containerToCreate,
          endpointNetworkNames,
        );

        containerToCreatePayload = {
          ...containerToCreate,
          NetworkingConfig: {
            EndpointsConfig: {
              [primaryNetworkName]: endpointsConfig[primaryNetworkName],
            },
          },
        };
        additionalNetworkNames.push(
          ...endpointNetworkNames.filter((networkName) => networkName !== primaryNetworkName),
        );
      }

      newContainer = await dockerApi.createContainer(containerToCreatePayload);

      for (const networkName of additionalNetworkNames) {
        logContainer.info(`Connect container ${containerName} to network ${networkName}`);
        const network = dockerApi.getNetwork(networkName);
        await network.connect({
          Container: containerName,
          EndpointConfig: endpointsConfig[networkName],
        });
        logContainer.info(
          `Container ${containerName} connected to network ${networkName} with success`,
        );
      }

      logContainer.info(`Container ${containerName} recreated on new image with success`);
      return newContainer;
    } catch (e: unknown) {
      // #macvlan incident: if the container was created but a later network
      // connect failed, stash the handle on the error so callers up the stack
      // (rollback/reconciliation paths) can stop+force-remove the orphan
      // instead of losing it — see created-container-candidate.ts.
      attachCreatedContainerCandidate(e, newContainer);
      logContainer.warn(`Error when creating container ${containerName} (${getErrorMessage(e)})`);
      throw e;
    }
  }

  /**
   * Start container.
   * @param container
   * @param containerName
   * @param logContainer
   * @returns {Promise<void>}
   */
  async startContainer(container, containerName, logContainer) {
    logContainer.info(`Start container ${containerName}`);
    try {
      await container.start();
      logContainer.info(`Container ${containerName} started with success`);
    } catch (e: unknown) {
      logContainer.warn(`Error when starting container ${containerName}`);
      throw e;
    }
  }

  /**
   * Remove an image.
   * @param dockerApi
   * @param imageToRemove
   * @param logContainer
   * @returns {Promise<void>}
   */
  async removeImage(dockerApi, imageToRemove, logContainer) {
    logContainer.info(`Remove image ${imageToRemove}`);
    try {
      const image = await dockerApi.getImage(imageToRemove);
      await image.remove();
      logContainer.info(`Image ${imageToRemove} removed with success`);
    } catch (e: unknown) {
      logContainer.warn(`Error when removing image ${imageToRemove}`);
      throw e;
    }
  }

  /**
   * Clone container specs.
   * @param currentContainer
   * @param newImage
   * @returns {*}
   */
  cloneContainer(currentContainer, newImage, runtimeOptionsOrLogContainer = {}) {
    const {
      sourceImageConfig,
      targetImageConfig,
      runtimeFieldOrigins,
      defaultRuntime,
      logContainer,
    } = this.runtimeConfigManager.buildCloneRuntimeConfigOptions(runtimeOptionsOrLogContainer);
    const containerName = currentContainer.Name.replace('/', '');
    const currentContainerNetworks = currentContainer.NetworkSettings?.Networks || {};
    const currentContainerNetworkNames = Object.keys(currentContainerNetworks);
    // Config.MacAddress is container-wide legacy data that Docker only ever
    // applies to the container's primary/create-time network (the one named
    // by HostConfig.NetworkMode, or the sole network for a single-network
    // container). Forwarding it to every network in a multi-network
    // container would re-pin the same MAC onto endpoints that never had it.
    const legacyContainerMacAddress = currentContainer.Config?.MacAddress;
    const primaryNetworkName = this.runtimeConfigManager.getPrimaryNetworkName(
      currentContainer,
      currentContainerNetworkNames,
    );
    const endpointsConfig = Object.entries(currentContainerNetworks).reduce(
      (acc: Record<string, unknown>, [networkName, endpointConfig]) => {
        acc[networkName] = this.runtimeConfigManager.sanitizeEndpointConfig(
          endpointConfig as Record<string, unknown> | null | undefined,
          currentContainer.Id,
          networkName === primaryNetworkName ? legacyContainerMacAddress : undefined,
        );
        return acc;
      },
      {},
    );
    const sanitizedContainerConfig = this.runtimeConfigManager.sanitizeClonedRuntimeConfig(
      currentContainer.Config,
      sourceImageConfig,
      targetImageConfig,
      runtimeFieldOrigins,
      logContainer,
    );
    const shouldAnnotateRuntimeFieldOrigins =
      sourceImageConfig !== undefined ||
      targetImageConfig !== undefined ||
      runtimeFieldOrigins !== undefined;
    const clonedContainerConfig = shouldAnnotateRuntimeFieldOrigins
      ? this.runtimeConfigManager.annotateClonedRuntimeFieldOrigins(
          sanitizedContainerConfig,
          runtimeFieldOrigins,
          targetImageConfig,
        )
      : sanitizedContainerConfig;

    const containerClone: {
      HostConfig?: { NetworkMode?: string };
      Hostname?: unknown;
      ExposedPorts?: unknown;
      [key: string]: unknown;
    } = {
      ...clonedContainerConfig,
      name: containerName,
      Image: newImage,
      HostConfig: currentContainer.HostConfig,
      NetworkingConfig: {
        EndpointsConfig: endpointsConfig,
      },
    };
    // The deprecated root-level `MacAddress` field (spread in above via
    // clonedContainerConfig, which carries Config.MacAddress verbatim) is
    // superseded by the primary network's endpoint-level MacAddress set
    // above via sanitizeEndpointConfig — that's now the canonical carrier.
    // But on daemons older than API 1.44, moby's handleMACAddressBC discards
    // an EndpointsConfig MacAddress entirely when the root field is empty
    // ("If a MAC address is supplied in EndpointsConfig, discard it because
    // the old API would have ignored it") — so clearing the root field
    // unconditionally would silently drop an explicitly-configured MAC on
    // those daemons. On API >= 1.44 a root field that matches the primary
    // endpoint's MAC is accepted (the 400 only fires on a mismatch), and it
    // always does match here since both are set from legacyContainerMacAddress
    // via sanitizeEndpointConfig above. So: keep the root field as a
    // back-compat carrier when the MAC was explicitly configured, and delete
    // it otherwise so a daemon-assigned MAC regenerates and doesn't trip
    // MAC-denying socket proxies (e.g. sockguard) that reject an explicit
    // root MacAddress on create.
    if (!legacyContainerMacAddress) {
      delete containerClone.MacAddress;
    }
    // Handle situation when container is using network_mode: service:other_service
    if (containerClone.HostConfig?.NetworkMode?.startsWith('container:')) {
      delete containerClone.Hostname;
      delete containerClone.ExposedPorts;
    }

    // Drop HostConfig.Runtime when it merely restates the daemon default. The
    // inspect spec is copied verbatim, and most daemons report an explicit
    // Runtime ("runc") that a hardened socket proxy enforcing a runtime
    // allowlist will reject at POST /containers/create. Omitting it lets the
    // daemon apply its own default, while an explicitly-selected non-default
    // runtime (nvidia, kata, sysbox-runc, …) is preserved. Clone the HostConfig
    // before editing so the source inspect spec (reused for rollback) is left
    // untouched.
    const hostConfig = containerClone.HostConfig as
      | (Record<string, unknown> & { Runtime?: unknown })
      | undefined;
    if (defaultRuntime !== undefined && hostConfig && hostConfig.Runtime === defaultRuntime) {
      const hostConfigWithoutRuntime = { ...hostConfig };
      delete hostConfigWithoutRuntime.Runtime;
      containerClone.HostConfig = hostConfigWithoutRuntime as { NetworkMode?: string };
    }

    return containerClone;
  }

  /**
   * Get image full name.
   * @param registry the registry
   * @param container the container
   */
  getNewImageFullName(registry, container) {
    const currentRef = container.image.tag.value;
    const isDigestPinned = typeof currentRef === 'string' && currentRef.startsWith('sha256:');

    // Digest updates usually re-pull the same tag, but digest-pinned refs need
    // the new remote digest to move off the currently pinned image.
    const tagOrDigest =
      container.updateKind.kind === 'digest'
        ? isDigestPinned
          ? (container.updateKind.remoteValue ?? currentRef)
          : currentRef
        : (container.updateKind.remoteValue ?? currentRef);

    // Rebuild image definition string
    return registry.getImageFullName(container.image, tagOrDigest);
  }

  /**
   * Stop and remove (or wait for auto-removal of) a container.
   */
  async stopAndRemoveContainer(currentContainer, currentContainerSpec, container, logContainer) {
    if (currentContainerSpec.State.Running) {
      await this.stopContainer(currentContainer, container.name, container.id, logContainer);
    }

    if (currentContainerSpec.HostConfig?.AutoRemove !== true) {
      await this.removeContainer(currentContainer, container.name, container.id, logContainer);
    } else {
      await this.waitContainerRemoved(currentContainer, container.name, container.id, logContainer);
    }
  }

  /**
   * Create a new container from the cloned spec and start it if
   * the previous container was running.
   */
  async recreateContainer(dockerApi, currentContainerSpec, newImage, container, logContainer) {
    const containerToCreateInspect = this.cloneContainer(
      currentContainerSpec,
      newImage,
      logContainer,
    );

    const newContainer = await this.createContainer(
      dockerApi,
      containerToCreateInspect,
      container.name,
      logContainer,
    );

    if (currentContainerSpec.State.Running) {
      try {
        await this.startContainer(newContainer, container.name, logContainer);
      } catch (e: unknown) {
        // #macvlan incident: createContainer already succeeded here, so the
        // handle isn't lost the way an in-flight create failure is — but
        // startContainer's own catch only logs+rethrows, so without this the
        // created-but-unstarted container would still squat the canonical
        // name with nothing recovering it. Attach it the same way
        // createContainer does so every consumer that recovers orphans via
        // getCreatedContainerCandidate(error) (HealthMonitor, backup
        // rollback, Dockercompose) picks it up too.
        attachCreatedContainerCandidate(e, newContainer);
        throw e;
      }
    }
  }

  /**
   * Remove old images after a container update when pruning is enabled.
   */
  async cleanupOldImages(dockerApi, registry, container, logContainer) {
    if (!this.configuration.prune) return;

    // Don't prune images that are retained as backups — they're needed for rollback
    const retainedBackups =
      backupStore.getBackupsForContainer(this.resolveContainerBackupScope(container)) || [];
    const retainedTags = new Set(retainedBackups.map((b) => b.imageTag));

    if (container.updateKind.kind === 'tag') {
      if (retainedTags.has(container.image.tag.value)) {
        logContainer.info(`Skipping prune of ${container.image.tag.value} — retained for rollback`);
        return;
      }
      const oldImage = registry.getImageFullName(container.image, container.image.tag.value);
      await this.removeImage(dockerApi, oldImage, logContainer);
    } else if (container.updateKind.kind === 'digest' && container.image.digest.repo) {
      try {
        const oldImage = registry.getImageFullName(container.image, container.image.digest.repo);
        await this.removeImage(dockerApi, oldImage, logContainer);
      } catch (e: unknown) {
        logContainer.warn(`Unable to remove previous digest image (${getErrorMessage(e)})`);
      }
    }
  }

  /**
   * Preview what an update would do without performing it.
   * @param container the container
   * @returns {Promise<object>} preview info
   */
  async preview(container) {
    const logContainer = this.log.child({ container: fullName(container) });
    const watcher = this.getWatcher(container);
    const { dockerApi } = watcher;
    const registry = this.resolveRegistryManager(container, logContainer, {
      allowAnonymousFallback: true,
    });
    const newImage = this.getNewImageFullName(registry, container);

    const currentContainer = await this.getCurrentContainer(dockerApi, container);
    if (currentContainer) {
      const currentContainerSpec = await this.inspectContainer(currentContainer, logContainer);

      return {
        containerName: container.name,
        currentImage: `${container.image.registry.name}/${container.image.name}:${container.image.tag.value}`,
        newImage,
        updateKind: container.updateKind,
        isRunning: currentContainerSpec.State.Running,
        networks: Object.keys(currentContainerSpec.NetworkSettings?.Networks || {}),
      };
    }
    return { error: 'Container not found in Docker' };
  }

  buildHookConfig(container) {
    return this.hookExecutor.buildHookConfig(container);
  }

  recordAudit(action, container, status, details) {
    auditStore.insertAudit({
      id: '',
      timestamp: new Date().toISOString(),
      action,
      containerName: fullName(container),
      containerImage: container.image.name,
      status,
      details,
    });
    getAuditCounter()?.inc({ action });
  }

  recordRollbackAudit(container, status, details, fromVersion?: string, toVersion?: string) {
    auditStore.insertAudit({
      id: '',
      timestamp: new Date().toISOString(),
      action: 'rollback',
      containerName: fullName(container),
      containerImage: container.image.name,
      status,
      details,
      fromVersion,
      toVersion,
    });
    getAuditCounter()?.inc({ action: 'rollback' });
  }

  recordRollbackTelemetry({
    container,
    outcome,
    reason,
    details,
    fromVersion,
    toVersion,
  }: RollbackTelemetryPayload) {
    const reasonLabel = String(reason || 'unspecified')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 63);

    getRollbackCounter()?.inc({
      type: this.type || 'docker',
      name: this.name || 'update',
      outcome,
      reason: reasonLabel || 'unspecified',
    });

    const auditStatus = outcome === 'error' ? 'error' : outcome === 'success' ? 'success' : 'info';
    this.recordRollbackAudit(container, auditStatus, details, fromVersion, toVersion);
  }

  hasHealthcheckConfigured(containerSpec) {
    return !!(containerSpec?.Config?.Healthcheck || containerSpec?.State?.Health);
  }

  async waitForContainerHealthy(containerToCheck, containerName, logContainer, timeoutMs?) {
    const healthGateTimeoutMs =
      Number.isFinite(timeoutMs) && timeoutMs > 0
        ? Math.max(NON_SELF_UPDATE_HEALTH_TIMEOUT_MS, timeoutMs)
        : NON_SELF_UPDATE_HEALTH_TIMEOUT_MS;
    const startedAt = Date.now();
    while (Date.now() - startedAt < healthGateTimeoutMs) {
      const inspection = await containerToCheck.inspect();
      const healthState = inspection?.State?.Health;
      const healthStatus = healthState?.Status;

      if (!healthState) {
        logContainer.debug?.(
          `Container ${containerName} health state not yet available — waiting for health gate`,
        );
        await new Promise((resolve) =>
          setTimeout(resolve, NON_SELF_UPDATE_HEALTH_POLL_INTERVAL_MS),
        );
        continue;
      }

      if (healthStatus === 'healthy') {
        logContainer.info(`Container ${containerName} passed health gate`);
        return;
      }

      if (healthStatus === 'unhealthy') {
        throw new Error(`Health gate failed: container ${containerName} reported unhealthy`);
      }

      await new Promise((resolve) => setTimeout(resolve, NON_SELF_UPDATE_HEALTH_POLL_INTERVAL_MS));
    }

    throw new Error(
      `Health gate timed out after ${healthGateTimeoutMs}ms for container ${containerName}`,
    );
  }

  async reconcileInProgressContainerUpdateOperation(dockerApi, container, logContainer) {
    return this.containerUpdateExecutor.reconcileInProgressContainerUpdateOperation(
      dockerApi,
      container,
      logContainer,
    );
  }

  recordHookAudit(action, container, status, details) {
    this.recordAudit(action, container, status, details);
  }

  recordHookConfigurationAudit(container, hookConfig) {
    const hasPreHook = Boolean(hookConfig.hookPre);
    const hasPostHook = Boolean(hookConfig.hookPost);
    if (!hasPreHook && !hasPostHook) {
      return;
    }

    this.recordHookAudit(
      'hook-configured',
      container,
      'info',
      `Lifecycle hooks configured from labels (pre=${hasPreHook}, post=${hasPostHook}, preAbort=${hookConfig.hookPreAbort}, timeout=${hookConfig.hookTimeout}ms)`,
    );
  }

  recordSecurityAudit(action, container, status, details) {
    this.recordAudit(action, container, status, details);
  }

  isHookFailure(hookResult) {
    return this.hookExecutor.isHookFailure(hookResult);
  }

  getHookFailureDetails(prefix, hookResult, hookTimeout) {
    return this.hookExecutor.getHookFailureDetails(prefix, hookResult, hookTimeout);
  }

  async runPreUpdateHook(container, hookConfig, logContainer) {
    await this.hookExecutor.runPreUpdateHook(container, hookConfig, logContainer);
  }

  async runPostUpdateHook(container, hookConfig, logContainer) {
    await this.hookExecutor.runPostUpdateHook(container, hookConfig, logContainer);
  }

  isSelfUpdate(container) {
    return this.selfUpdateOrchestrator.isSelfUpdate(container);
  }

  async classifySelfUpdate(container) {
    const imageName = container?.image?.name;
    if (imageName !== 'drydock' && !imageName?.endsWith('/drydock')) {
      return this.selfUpdateOrchestrator.classifySelfUpdate(container, undefined, 'peer');
    }
    let candidateWatcher: unknown;
    try {
      candidateWatcher = this.getWatcher(container);
    } catch {
      candidateWatcher = undefined;
    }
    if (!candidateWatcher) {
      return this.selfUpdateOrchestrator.classifySelfUpdate(container, undefined, 'authoritative');
    }
    const candidateRegistryId = container?.agent
      ? `${container.agent}.docker.${container.watcher}`
      : `docker.${container.watcher}`;
    if (!isDirectLocalDockerWatcher(candidateRegistryId, candidateWatcher)) {
      return this.selfUpdateOrchestrator.classifySelfUpdate(container, undefined, 'peer');
    }
    const localRuntime = await this.resolveAuthoritativeLocalDockerRuntime();
    if (!localRuntime) {
      return this.selfUpdateOrchestrator.classifySelfUpdateAsIndeterminate(container);
    }
    const candidateSourceKey = getDockerWatcherSourceKey(candidateWatcher as never);
    if (candidateSourceKey !== localRuntime.sourceKey) {
      return this.selfUpdateOrchestrator.classifySelfUpdate(container, undefined, 'peer');
    }
    return this.selfUpdateOrchestrator.classifySelfUpdateFromIdentity(
      container,
      localRuntime.identity,
    );
  }

  async resolveAuthoritativeLocalDockerRuntime(): Promise<AuthoritativeLocalDockerRuntime | null> {
    const uniqueSources = new Map<string, DirectLocalDockerWatcher>();
    for (const [registryId, watcher] of Object.entries(getState().watcher)) {
      if (!isDirectLocalDockerWatcher(registryId, watcher)) {
        continue;
      }
      uniqueSources.set(getDockerWatcherSourceKey(watcher as never), watcher);
    }
    if (uniqueSources.size !== 1) {
      return null;
    }
    const [sourceKey, watcher] = uniqueSources.entries().next().value as [
      string,
      DirectLocalDockerWatcher,
    ];
    let identity: { id: string; name: string } | null;
    try {
      identity = await this.selfUpdateOrchestrator.resolveSelfContainerIdentity(watcher.dockerApi);
    } catch {
      identity = null;
    }
    if (!identity?.id || !identity.name) {
      return null;
    }
    return { dockerApi: watcher.dockerApi, identity, sourceKey };
  }

  async resolveObserverNetworkMode(): Promise<string> {
    const directLocalWatchers = Object.entries(getState().watcher).filter(([registryId, watcher]) =>
      isDirectLocalDockerWatcher(registryId, watcher),
    );
    if (directLocalWatchers.length === 0) {
      throw new Error('Observed self-update requires an authoritative local Docker watcher');
    }
    const localRuntime = await this.resolveAuthoritativeLocalDockerRuntime();
    if (!localRuntime) {
      throw new Error('Observed self-update could not resolve the local Drydock container');
    }
    return `container:${localRuntime.identity.id}`;
  }

  async resolveObservedHelperRuntime(context, container): Promise<SelfUpdateObservedHelperRuntime> {
    if (normalizeNonEmptyString(container?.agent)) {
      throw new Error('Infrastructure helper updates are unsupported for agent-owned watchers');
    }
    let targetWatcher: unknown;
    try {
      targetWatcher = this.getWatcher(container);
    } catch (error: unknown) {
      throw new Error(`Infrastructure helper watcher is unavailable: ${getErrorMessage(error)}`);
    }
    const targetWatcherRuntime = targetWatcher as DirectLocalDockerWatcher;
    if (normalizeNonEmptyString(targetWatcherRuntime.agent)) {
      throw new Error('Infrastructure helper updates are unsupported for agent-owned watchers');
    }
    if (
      normalizeNonEmptyString(targetWatcherRuntime.configuration?.host) &&
      !this.findDockerSocketBind(context.currentContainerSpec)
    ) {
      throw new Error('Infrastructure helper updates are unsupported for remote Docker watchers');
    }
    const localRuntime = await this.resolveAuthoritativeLocalDockerRuntime();
    if (!localRuntime) {
      throw new Error('Infrastructure helper update requires one direct local Docker watcher');
    }
    const stableDockerApi = localRuntime.dockerApi as SelfUpdateDockerApi;
    if (
      typeof stableDockerApi.createContainer !== 'function' ||
      typeof stableDockerApi.getContainer !== 'function'
    ) {
      throw new Error('Infrastructure helper update requires stable local Docker control');
    }
    const targetId = context.currentContainerSpec?.Id;
    const targetName = context.currentContainerSpec?.Name?.replace(/^\/+/, '');
    let targetInspect: { Id?: unknown; Name?: unknown };
    try {
      const targetHandle = (await Promise.resolve(stableDockerApi.getContainer(targetId))) as {
        inspect?: () => Promise<{ Id?: unknown; Name?: unknown }>;
      };
      if (typeof targetHandle?.inspect !== 'function') {
        throw new Error('stable Docker target handle is not inspectable');
      }
      targetInspect = await targetHandle.inspect();
    } catch (error: unknown) {
      throw new Error(
        `Infrastructure target is not proven on the local Docker daemon: ${getErrorMessage(error)}`,
      );
    }
    const inspectedName =
      typeof targetInspect.Name === 'string' ? targetInspect.Name.replace(/^\/+/, '') : '';
    if (targetInspect.Id !== targetId || inspectedName !== targetName) {
      throw new Error('Infrastructure target identity does not match the local Docker daemon');
    }
    return {
      dockerApi: stableDockerApi,
      networkMode: `container:${localRuntime.identity.id}`,
    };
  }

  isInfrastructureUpdate(container) {
    return this.selfUpdateOrchestrator.isInfrastructureUpdate(container);
  }

  findDockerSocketBind(spec) {
    return this.selfUpdateOrchestrator.findDockerSocketBind(spec);
  }

  getSelfUpdateFinalizeUrl() {
    const serverConfiguration = getServerConfiguration() as {
      port?: unknown;
    };
    if (
      typeof serverConfiguration?.port !== 'number' ||
      !Number.isInteger(serverConfiguration.port) ||
      serverConfiguration.port <= 0
    ) {
      throw new Error(
        `Self-update finalize URL requires a valid server port; got ${String(serverConfiguration?.port)}`,
      );
    }
    const port = serverConfiguration.port;
    // This callback stays on loopback within the local Drydock process boundary.
    // Keep it on plain HTTP so we do not need to weaken TLS verification for a
    // localhost-only helper callback.
    return `http://127.0.0.1:${port}/api/v1/internal/self-update/finalize`;
  }

  getSelfUpdateFinalizeSecret(operationId: string) {
    return getSelfUpdateFinalizeSecretForOperation(operationId);
  }

  async prepareSelfUpdateOperation(context, container, _logContainer, runtimeContext?: unknown) {
    return preparePersistedSelfUpdateOperation({
      container,
      context,
      triggerName: this.getId(),
      runtimeContext,
      isCurrentProcess: this.isSelfUpdate(container),
    });
  }

  async executeSelfUpdate(
    context,
    container,
    logContainer,
    operationId?: string,
    _runtimeContext?: unknown,
  ) {
    return this.selfUpdateOrchestrator.execute(context, container, logContainer, operationId);
  }

  async maybeNotifySelfUpdate(container, logContainer, operationId?: string) {
    await this.selfUpdateOrchestrator.maybeNotify(container, logContainer, operationId);
  }

  async markSelfUpdateOperationFailed(operationId: string, lastError: string): Promise<void> {
    markSelfUpdateOperationFailedFromStore(operationId, lastError);
  }

  async markSelfUpdateOperationSkipped(operationId: string, lastError: string): Promise<void> {
    markSelfUpdateOperationSkippedFromStore(operationId, lastError);
  }

  async finalizeObservedHelperOperation(
    operationId: string,
    status: 'succeeded' | 'rolled-back' | 'failed',
    lastError?: string,
  ): Promise<void> {
    const operation =
      status === 'succeeded'
        ? updateOperationStore.markOperationTerminal(operationId, {
            status: 'succeeded',
            phase: 'succeeded',
          })
        : status === 'rolled-back'
          ? updateOperationStore.markOperationTerminal(operationId, {
              status: 'rolled-back',
              phase: 'rolled-back',
              ...(lastError ? { lastError } : {}),
            })
          : updateOperationStore.markOperationTerminal(operationId, {
              status: 'failed',
              phase: 'failed',
              ...(lastError ? { lastError } : {}),
            });
    if (!operation || operation.status !== status) {
      throw new Error(`Failed to durably finalize observed helper operation ${operationId}`);
    }
    await saveStore();
  }

  async persistSecurityState(container, securityPatch: SecurityStatePatch, logContainer) {
    await this.getSecurityGate().persistSecurityState(container, securityPatch, logContainer);
  }

  async maybeScanAndGateUpdate(context, container, logContainer) {
    await this.getSecurityGate().maybeScanAndGateUpdate(context, container, logContainer);
  }

  async verifySignaturePreUpdate(context, container, logContainer) {
    await this.getSecurityGate().verifySignaturePreUpdate(context, container, logContainer);
  }

  async scanAndGatePostPull(context, container, logContainer, options?) {
    await this.getSecurityGate().scanAndGatePostPull(context, container, logContainer, options);
  }

  /**
   * Resolve the pulled image to an immutable `repo:tag@sha256:...` reference and
   * decide whether the post-pull security gate can run against it. A registry
   * retag between the pull and the replacement would otherwise let a different
   * image be verified, scanned and deployed than the one that was pulled.
   * Returns `skipSecurityGate` only under availability policy `warn`, where the
   * caller records the skip and continues without scanning the mutable tag.
   */
  async bindPulledImageIdentity(
    dockerApi: PulledImageInspectApi,
    imageReference: string,
    container,
    logContainer: { info: (msg: string) => void; warn: (msg: string) => void },
    options?: PulledImageIdentityOptions,
  ): Promise<PulledImageIdentityBinding> {
    const outcome = await this.capturePulledImageIdentity(
      dockerApi,
      imageReference,
      container,
      logContainer,
      options,
    );
    if (outcome.unboundWarn) {
      this.recordUnboundSecurityWarning(container, outcome.reason);
      return { skipSecurityGate: true };
    }
    return outcome.imageIdentity ? { imageIdentity: outcome.imageIdentity } : {};
  }

  protected async capturePulledImageIdentity(
    dockerApi: PulledImageInspectApi,
    imageReference: string,
    container,
    logContainer: { info: (msg: string) => void; warn: (msg: string) => void },
    options?: PulledImageIdentityOptions,
  ): Promise<PulledImageIdentityOutcome> {
    const bindingPolicy = this.getPostPullIdentityBindingPolicy(container);
    if (typeof dockerApi.getImage !== 'function') {
      return this.handleMissingPulledImageIdentity(
        container,
        bindingPolicy,
        'Docker image inspection is unavailable',
      );
    }

    let localImageId: string | undefined;
    try {
      const imageInspect = await dockerApi.getImage(imageReference).inspect();
      const imageId = imageInspect?.Id?.trim();
      localImageId = imageId;
      const imageWithoutDigest = imageReference.split('@', 1)[0];
      const parsedImage = parse(imageWithoutDigest);
      const referenceCandidates = this.getPulledImageRepositoryCandidates(parsedImage);
      const matchingRepoDigests = (imageInspect?.RepoDigests ?? []).filter((repoDigest) => {
        const separatorIndex = repoDigest.indexOf('@');
        if (separatorIndex <= 0 || separatorIndex === repoDigest.length - 1) {
          return false;
        }
        const repo = repoDigest.substring(0, separatorIndex).toLowerCase();
        const digest = repoDigest.substring(separatorIndex + 1);
        return referenceCandidates.includes(repo) && /^sha256:[0-9a-f]+$/i.test(digest);
      });
      const tag = parsedImage.tag?.trim();
      // Which digest breaks a tie is the caller's to say. The update path has
      // the candidate the watcher resolved for this container; a rollback has
      // only what its backup captured, and reading the candidate here anyway
      // would pin the rollback to the manifest it is undoing (DR-64).
      const preferredDigest = options
        ? (options.preferredDigest ?? undefined)
        : container?.result?.digest;
      const matchingRepoDigest = await this.selectPulledRepoDigest(
        matchingRepoDigests,
        container,
        logContainer,
        { reference: imageReference, parsedImage, tag },
        { preferredDigest, callerPinned: Boolean(options) },
      );
      if (imageId && matchingRepoDigest && tag) {
        const separatorIndex = matchingRepoDigest.indexOf('@');
        const repo = matchingRepoDigest.substring(0, separatorIndex);
        const manifestDigest = matchingRepoDigest.substring(separatorIndex + 1);
        const imageIdentity = `${repo}:${tag}@${manifestDigest}`;
        logContainer.info(
          `Pinned pulled image ${imageReference} (local ${imageId}) to ${imageIdentity}`,
        );
        return { imageIdentity, unboundWarn: false };
      }
      if (imageId && matchingRepoDigest && imageReference.includes('@sha256:')) {
        return { imageIdentity: matchingRepoDigest, unboundWarn: false };
      }
    } catch (error: unknown) {
      return this.handleMissingPulledImageIdentity(
        container,
        bindingPolicy,
        getErrorMessage(error),
      );
    }

    return {
      ...this.handleMissingPulledImageIdentity(
        container,
        bindingPolicy,
        'Docker image inspection returned no local ID and matching manifest digest',
      ),
      localImageId,
    };
  }

  /**
   * Disambiguate multiple `RepoDigests` entries that match the pulled image's
   * repository. Docker never drops a stale entry: when a multi-arch index is
   * republished without touching this platform's layers, the local image ID
   * can carry both the old and the new manifest digest for the same repo
   * (`[repo@OLD, repo@NEW]`). Picking the wrong one pins the security gate,
   * cosign verification and the scan to a manifest that was never the one
   * gated for this update, while the operation still reports success.
   *
   * Prefers the digest the pulled reference itself names when it is
   * digest-pinned, then `tieBreak.preferredDigest`, the digest the caller
   * already knows describes this pull: the candidate the watcher resolved
   * during discovery on the update path, the backup record's captured digest
   * on a rollback. Falls back to a registry manifest lookup, which is cheap
   * when the same image was already resolved earlier in the same poll cycle
   * (BaseRegistry caches it).
   *
   * What happens when none of those answers depends on who asked. The update
   * path picks deterministically and logs every candidate, so the ambiguity is
   * visible instead of silently picked. A caller that named the image this
   * pull is for (`tieBreak.callerPinned`, the rollback path) gets nothing: a
   * lexicographic pick between manifests it has already said this pull is not
   * would deploy, gate and report one of them at random, so the image is left
   * unbound and the binding policy refuses or warns instead (DR-64).
   */
  protected async selectPulledRepoDigest(
    candidates: string[],
    container,
    logContainer: { info: (msg: string) => void; warn: (msg: string) => void },
    pulled: PulledImageReference,
    tieBreak: PulledDigestTieBreak,
  ): Promise<string | undefined> {
    if (candidates.length <= 1) {
      return candidates[0];
    }

    const digestOf = (repoDigest: string) => repoDigest.substring(repoDigest.indexOf('@') + 1);

    // A digest-pinned pull already names the manifest the daemon resolved, so
    // the reference outranks anything read off the still-running container.
    // Matching it here also keeps the digest out of the lookup below, which
    // would otherwise have to append it to a reference that already carries one.
    const referenceSeparatorIndex = pulled.reference.indexOf('@');
    if (referenceSeparatorIndex >= 0) {
      const referenceDigest = pulled.reference.substring(referenceSeparatorIndex + 1);
      const pinned = candidates.find((candidate) => digestOf(candidate) === referenceDigest);
      if (pinned) {
        return pinned;
      }
    }

    const { preferredDigest } = tieBreak;
    if (typeof preferredDigest === 'string' && /^sha256:[0-9a-f]+$/i.test(preferredDigest)) {
      const preferred = candidates.find((candidate) => digestOf(candidate) === preferredDigest);
      if (preferred) {
        return preferred;
      }
    }

    try {
      const lookupImage = this.buildPulledManifestLookupImage(container, pulled);
      if (lookupImage) {
        const registry = this.resolveRegistryManager(container, logContainer, {
          allowAnonymousFallback: true,
        });
        if (registry && typeof registry.getImageManifestDigest === 'function') {
          const manifest = await registry.getImageManifestDigest(lookupImage);
          if (typeof manifest?.digest === 'string') {
            const resolved = candidates.find(
              (candidate) => digestOf(candidate) === manifest.digest,
            );
            if (resolved) {
              return resolved;
            }
          }
        }
      }
    } catch {
      // Best-effort disambiguation only. Fall through to the deterministic pick.
    }

    const ambiguity = `Multiple manifest digests match the pulled image repository for ${container?.name}: [${candidates.join(', ')}]`;
    // Nothing here names the manifest that was pulled, and the caller pinned
    // this pull to an image none of these candidates has been shown to be.
    // Deploying whichever one sorts first is a coin flip the rollback contract
    // does not allow, so hand back nothing and let the policy decide (DR-64).
    if (tieBreak.callerPinned) {
      logContainer.warn(
        `${ambiguity}; none of them is the manifest this pull was pinned to, leaving the image unbound`,
      );
      return undefined;
    }
    const sorted = [...candidates].sort();
    const chosen = sorted[0];
    logContainer.warn(`${ambiguity}; picked ${chosen}`);
    return chosen;
  }

  /**
   * Build the image descriptor the fallback manifest lookup queries.
   *
   * `container.image` describes what the container is still *running*, so its
   * tag names a different manifest than the one that was just pulled on any
   * tag update, and on every rollback, where the reference is the backup's
   * older tag. Binding the security gate and the deployment to that manifest
   * gates an image nobody pulled, so repository and tag both come from the
   * pulled reference instead.
   *
   * A Docker reference carries neither the registry's v2 API URL nor its
   * credentials, so those stay on `container.image`, and the repository is
   * only taken from the reference while it sits under that same registry.
   * A repository from anywhere else would be queried against the wrong
   * endpoint with the wrong auth.
   *
   * Returns undefined for a digest-only `repo@sha256:...` pull. The reference
   * has already answered what that manifest is, and quietly querying the
   * container's own tag instead is the mis-binding this exists to prevent.
   */
  protected buildPulledManifestLookupImage(container, pulled: PulledImageReference) {
    if (!pulled.tag) {
      return undefined;
    }
    const containerImage = container.image;
    const repository = [pulled.parsedImage.domain, pulled.parsedImage.path]
      .filter(Boolean)
      .join('/');
    const registryPrefix = `${cleanRegistryUrl(containerImage.registry.url)}/`;
    const name = repository.startsWith(registryPrefix)
      ? repository.substring(registryPrefix.length)
      : containerImage.name;
    return { ...containerImage, name, tag: { ...containerImage.tag, value: pulled.tag } };
  }

  protected getPulledImageRepositoryCandidates(parsedImage: { domain?: string; path?: string }) {
    const path = parsedImage.path?.trim().toLowerCase();
    if (!path) {
      return [];
    }
    const domain = parsedImage.domain?.trim().toLowerCase();
    // `index.docker.io` is the legacy Docker Hub host: the daemon rewrites it to
    // `docker.io` before recording RepoDigests, so a reference pulled under that
    // alias has to be matched against the short Hub forms, not against itself.
    const isDockerHub =
      !domain ||
      domain === 'docker.io' ||
      domain === 'index.docker.io' ||
      domain === 'registry-1.docker.io';
    if (!isDockerHub) {
      return [`${domain}/${path}`];
    }
    const pathWithoutLibrary = path.startsWith('library/')
      ? path.substring('library/'.length)
      : path;
    return [
      path,
      pathWithoutLibrary,
      `docker.io/${path}`,
      `docker.io/${pathWithoutLibrary}`,
      `registry-1.docker.io/${path}`,
      `registry-1.docker.io/${pathWithoutLibrary}`,
    ];
  }

  protected handleMissingPulledImageIdentity(
    container,
    bindingPolicy: 'required' | 'optional' | 'disabled',
    reason: string,
  ): PulledImageIdentityOutcome {
    if (bindingPolicy === 'required') {
      throw new Error(
        `Unable to bind security gate to the pulled image for ${container.name}: ${reason}`,
      );
    }
    if (bindingPolicy === 'optional') {
      this.log.warn(
        `Unable to bind security gate to the pulled image for ${container.name}: ${reason}; proceeding without an immutable image reference`,
      );
      return { unboundWarn: true, reason };
    }
    return { unboundWarn: false };
  }

  protected recordUnboundSecurityWarning(container, reason = 'unknown binding error'): void {
    this.recordSecurityAudit(
      'security-scan-skipped',
      container,
      'error',
      `Security scan skipped because the pulled image could not be bound to an immutable digest; update allowed by DD_SECURITY_AVAILABILITY_POLICY=warn: ${reason}`,
    );
  }

  protected getPostPullIdentityBindingPolicy(container): 'required' | 'optional' | 'disabled' {
    const securityGate = this.getSecurityGate() as {
      securityConfig?: {
        getSecurityConfiguration?: () => {
          enabled?: boolean;
          availabilityPolicy?: string;
          signature?: { verify?: boolean };
          gate?: { mode?: string };
        };
      };
      shouldRunSecurityGate?: (configuration: { enabled?: boolean }) => boolean;
      getEffectiveGateMode?: (
        container: unknown,
        configuration: {
          enabled?: boolean;
          availabilityPolicy?: string;
          signature?: { verify?: boolean };
          gate?: { mode?: string };
        },
      ) => string;
    };
    const securityConfiguration = securityGate.securityConfig?.getSecurityConfiguration?.();
    if (!securityConfiguration || securityConfiguration.enabled !== true) {
      return 'disabled';
    }
    if (
      securityGate.shouldRunSecurityGate &&
      !securityGate.shouldRunSecurityGate(securityConfiguration)
    ) {
      return 'disabled';
    }
    if (securityConfiguration.signature?.verify === true) {
      return 'required';
    }
    if (securityGate.getEffectiveGateMode?.(container, securityConfiguration) === 'off') {
      return 'disabled';
    }
    return securityConfiguration.availabilityPolicy === 'warn' ? 'optional' : 'required';
  }

  /**
   * Public alias of {@link getPostPullIdentityBindingPolicy} for callers
   * outside this class, such as the manual rollback API in
   * `app/util/backup.ts`, which needs the same required/optional/disabled
   * decision to know whether an unresolvable rollback digest should refuse
   * the rollback or fall back to the mutable tag with a warning.
   */
  getRollbackIdentityBindingPolicy(container): 'required' | 'optional' | 'disabled' {
    return this.getPostPullIdentityBindingPolicy(container);
  }

  async createTriggerContext(container, logContainer, _runtimeContext?: unknown) {
    const watcher = this.getWatcher(container);
    const { dockerApi } = watcher;

    logContainer.debug(`Get ${container.image.registry.name} registry manager`);
    const registry = this.resolveRegistryManager(container, logContainer, {
      allowAnonymousFallback: true,
    });

    logContainer.debug(`Get ${container.image.registry.name} registry credentials`);
    const auth = await registry.getAuthPull();

    const newImage = this.getNewImageFullName(registry, container);
    const currentContainer = await this.getCurrentContainer(dockerApi, container);

    if (!currentContainer) {
      logContainer.warn('Unable to update the container because it does not exist');
      return undefined;
    }

    const currentContainerSpec = await this.inspectContainer(currentContainer, logContainer);
    return {
      dockerApi,
      registry,
      auth,
      newImage,
      // Signature verification runs in the post-pull gate so it verifies the
      // immutable reference that was actually pulled, not the mutable tag that
      // a registry retag could repoint between verification and creation.
      deferSignatureVerification: true,
      // Because the gate moved behind the pull, the pre-update hook and the
      // prune/backup step move behind the gate. Otherwise an image the gate is
      // about to reject would already have run an operator hook, deleted cached
      // images and written a rollback row.
      deferPreRuntimeUpdateLifecycle: true,
      currentContainer,
      currentContainerSpec,
    };
  }

  insertContainerImageBackup(context, container) {
    const { registry } = context;
    // Store the Docker-pullable image reference (e.g. "nginx") not the
    // internal registry-prefixed name (e.g. "hub.public/library/nginx").
    // Use a sentinel tag to extract just the base name, since
    // getImageFullName returns "name:tag" and we store tag separately.
    const baseImageName = registry
      .getImageFullName(container.image, '__TAG__')
      .replace(/:__TAG__$/, '');
    backupStore.insertBackup({
      id: crypto.randomUUID(),
      containerId: container.id,
      containerName: container.name,
      containerIdentityKey: container.identityKey ?? deriveContainerIdentityKey(container),
      imageName: baseImageName,
      imageTag: container.image.tag.value,
      imageDigest: container.image.digest?.repo,
      timestamp: new Date().toISOString(),
      triggerName: this.getId(),
    });
  }

  resolveContainerBackupScope(container) {
    return createContainerBackupScope(
      container,
      storeContainer.getContainers({ name: container.name }) ?? [],
    );
  }

  async runPreRuntimeUpdateLifecycle(context, container, logContainer, _runtimeContext?: unknown) {
    const { dockerApi, registry } = context;

    if (this.configuration.prune) {
      await this.pruneImages(dockerApi, registry, container, logContainer);
    }

    this.insertContainerImageBackup(context, container);
  }

  async executeContainerUpdate(
    context,
    container,
    logContainer,
    runtimeContext?: unknown,
    postPullHook?: (
      operationId: string,
      imageIdentity?: string,
      options?: PostPullHookOptions,
    ) => Promise<void>,
  ) {
    if (runtimeContext === undefined) {
      return this.containerUpdateExecutor.execute(
        context,
        container,
        logContainer,
        undefined,
        postPullHook,
      );
    }
    return this.containerUpdateExecutor.execute(
      context,
      container,
      logContainer,
      runtimeContext,
      postPullHook,
    );
  }

  /**
   * Perform the container update (pull, stop, recreate).
   * Subclasses (e.g. Dockercompose) override this to use their own runtime
   * mechanics while reusing the shared lifecycle orchestrator.
   */
  async performContainerUpdate(
    context,
    container,
    logContainer,
    runtimeContext?: unknown,
    postPullHook?: (
      operationId: string,
      imageIdentity?: string,
      options?: PostPullHookOptions,
    ) => Promise<void>,
  ) {
    const updated =
      runtimeContext === undefined
        ? await this.executeContainerUpdate(
            context,
            container,
            logContainer,
            undefined,
            postPullHook,
          )
        : await this.executeContainerUpdate(
            context,
            container,
            logContainer,
            runtimeContext,
            postPullHook,
          );
    /* v8 ignore next -- V8 mis-maps an import destructuring branch to this line */
    if (updated && container.updateKind?.kind === 'tag') {
      await syncComposeFileTag({
        dockerApi: context.dockerApi,
        labels: context.currentContainerSpec?.Config?.Labels,
        newImage: context.newImage,
        logContainer,
      });
    }
    return updated;
  }

  getRollbackConfig(container) {
    return this.rollbackMonitor.getConfig(container);
  }

  async maybeStartAutoRollbackMonitor(dockerApi, container, rollbackConfig, logContainer) {
    return this.rollbackMonitor.start(dockerApi, container, rollbackConfig, logContainer);
  }

  /**
   * Lock keys serialising the update lifecycle for this container.
   * Subclasses extend this to add coarser-grained keys (e.g. compose project)
   * when their update touches shared state beyond the single container.
   */
  getUpdateLockKeys(container: { name: string; watcher: string }): string[] {
    return [buildContainerLockKey(container)];
  }

  /**
   * Shared per-container update lifecycle. Handles security scanning, hooks,
   * prune/backup preparation, backup pruning, rollback monitoring, and events.
   * Delegates the actual runtime update to `performContainerUpdate()` which
   * subclasses can override.
   */
  async runContainerUpdateLifecycle(
    container,
    runtimeContext?: unknown,
    options?: {
      lifecycleAlreadyAcquired?: boolean;
      selfUpdateClassification?: SelfUpdateClassification;
      onSelfUpdateOperationId?: (operationId: string, updated: boolean) => void;
    },
  ) {
    const selfUpdateClassification =
      options?.selfUpdateClassification ?? (await this.classifySelfUpdate(container));
    if (selfUpdateClassification === 'indeterminate') {
      this.selfUpdateOrchestrator.clearSelfUpdateClassification(container);
      throw new Error('Drydock container identity is indeterminate; refusing unsafe update');
    }
    const selfUpdate = selfUpdateClassification === 'current';
    const exclusiveUpdate = selfUpdate || this.isInfrastructureUpdate(container);
    let exclusiveUpdateOperationId: string | undefined;
    const lifecycle = withContainerUpdateLocks(
      this.getUpdateLockKeys(container),
      async () => {
        const requestedOperationId = getRequestedOperationId(container, runtimeContext);
        try {
          const lifecycleResult: unknown = await this.updateLifecycleExecutor.run(
            container,
            runtimeContext,
          );
          let result: unknown = lifecycleResult;
          if (isSelfUpdateLifecycleResult(lifecycleResult)) {
            exclusiveUpdateOperationId = lifecycleResult.operationId;
            options?.onSelfUpdateOperationId?.(exclusiveUpdateOperationId, lifecycleResult.updated);
            result = lifecycleResult.updated;
          }
          if (result !== false && requestedOperationId) {
            const operation = updateOperationStore.getOperationById(requestedOperationId);
            if (
              operation &&
              operation.kind !== 'self-update' &&
              (operation.status === 'queued' || operation.status === 'in-progress')
            ) {
              updateOperationStore.markOperationTerminal(operation.id, {
                status: 'succeeded',
                phase: 'succeeded',
              });
            }
          }
          return result;
        } catch (error: unknown) {
          if (selfUpdate && error instanceof RetainSelfUpdateLifecycleError) {
            exclusiveUpdateOperationId = error.operationId;
            options?.onSelfUpdateOperationId?.(error.operationId, true);
          }
          const operation = requestedOperationId
            ? updateOperationStore.getOperationById(requestedOperationId)
            : undefined;

          if (!operation) {
            throw error;
          }

          if (operation.kind === 'self-update') {
            // Self-update terminalization is owned by the helper finalize callback.
            // If the outgoing process dies before that callback runs, startup
            // reconciliation will fail the orphaned active row on the next boot.
            throw error;
          }

          if (operation.phase === 'rollback-deferred') {
            // rollback-deferred is terminalized by the deferred reconciliation callback in the
            // normal case; if the process dies before that callback runs, startup reconciliation
            // will fail the orphaned active row on the next boot.
            throw error;
          }

          if (operation.status !== 'queued' && operation.status !== 'in-progress') {
            // Already terminalized by an inner handler or prior recovery path. The outer wrapper
            // must not rewrite completedAt/error fields by terminalizing the row a second time.
            throw error;
          }

          // Issue #410 Part C / #421 (outer catch): if the error looks like a
          // benign duplicate-update vanish (Docker 404, HTTP 409, compose "no
          // longer exists") AND either a recent succeeded op exists for the same
          // container name, OR another active operation is still in flight for
          // the same container and identity (issue #421 race), reclassify to
          // `expired` (silent) instead of `failed` (emits update-failed
          // notification).
          const composeRollbackPatch = getComposeRollbackTerminalPatch(error);
          if (composeRollbackPatch) {
            updateOperationStore.markOperationTerminal(operation.id, composeRollbackPatch);
            if (composeRollbackPatch.status === 'rolled-back') {
              const rollbackContainerId = getRollbackStateContainerId(operation, container);
              if (rollbackContainerId) {
                this.containerUpdateExecutor.persistRollbackState?.(
                  rollbackContainerId,
                  'rolled-back',
                  {
                    reason: composeRollbackPatch.rollbackReason ?? '',
                    lastError: composeRollbackPatch.lastError,
                  },
                );
              }
            }
          } else if (
            classifyDuplicateOpTerminalStatus(
              error,
              operation.containerName,
              undefined,
              getOperationIdentityFilter(operation),
              operation.id,
            ) === 'expired'
          ) {
            updateOperationStore.markOperationTerminal(operation.id, {
              status: 'expired',
              phase: 'expired',
              lastError: getErrorMessage(error),
            });
          } else {
            updateOperationStore.markOperationTerminal(operation.id, {
              status: 'failed',
              phase: 'failed',
              lastError: getErrorMessage(error),
            });
          }

          throw error;
        }
      },
      {
        bypassGlobalCap: exclusiveUpdate,
        exclusive: exclusiveUpdate,
        skipLifecycleGate: options?.lifecycleAlreadyAcquired === true,
        skipUpdateLocks: options?.lifecycleAlreadyAcquired === true,
        retainExclusiveOnResult: (result) =>
          selfUpdate && result === true && exclusiveUpdateOperationId
            ? { operationId: exclusiveUpdateOperationId }
            : undefined,
        retainExclusiveOnError: (error) =>
          error instanceof RetainSelfUpdateLifecycleError
            ? { operationId: error.operationId }
            : undefined,
      },
    );
    try {
      return await lifecycle;
    } finally {
      this.selfUpdateOrchestrator.clearSelfUpdateClassification(container);
    }
  }

  /**
   * Update the container.
   * @param container the container
   * @returns {Promise<void>}
   */
  async trigger(container, runtimeContext?: unknown) {
    await this.runContainerUpdateLifecycle(container, runtimeContext);
  }

  /**
   * Update the containers.
   * @param containers
   * @returns {Promise<unknown[]>}
   */
  async triggerBatch(containers, runtimeContext?: unknown): Promise<unknown[]> {
    const limit = pLimit(TRIGGER_BATCH_CONCURRENCY);
    return Promise.all(
      containers.map((container) =>
        limit(() =>
          runtimeContext === undefined
            ? this.trigger(container)
            : this.trigger(container, runtimeContext),
        ),
      ),
    );
  }
}

export default Docker;
