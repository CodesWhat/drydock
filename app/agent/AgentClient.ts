import fs from 'node:fs';
import https from 'node:https';
import { StringDecoder } from 'node:string_decoder';
import axios, { type AxiosRequestConfig } from 'axios';
import type { Logger } from 'pino';
import type {
  BatchUpdateCompletedEventPayload,
  ContainerUpdateAppliedEventPayload,
  ContainerUpdateFailedEventPayload,
  SecurityAlertEventPayload,
  SecurityAlertSummary,
  SecurityScanCycleCompleteEventPayload,
} from '../event/index.js';
import {
  emitAgentConnected,
  emitAgentDisconnected,
  emitAgentStatsChanged,
  emitBatchUpdateCompleted,
  emitContainerReport,
  emitContainerReports,
  emitContainerUpdateApplied,
  emitContainerUpdateFailed,
  emitSecurityAlert,
  emitSecurityScanCycleComplete,
} from '../event/index.js';
import logger from '../log/index.js';
import { sanitizeLogParam } from '../log/sanitize.js';
import {
  type Container,
  type ContainerReport,
  clearDetectedUpdateState,
} from '../model/container.js';
import {
  type ActiveContainerUpdateOperationStatus,
  type ContainerUpdateOperationPhase,
  type ContainerUpdateOperationStatus,
  isActiveContainerUpdateOperationStatus,
  isContainerUpdateOperationPhase,
  isContainerUpdateOperationStatus,
  isTerminalContainerUpdateOperationStatus,
  type TerminalContainerUpdateOperationStatus,
} from '../model/container-update-operation.js';
import * as registry from '../registry/index.js';
import { resolveConfiguredPath } from '../runtime/paths.js';
import * as storeContainer from '../store/container.js';
import * as updateOperationStore from '../store/update-operation.js';
import { getRequestedOperationId } from '../triggers/providers/docker/update-runtime-context.js';
import { getErrorMessage } from '../util/error.js';
import { uuidv7 } from '../util/uuid.js';

export interface AgentClientConfig {
  host: string;
  port: number;
  secret: string;
  cafile?: string;
  certfile?: string;
  keyfile?: string;
}

interface AgentClientRuntimeInfo {
  version?: string;
  os?: string;
  arch?: string;
  cpus?: number;
  memoryGb?: number;
  uptimeSeconds?: number;
  lastSeen?: string;
  logLevel?: string;
  pollInterval?: string;
}

interface AgentComponentDescriptor {
  id?: string;
  type: string;
  name: string;
  configuration: Record<string, unknown>;
  agent?: string;
  metadata?: Record<string, unknown>;
}

interface AgentRuntimeAckPayload {
  version?: unknown;
  os?: unknown;
  arch?: unknown;
  cpus?: unknown;
  memoryGb?: unknown;
  uptimeSeconds?: unknown;
  lastSeen?: unknown;
  logLevel?: unknown;
  pollInterval?: unknown;
}

interface AgentSsePayload {
  type?: unknown;
  data?: unknown;
}

interface WatcherSnapshotPayload {
  watcher?: {
    type?: unknown;
    name?: unknown;
    configuration?: unknown;
    metadata?: unknown;
  };
  containers?: unknown;
}

export interface WatcherSnapshotCacheEntry {
  type: string;
  name: string;
  configuration?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

interface RemoteTriggerErrorPayload {
  error?: unknown;
  details?: unknown;
}

interface AgentUpdateOperationChangedPayload {
  operationId: string;
  containerName: string;
  status: ContainerUpdateOperationStatus;
  containerId?: string;
  newContainerId?: string;
  phase?: ContainerUpdateOperationPhase;
  container?: Record<string, unknown>;
}

const SECURITY_ALERT_SUMMARY_KEYS = ['unknown', 'low', 'medium', 'high', 'critical'] as const;

const INITIAL_SSE_RECONNECT_DELAY_MS = 1_000;
const MAX_SSE_RECONNECT_DELAY_MS = 60_000;
// Coalesce rapid container-event SSE broadcasts into a single emission so that
// a burst (e.g. initial agent connect, mass container restart) does not produce
// one broadcast per container.
const AGENT_STATS_CHANGED_DEBOUNCE_MS = 250;
// An SSE stream must stay open at least this long before it counts as a
// healthy connection that resets the reconnect backoff. Resetting the backoff
// on response-received alone lets a stream that returns HTTP 200 then ends
// immediately defeat the backoff, producing a flat 1s reconnect loop (#362).
const SSE_STABLE_CONNECTION_MS = 30_000;
const REMOTE_UPDATE_TRIGGER_TYPES = new Set(['docker', 'dockercompose']);

function watcherSnapshotCacheKey(watcherType: string, watcherName: string): string {
  return `${watcherType}.${watcherName}`;
}

function toOptionalRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function toNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function toOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isContainerUpdateAppliedEventPayload(
  data: unknown,
): data is ContainerUpdateAppliedEventPayload {
  if (!data || typeof data !== 'object') {
    return false;
  }

  const containerName = (data as { containerName?: unknown }).containerName;
  return typeof containerName === 'string' && containerName.length > 0;
}

export class AgentClient {
  public name: string;
  public config: AgentClientConfig;
  private readonly log: Logger;
  private readonly baseUrl: string;
  private readonly axiosOptions: AxiosRequestConfig;
  public isConnected: boolean;
  public info: AgentClientRuntimeInfo;
  private reconnectTimer: NodeJS.Timeout | null;
  private reconnectAttempts: number;
  private stableConnectionTimer: NodeJS.Timeout | null;
  private hasConnectedOnce: boolean;
  private readonly pendingFreshStateAfterRemoteUpdate: Set<string>;
  private readonly pendingWatcherCycleReports: Map<string, Map<string, ContainerReport>>;
  private readonly watcherSnapshotCache: Map<string, WatcherSnapshotCacheEntry>;
  private statsChangedTimer: ReturnType<typeof setTimeout> | undefined;
  private handshakeInProgress: Promise<void> | null = null;

  constructor(name: string, config: AgentClientConfig) {
    this.name = name;
    this.config = config;
    this.log = logger.child({ component: `agent-client.${name}` });
    const parsedBaseUrl = this.parseBaseUrl();
    this.baseUrl = parsedBaseUrl.origin;
    this.rejectSecretConfiguredOverHttp(parsedBaseUrl.protocol);
    this.axiosOptions = this.buildAxiosOptions();

    this.isConnected = false;
    this.info = {};
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    this.stableConnectionTimer = null;
    this.hasConnectedOnce = false;
    this.pendingFreshStateAfterRemoteUpdate = new Set();
    this.pendingWatcherCycleReports = new Map();
    this.watcherSnapshotCache = new Map();
    this.statsChangedTimer = undefined;
  }

  getWatcherSnapshot(
    watcherType: string,
    watcherName: string,
  ): WatcherSnapshotCacheEntry | undefined {
    return this.watcherSnapshotCache.get(watcherSnapshotCacheKey(watcherType, watcherName));
  }

  private parseBaseUrl(): URL {
    // Validate the URL to prevent request forgery (CodeQL js/request-forgery)
    const parsed = new URL(this.getCandidateUrl());
    this.validateProtocol(parsed.protocol);
    return parsed;
  }

  private getCandidateUrl(): string {
    const port = this.config.port || 3000;
    const candidateUrl = `${this.config.host}:${port}`;
    // Add protocol if not present
    if (candidateUrl.startsWith('http')) {
      return candidateUrl;
    }
    const useHttps = this.shouldUseHttps(port);
    return `http${useHttps ? 's' : ''}://${candidateUrl}`;
  }

  private shouldUseHttps(port: number): boolean {
    return Boolean(this.config.certfile) || Boolean(this.config.cafile) || port === 443;
  }

  private validateProtocol(protocol: string) {
    if (!['http:', 'https:'].includes(protocol)) {
      throw new Error(`Invalid agent URL protocol: ${protocol}`);
    }
  }

  private rejectSecretConfiguredOverHttp(protocol: string) {
    const hasSecretConfigured =
      typeof this.config.secret === 'string' && this.config.secret.trim().length > 0;
    if (protocol !== 'http:' || !hasSecretConfigured) return;
    const message = `Agent ${this.name} is configured with a secret over insecure HTTP (${this.baseUrl}). Configure HTTPS (certfile/cafile) to protect X-Dd-Agent-Secret.`;
    if (process.env.DD_AGENT_ALLOW_INSECURE_SECRET === 'true') {
      this.log.warn(message);
      return;
    }
    throw new Error(message);
  }

  private buildAxiosOptions(): AxiosRequestConfig {
    const options: AxiosRequestConfig = {
      headers: {
        'X-Dd-Agent-Secret': this.config.secret,
      },
    };

    if (this.shouldBuildHttpsAgent()) {
      options.httpsAgent = this.buildHttpsAgent();
    }

    return options;
  }

  private shouldBuildHttpsAgent(): boolean {
    return Boolean(this.config.certfile) || Boolean(this.config.cafile);
  }

  private buildHttpsAgent(): https.Agent {
    const caPath = this.resolveTlsPath(this.config.cafile, `${this.name} ca file`);
    const certPath = this.resolveTlsPath(this.config.certfile, `${this.name} cert file`);
    const keyPath = this.resolveTlsPath(this.config.keyfile, `${this.name} key file`);

    // Intentional: custom CA / mTLS for agent communication
    // lgtm[js/disabling-certificate-validation]
    return new https.Agent({
      ca: caPath ? fs.readFileSync(caPath) : undefined,
      cert: certPath ? fs.readFileSync(certPath) : undefined,
      key: keyPath ? fs.readFileSync(keyPath) : undefined,
    });
  }

  private resolveTlsPath(path: string | undefined, label: string): string | undefined {
    return path ? resolveConfiguredPath(path, { label }) : undefined;
  }

  async init() {
    this.log.info(`Connecting to agent ${this.name} at ${this.baseUrl}`);
    this.startSse();
  }

  private pruneOldContainers(newContainers: Container[], watcher?: string) {
    const query: Record<string, unknown> = { agent: this.name };
    if (watcher) {
      query.watcher = watcher;
    }
    const containersInStore = storeContainer.getContainers(query);
    const newContainerIds = new Set(newContainers.map((container) => container.id));

    const containersToRemove = containersInStore.filter(
      (containerInStore) => !newContainerIds.has(containerInStore.id),
    );

    containersToRemove.forEach((c) => {
      this.log.info(`Pruning container ${c.name} (removed on Agent)`);
      this.pendingFreshStateAfterRemoteUpdate.delete(c.id);
      storeContainer.deleteContainer(c.id);
    });
  }

  private markPendingFreshState(containerId: unknown) {
    if (typeof containerId === 'string' && containerId.length > 0) {
      this.pendingFreshStateAfterRemoteUpdate.add(containerId);
    }
  }

  private clearPendingFreshState(containerId: unknown) {
    if (typeof containerId === 'string' && containerId.length > 0) {
      this.pendingFreshStateAfterRemoteUpdate.delete(containerId);
    }
  }

  private getPendingWatcherCycleContainerKey(
    container: Pick<Container, 'id' | 'name' | 'watcher'> | undefined,
  ): string | undefined {
    if (!container || typeof container !== 'object') {
      return undefined;
    }
    if (typeof container.id === 'string' && container.id.length > 0) {
      return container.id;
    }
    if (
      typeof container.watcher === 'string' &&
      container.watcher.length > 0 &&
      typeof container.name === 'string' &&
      container.name.length > 0
    ) {
      return `${container.watcher}:${container.name}`;
    }
    return undefined;
  }

  private rememberPendingWatcherCycleReport(containerReport: ContainerReport) {
    if (!containerReport || !containerReport.container) {
      return;
    }

    const watcherName = containerReport.container?.watcher;
    if (typeof watcherName !== 'string' || watcherName.length === 0) {
      return;
    }

    const containerKey = this.getPendingWatcherCycleContainerKey(containerReport.container);
    if (!containerKey) {
      return;
    }

    const reportsForWatcher = this.pendingWatcherCycleReports.get(watcherName) ?? new Map();
    reportsForWatcher.set(containerKey, containerReport);
    this.pendingWatcherCycleReports.set(watcherName, reportsForWatcher);
  }

  private takePendingWatcherCycleReport(
    watcherName: string | undefined,
    container: Pick<Container, 'id' | 'name' | 'watcher'>,
  ): ContainerReport | undefined {
    if (typeof watcherName !== 'string' || watcherName.length === 0) {
      return undefined;
    }

    const reportsForWatcher = this.pendingWatcherCycleReports.get(watcherName);
    if (!reportsForWatcher) {
      return undefined;
    }

    const containerKey = this.getPendingWatcherCycleContainerKey(container);
    if (!containerKey) {
      return undefined;
    }

    const pendingReport = reportsForWatcher.get(containerKey);
    if (!pendingReport) {
      return undefined;
    }

    reportsForWatcher.delete(containerKey);
    if (reportsForWatcher.size === 0) {
      this.pendingWatcherCycleReports.delete(watcherName);
    }
    return pendingReport;
  }

  private clearPendingWatcherCycleReports(watcherName: string | undefined) {
    if (typeof watcherName === 'string' && watcherName.length > 0) {
      this.pendingWatcherCycleReports.delete(watcherName);
    }
  }

  private clearPendingWatcherCycleReportByContainerId(containerId: unknown) {
    if (typeof containerId !== 'string' || containerId.length === 0) {
      return;
    }

    for (const [watcherName, reportsForWatcher] of this.pendingWatcherCycleReports.entries()) {
      reportsForWatcher.delete(containerId);
      if (reportsForWatcher.size === 0) {
        this.pendingWatcherCycleReports.delete(watcherName);
      }
    }
  }

  private shouldPreserveClearedUpdateAvailable(container: Container): boolean {
    return (
      this.pendingFreshStateAfterRemoteUpdate.has(container.id) &&
      container.updateAvailable === true
    );
  }

  private buildContainerReport(container: Container, changedOverride?: boolean): ContainerReport {
    container.agent = this.name;
    // The container coming from Agent should already be normalized and have results
    // We rely on the Agent to perform Registry checks if configured

    // Strip redaction metadata (e.g. `sensitive`) that the agent's event
    // emitter may attach — the controller's Joi schema does not allow it.
    if (container.details?.env && Array.isArray(container.details.env)) {
      container.details.env = container.details.env.map(({ key, value }) => ({ key, value }));
    }

    if (this.shouldPreserveClearedUpdateAvailable(container)) {
      container = clearDetectedUpdateState(container);
    } else if (container.updateAvailable === false) {
      this.clearPendingFreshState(container.id);
    }

    // Save to store logic with Change Detection
    const existing = storeContainer.getContainer(container.id);
    const containerReport = {
      container: container,
      changed: false,
    };

    if (existing) {
      containerReport.container = storeContainer.updateContainer(container);
      // existing is the old state (from store), container is new state (from Agent)
      // But storeContainer.updateContainer returns the NEW state object with validation/methods
      // We use existing.resultChanged() to compare with the new state
      if (existing.resultChanged) {
        containerReport.changed =
          existing.resultChanged(containerReport.container) &&
          containerReport.container.updateAvailable;
      }
    } else {
      containerReport.container = storeContainer.insertContainer(container);
      containerReport.changed = true;
    }

    if (typeof changedOverride === 'boolean') {
      containerReport.changed = changedOverride;
    }

    return containerReport;
  }

  private async processAuthoritativeContainer(container: Container): Promise<ContainerReport> {
    this.clearPendingFreshState(container.id);
    return this.processContainer(container);
  }

  private async processAuthoritativeContainers(
    containers: Container[],
  ): Promise<ContainerReport[]> {
    const containerReports: ContainerReport[] = [];
    for (const container of containers) {
      containerReports.push(await this.processAuthoritativeContainer(container));
    }
    await emitContainerReports(containerReports);
    return containerReports;
  }

  private async registerAgentComponents(
    kind: 'watcher' | 'trigger',
    remoteComponents: AgentComponentDescriptor[],
  ) {
    for (const remoteComponent of remoteComponents) {
      this.log.debug(`Registering agent ${kind} ${remoteComponent.type}.${remoteComponent.name}`);
      await registry.registerComponent({
        kind,
        provider: remoteComponent.type,
        name: remoteComponent.name,
        configuration: remoteComponent.configuration,
        componentPath: 'agent/components',
        agent: this.name,
      });
    }
  }

  async handshake() {
    if (this.handshakeInProgress) {
      return this.handshakeInProgress;
    }
    this.handshakeInProgress = this._doHandshake().finally(() => {
      this.handshakeInProgress = null;
    });
    return this.handshakeInProgress;
  }

  private async _doHandshake() {
    const wasConnected = this.isConnected;
    const reconnected = this.hasConnectedOnce;
    const response = await axios.get<Container[]>(
      `${this.baseUrl}/api/containers`,
      this.axiosOptions,
    );
    const containers = response.data;
    this.log.info(`Handshake successful. Received ${containers.length} containers.`);

    await this.processAuthoritativeContainers(containers);
    // A zero-container handshake is ambiguous: it could mean the agent has
    // no running containers, or its in-memory store is fresh-empty after a
    // restart while docker still has running containers. Defer the prune
    // until the first authoritative watcher snapshot arrives — that path is
    // unambiguous because the snapshot is only emitted after a successful
    // enumeration with no enrichment errors (#362, #386 / d02080ae).
    // Pruning here would wipe last-known state for an agent that's about to
    // re-populate it in seconds via its first watch cycle.
    if (containers.length > 0) {
      this.pruneOldContainers(containers);
    } else if (this.hasConnectedOnce) {
      this.log.warn(
        'Handshake returned 0 containers; preserving last-known state until the first watch cycle completes',
      );
    }

    // Unregister existing components for this agent
    await registry.deregisterAgentComponents(this.name);

    // Fetch and register watchers
    try {
      const responseWatchers = await axios.get<AgentComponentDescriptor[]>(
        `${this.baseUrl}/api/watchers`,
        this.axiosOptions,
      );
      await this.registerAgentComponents('watcher', responseWatchers.data);
      this.seedWatcherSnapshotCacheFromHandshake(responseWatchers.data);
    } catch (error: unknown) {
      this.log.warn(`Failed to fetch/register watchers: ${getErrorMessage(error)}`);
    }

    // Fetch and register triggers
    try {
      const responseTriggers = await axios.get<AgentComponentDescriptor[]>(
        `${this.baseUrl}/api/triggers`,
        this.axiosOptions,
      );
      await this.registerAgentComponents('trigger', responseTriggers.data);
    } catch (error: unknown) {
      this.log.warn(`Failed to fetch/register triggers: ${getErrorMessage(error)}`);
    }

    this.isConnected = true;
    this.hasConnectedOnce = true;
    if (!wasConnected) {
      void emitAgentConnected({
        agentName: this.name,
        reconnected,
      }).catch((error: unknown) => {
        this.log.debug(`Failed to emit agent connected event (${getErrorMessage(error)})`);
      });
    }
  }

  async processContainer(container: Container): Promise<ContainerReport> {
    const containerReport = this.buildContainerReport(container);

    // Emit report so Triggers can fire if changed
    await emitContainerReport(containerReport);
    return containerReport;
  }

  private clearStableConnectionTimer() {
    if (this.stableConnectionTimer) {
      clearTimeout(this.stableConnectionTimer);
      this.stableConnectionTimer = null;
    }
  }

  stop() {
    this.clearStableConnectionTimer();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    clearTimeout(this.statsChangedTimer);
    this.statsChangedTimer = undefined;
  }

  private scheduleStatsChanged(): void {
    if (this.statsChangedTimer !== undefined) {
      // A pending emit already covers this change; skip scheduling a duplicate.
      return;
    }
    const timer = setTimeout(() => {
      this.statsChangedTimer = undefined;
      void emitAgentStatsChanged({ agentName: this.name }).catch((error: unknown) => {
        this.log.debug(`Failed to emit agent stats changed event (${getErrorMessage(error)})`);
      });
    }, AGENT_STATS_CHANGED_DEBOUNCE_MS);
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
    this.statsChangedTimer = timer;
  }

  private getNextReconnectDelayMs(): number {
    const nextDelay = Math.min(
      INITIAL_SSE_RECONNECT_DELAY_MS * 2 ** this.reconnectAttempts,
      MAX_SSE_RECONNECT_DELAY_MS,
    );
    this.reconnectAttempts += 1;
    return nextDelay;
  }

  scheduleReconnect(delay?: number) {
    this.clearStableConnectionTimer();
    if (this.reconnectTimer) {
      return;
    }
    const reconnectDelay = delay ?? this.getNextReconnectDelayMs();
    const wasConnected = this.isConnected;
    this.isConnected = false;
    if (wasConnected) {
      void emitAgentDisconnected({
        agentName: this.name,
        reason: 'SSE connection lost',
      }).catch((error: unknown) => {
        this.log.debug(`Failed to emit agent disconnected event (${getErrorMessage(error)})`);
      });
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.startSse();
    }, reconnectDelay);
  }

  private async parseSseLine(line: string) {
    if (!line.startsWith('data: ')) {
      return;
    }
    try {
      const payload = JSON.parse(line.substring(6)) as AgentSsePayload;
      if (payload.type && payload.data) {
        try {
          await this.handleEvent(payload.type as string, payload.data);
        } catch (error: unknown) {
          this.log.error(
            `Error handling SSE event ${sanitizeLogParam(String(payload.type))} (${getErrorMessage(error)})`,
          );
        }
      }
    } catch (error: unknown) {
      this.log.warn(`Error parsing SSE data: ${getErrorMessage(error)}`);
    }
  }

  private async processSseBuffer(buffer: string): Promise<string> {
    const messages = buffer.split('\n\n');
    // The last element is either empty (if buffer ended with \n\n) or incomplete
    const remainder = messages.pop() || '';

    for (const message of messages) {
      for (const line of message.split('\n')) {
        await this.parseSseLine(line);
      }
    }
    return remainder;
  }

  private attachStreamHandlers(stream: NodeJS.EventEmitter) {
    const decoder = new StringDecoder('utf8');
    let buffer = '';
    let sseProcessing = Promise.resolve();

    stream.on('data', (chunk: Buffer) => {
      const decodedChunk = decoder.write(chunk);
      if (!decodedChunk) {
        return;
      }

      sseProcessing = sseProcessing
        .then(async () => {
          buffer += decodedChunk;
          buffer = await this.processSseBuffer(buffer);
        })
        .catch((error: unknown) => {
          this.log.error(`SSE data processing failed: ${getErrorMessage(error)}`);
        });
    });
    stream.on('error', (e: Error) => {
      this.log.error(`SSE Connection failed: ${e.message}`);
      this.scheduleReconnect();
    });
    stream.on('end', () => {
      this.log.warn('SSE stream ended. Reconnecting...');
      this.scheduleReconnect();
    });
  }

  startSse() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    axios({
      method: 'get',
      url: `${this.baseUrl}/api/events`,
      responseType: 'stream',
      ...this.axiosOptions,
    })
      .then((response) => {
        // Reset the backoff only after the stream stays open long enough to be
        // considered healthy. A stream that returns 200 then ends immediately
        // must not reset the backoff, or reconnects loop at a flat 1s (#362).
        this.stableConnectionTimer = setTimeout(() => {
          this.stableConnectionTimer = null;
          this.reconnectAttempts = 0;
        }, SSE_STABLE_CONNECTION_MS);
        this.attachStreamHandlers(response.data);
      })
      .catch((error: unknown) => {
        this.log.error(`SSE Connection failed: ${getErrorMessage(error)}. Retrying...`);
        this.scheduleReconnect();
      });
  }

  private buildRuntimeInfoFromAck(data: unknown): AgentClientRuntimeInfo {
    const runtimeData = data as AgentRuntimeAckPayload;
    return {
      ...this.info,
      version: typeof runtimeData?.version === 'string' ? runtimeData.version : this.info.version,
      os: typeof runtimeData?.os === 'string' ? runtimeData.os : this.info.os,
      arch: typeof runtimeData?.arch === 'string' ? runtimeData.arch : this.info.arch,
      cpus: Number.isFinite(runtimeData?.cpus) ? Number(runtimeData.cpus) : this.info.cpus,
      memoryGb: Number.isFinite(runtimeData?.memoryGb)
        ? Number(runtimeData.memoryGb)
        : this.info.memoryGb,
      uptimeSeconds: Number.isFinite(runtimeData?.uptimeSeconds)
        ? Number(runtimeData.uptimeSeconds)
        : this.info.uptimeSeconds,
      lastSeen:
        typeof runtimeData?.lastSeen === 'string' && runtimeData.lastSeen
          ? runtimeData.lastSeen
          : new Date().toISOString(),
      logLevel:
        typeof runtimeData?.logLevel === 'string' && runtimeData.logLevel
          ? runtimeData.logLevel
          : this.info.logLevel,
      pollInterval:
        typeof runtimeData?.pollInterval === 'string' && runtimeData.pollInterval
          ? runtimeData.pollInterval
          : this.info.pollInterval,
    };
  }

  private handleAckEvent(data: unknown) {
    this.info = this.buildRuntimeInfoFromAck(data);
    const ackData = data as AgentRuntimeAckPayload;
    this.log.info(`Agent ${this.name} connected (version: ${ackData.version})`);
    void this.handshake().catch((error: unknown) => {
      this.log.error(`Handshake failed after dd:ack: ${getErrorMessage(error)}`);
    });
  }

  private async handleContainerChangeEvent(data: unknown) {
    const containerReport = await this.processContainer(data as Container);
    this.rememberPendingWatcherCycleReport(containerReport);
    this.scheduleStatsChanged();
  }

  private handleContainerRemovedEvent(data: unknown) {
    const removedContainerData = data as { id: string };
    this.clearPendingFreshState(removedContainerData.id);
    this.clearPendingWatcherCycleReportByContainerId(removedContainerData.id);
    storeContainer.deleteContainer(removedContainerData.id);
    this.scheduleStatsChanged();
  }

  private async handleWatcherSnapshotEvent(data: unknown) {
    const snapshotPayload = data as WatcherSnapshotPayload;
    const watcherType =
      typeof snapshotPayload?.watcher?.type === 'string' ? snapshotPayload.watcher.type : undefined;
    const watcherName =
      typeof snapshotPayload?.watcher?.name === 'string' ? snapshotPayload.watcher.name : undefined;
    const containers = Array.isArray(snapshotPayload?.containers)
      ? (snapshotPayload.containers as Container[])
      : [];

    if (watcherType && watcherName) {
      this.updateWatcherSnapshotCache({
        type: watcherType,
        name: watcherName,
        configuration: toOptionalRecord(snapshotPayload.watcher?.configuration),
        metadata: toOptionalRecord(snapshotPayload.watcher?.metadata),
      });
    }

    const containerReports: ContainerReport[] = [];
    for (const container of containers) {
      const pendingContainerReport = this.takePendingWatcherCycleReport(watcherName, container);
      if (pendingContainerReport) {
        this.clearPendingFreshState(container.id);
        containerReports.push(this.buildContainerReport(container, pendingContainerReport.changed));
        continue;
      }
      containerReports.push(await this.processAuthoritativeContainer(container));
    }
    this.clearPendingWatcherCycleReports(watcherName);
    await emitContainerReports(containerReports);

    if (watcherName) {
      this.pruneOldContainers(containers, watcherName);
    }

    this.scheduleStatsChanged();
  }

  private seedWatcherSnapshotCacheFromHandshake(descriptors: AgentComponentDescriptor[]): void {
    for (const descriptor of descriptors) {
      if (
        !descriptor ||
        typeof descriptor.type !== 'string' ||
        typeof descriptor.name !== 'string'
      ) {
        continue;
      }
      this.updateWatcherSnapshotCache({
        type: descriptor.type,
        name: descriptor.name,
        configuration: toOptionalRecord(descriptor.configuration),
        metadata: toOptionalRecord(descriptor.metadata),
      });
    }
  }

  private updateWatcherSnapshotCache(entry: WatcherSnapshotCacheEntry): void {
    const key = watcherSnapshotCacheKey(entry.type, entry.name);
    const existing = this.watcherSnapshotCache.get(key);
    this.watcherSnapshotCache.set(key, {
      type: entry.type,
      name: entry.name,
      configuration: entry.configuration ?? existing?.configuration,
      metadata: entry.metadata ?? existing?.metadata,
    });
  }

  private parseUpdateFailedEventPayload(
    data: unknown,
  ): ContainerUpdateFailedEventPayload | undefined {
    if (!data || typeof data !== 'object') {
      return undefined;
    }

    const payload = data as Record<string, unknown>;
    if (
      typeof payload.containerName !== 'string' ||
      payload.containerName.length === 0 ||
      typeof payload.error !== 'string' ||
      payload.error.length === 0
    ) {
      return undefined;
    }

    const remoteOperationId = toNonEmptyString(payload.operationId);
    const phase = toOptionalString(payload.phase);
    const batchId = toNonEmptyString(payload.batchId);
    return {
      containerName: payload.containerName,
      error: payload.error,
      ...(remoteOperationId
        ? {
            // Do NOT pre-scope here — let maybeMarkAgentOperationFailedFromFailedPayload
            // call resolveAgentOperationId so the controller-issued row is used when
            // the agent echoes back the controller's operationId (fixes #289).
            operationId: remoteOperationId,
            batchId: batchId ? this.toAgentScopedId(batchId) : undefined,
          }
        : {}),
      ...(toOptionalString(payload.containerId) !== undefined
        ? { containerId: toOptionalString(payload.containerId) }
        : {}),
      ...(phase !== undefined ? { phase } : {}),
      // Forward the container snapshot so notification triggers on the controller
      // can render messages even when the controller's container store hasn't caught
      // up after a recreate (closes the same race as #385 for multi-agent deployments).
      ...(payload.container && typeof payload.container === 'object'
        ? {
            container: {
              ...(payload.container as Container),
              agent: this.name,
            },
          }
        : {}),
    };
  }

  private toAgentScopedId(remoteId: string): string {
    const trimmed = remoteId.trim();
    const prefix = `agent-${this.name}-`;
    return trimmed.startsWith(prefix) ? trimmed : `${prefix}${trimmed}`;
  }

  /**
   * Resolve the operation id to use when processing a lifecycle event from
   * the agent.
   *
   * If the controller already has an operation row keyed by the raw (unscoped)
   * id — meaning the agent echoed back a controller-issued operationId — use
   * that id directly so the existing row is updated in place.  Otherwise fall
   * back to the agent-scoped form for backwards compatibility with older agents
   * that do not echo controller ids.  (Fixes #289.)
   */
  private resolveAgentOperationId(rawOperationId: string): string {
    const existing = updateOperationStore.getOperationById(rawOperationId);
    if (existing) {
      return rawOperationId;
    }
    return this.toAgentScopedId(rawOperationId);
  }

  private parseAgentUpdateOperationChangedPayload(
    data: unknown,
  ): AgentUpdateOperationChangedPayload | undefined {
    if (!data || typeof data !== 'object') {
      return undefined;
    }

    const payload = data as Record<string, unknown>;
    const operationId = toNonEmptyString(payload.operationId);
    const containerName = toNonEmptyString(payload.containerName);
    if (!operationId || !containerName || !isContainerUpdateOperationStatus(payload.status)) {
      return undefined;
    }

    return {
      operationId,
      containerName,
      status: payload.status,
      ...(toOptionalString(payload.containerId) !== undefined
        ? { containerId: toOptionalString(payload.containerId) }
        : {}),
      ...(toOptionalString(payload.newContainerId) !== undefined
        ? { newContainerId: toOptionalString(payload.newContainerId) }
        : {}),
      ...(isContainerUpdateOperationPhase(payload.phase) ? { phase: payload.phase } : {}),
      /* v8 ignore next 3 -- container object payloads are optional agent event metadata. */
      ...(toOptionalRecord(payload.container) !== undefined
        ? { container: { ...toOptionalRecord(payload.container), agent: this.name } }
        : {}),
    };
  }

  private getStoredContainerForAgentOperation(payload: {
    containerName: string;
    containerId?: string;
    newContainerId?: string;
  }): Container | undefined {
    const candidateContainerIds = [payload.containerId, payload.newContainerId].filter(
      (containerId): containerId is string =>
        typeof containerId === 'string' && containerId.length > 0,
    );

    for (const containerId of candidateContainerIds) {
      const containerById = storeContainer.getContainer(containerId);
      if (
        containerById &&
        containerById.name === payload.containerName &&
        containerById.agent === this.name
      ) {
        return containerById;
      }
    }

    const matchingContainers = storeContainer
      .getContainers({ agent: this.name })
      .filter(
        (container): container is Container =>
          Boolean(container) &&
          container.name === payload.containerName &&
          container.agent === this.name,
      );

    return matchingContainers.length === 1 ? matchingContainers[0] : undefined;
  }

  private buildAgentOperationBase(payload: {
    operationId: string;
    containerName: string;
    containerId?: string;
    newContainerId?: string;
    container?: Record<string, unknown>;
  }) {
    const storedContainer = payload.container
      ? undefined
      : this.getStoredContainerForAgentOperation(payload);
    const containerSnapshot = payload.container ?? storedContainer;
    const watcher =
      containerSnapshot && typeof containerSnapshot.watcher === 'string'
        ? containerSnapshot.watcher
        : undefined;

    return {
      id: this.resolveAgentOperationId(payload.operationId),
      kind: 'container-update' as const,
      containerName: payload.containerName,
      agent: this.name,
      ...(watcher !== undefined ? { watcher } : {}),
      ...(payload.containerId !== undefined ? { containerId: payload.containerId } : {}),
      ...(payload.newContainerId !== undefined ? { newContainerId: payload.newContainerId } : {}),
      ...(containerSnapshot !== undefined ? { container: containerSnapshot } : {}),
    };
  }

  private ensureAgentOperationForTerminal(payload: {
    operationId: string;
    containerName: string;
    containerId?: string;
    newContainerId?: string;
    container?: Record<string, unknown>;
  }): string {
    const operationId = this.resolveAgentOperationId(payload.operationId);
    const existing = updateOperationStore.getOperationById(operationId);
    if (!existing) {
      updateOperationStore.insertOperation({
        ...this.buildAgentOperationBase(payload),
        status: 'in-progress',
        phase: 'prepare',
      });
    } else if (
      payload.container !== undefined &&
      !existing.container &&
      isActiveContainerUpdateOperationStatus(existing.status)
    ) {
      updateOperationStore.updateOperation(operationId, { container: payload.container as never });
    }
    return operationId;
  }

  private applyAgentUpdateOperationChanged(payload: AgentUpdateOperationChangedPayload): void {
    const operationId = this.resolveAgentOperationId(payload.operationId);
    const existing = updateOperationStore.getOperationById(operationId);
    const base = this.buildAgentOperationBase(payload);

    if (isActiveContainerUpdateOperationStatus(payload.status)) {
      if (existing) {
        if (isActiveContainerUpdateOperationStatus(existing.status)) {
          updateOperationStore.updateOperation(operationId, {
            containerName: payload.containerName,
            agent: base.agent,
            /* v8 ignore next -- watcher is optional when an agent event lacks container metadata. */
            ...(base.watcher !== undefined ? { watcher: base.watcher } : {}),
            ...(payload.containerId !== undefined ? { containerId: payload.containerId } : {}),
            ...(payload.newContainerId !== undefined
              ? { newContainerId: payload.newContainerId }
              : {}),
            /* v8 ignore next 3 -- existing rows keep their persisted container snapshot. */
            ...(base.container !== undefined && !existing.container
              ? { container: base.container as never }
              : {}),
            status: payload.status as ActiveContainerUpdateOperationStatus,
            ...(payload.phase ? { phase: payload.phase as never } : {}),
          });
        }
        return;
      }
      updateOperationStore.insertOperation({
        ...base,
        status: payload.status,
        ...(payload.phase ? { phase: payload.phase } : {}),
      });
      return;
    }

    if (isTerminalContainerUpdateOperationStatus(payload.status)) {
      this.markAgentOperationTerminal({
        ...payload,
        status: payload.status,
      });
    }
  }

  private markAgentOperationTerminal(payload: {
    operationId: string;
    containerName: string;
    status: TerminalContainerUpdateOperationStatus;
    containerId?: string;
    newContainerId?: string;
    phase?: ContainerUpdateOperationPhase;
    lastError?: string;
    container?: Record<string, unknown>;
  }): void {
    const operationId = this.ensureAgentOperationForTerminal(payload);
    const existing = updateOperationStore.getOperationById(operationId);
    if (existing && isTerminalContainerUpdateOperationStatus(existing.status)) {
      return;
    }
    updateOperationStore.markOperationTerminal(operationId, {
      status: payload.status,
      containerName: payload.containerName,
      ...(payload.containerId !== undefined ? { containerId: payload.containerId } : {}),
      ...(payload.newContainerId !== undefined ? { newContainerId: payload.newContainerId } : {}),
      ...(payload.phase ? { phase: payload.phase as never } : {}),
      ...(payload.lastError ? { lastError: payload.lastError } : {}),
      ...(payload.container !== undefined ? { container: payload.container as never } : {}),
    });
  }

  private maybeMarkAgentOperationSucceededFromAppliedPayload(
    payload: ContainerUpdateAppliedEventPayload,
  ): string | undefined {
    const remoteOperationId = toNonEmptyString(payload.operationId);
    if (!remoteOperationId) {
      return undefined;
    }
    const container = toOptionalRecord(payload.container);
    const containerId = toOptionalString(container?.id);
    const agentContainer =
      payload.container && typeof payload.container === 'object'
        ? { ...payload.container, agent: this.name }
        : undefined;
    this.markAgentOperationTerminal({
      operationId: remoteOperationId,
      containerName: payload.containerName,
      status: 'succeeded',
      ...(containerId !== undefined ? { containerId } : {}),
      phase: 'succeeded',
      ...(agentContainer !== undefined ? { container: agentContainer } : {}),
    });
    return this.resolveAgentOperationId(remoteOperationId);
  }

  private maybeMarkAgentOperationFailedFromFailedPayload(
    payload: ContainerUpdateFailedEventPayload,
  ): boolean {
    const remoteOperationId = toNonEmptyString(payload.operationId);
    if (!remoteOperationId) {
      return false;
    }
    const agentContainer =
      payload.container && typeof payload.container === 'object'
        ? { ...payload.container, agent: this.name }
        : undefined;
    this.markAgentOperationTerminal({
      operationId: remoteOperationId,
      containerName: payload.containerName,
      status: 'failed',
      ...(payload.containerId !== undefined ? { containerId: payload.containerId } : {}),
      ...(isContainerUpdateOperationPhase(payload.phase) ? { phase: payload.phase } : {}),
      lastError: payload.error,
      ...(agentContainer !== undefined ? { container: agentContainer } : {}),
    });
    return true;
  }

  private parseBatchUpdateCompletedPayload(
    data: unknown,
  ): BatchUpdateCompletedEventPayload | undefined {
    if (!data || typeof data !== 'object') {
      return undefined;
    }

    const payload = data as Record<string, unknown>;
    const batchId = toNonEmptyString(payload.batchId);
    const hasNumericFields =
      Number.isFinite(payload.total) &&
      Number.isFinite(payload.succeeded) &&
      Number.isFinite(payload.failed) &&
      Number.isFinite(payload.durationMs);
    if (!batchId || !hasNumericFields || !Array.isArray(payload.items)) {
      return undefined;
    }

    const items: BatchUpdateCompletedEventPayload['items'] = [];
    for (const item of payload.items) {
      if (!item || typeof item !== 'object') {
        return undefined;
      }
      const itemPayload = item as Record<string, unknown>;
      const operationId = toNonEmptyString(itemPayload.operationId);
      const containerName = toNonEmptyString(itemPayload.containerName);
      if (
        !operationId ||
        !containerName ||
        (itemPayload.status !== 'succeeded' && itemPayload.status !== 'failed')
      ) {
        return undefined;
      }
      items.push({
        operationId: this.resolveAgentOperationId(operationId),
        containerId: toOptionalString(itemPayload.containerId) ?? '',
        containerName,
        status: itemPayload.status,
      });
    }

    return {
      batchId: this.toAgentScopedId(batchId),
      total: Number(payload.total),
      succeeded: Number(payload.succeeded),
      failed: Number(payload.failed),
      durationMs: Number(payload.durationMs),
      items,
      timestamp: toNonEmptyString(payload.timestamp) ?? new Date().toISOString(),
    };
  }

  private parseSecurityAlertSummary(data: unknown): SecurityAlertSummary | undefined {
    if (!data || typeof data !== 'object') {
      return undefined;
    }

    const summary = data as Record<string, unknown>;
    const parsedSummary = {} as SecurityAlertSummary;
    for (const key of SECURITY_ALERT_SUMMARY_KEYS) {
      if (!Number.isFinite(summary[key])) {
        return undefined;
      }
      parsedSummary[key] = Number(summary[key]);
    }
    return parsedSummary;
  }

  private parseSecurityAlertEventPayload(data: unknown): SecurityAlertEventPayload | undefined {
    if (!data || typeof data !== 'object') {
      return undefined;
    }

    const payload = data as Record<string, unknown>;
    if (
      typeof payload.containerName !== 'string' ||
      payload.containerName.length === 0 ||
      typeof payload.details !== 'string' ||
      payload.details.length === 0
    ) {
      return undefined;
    }

    const parsedPayload: SecurityAlertEventPayload = {
      containerName: payload.containerName,
      details: payload.details,
    };
    if (typeof payload.status === 'string' && payload.status.length > 0) {
      parsedPayload.status = payload.status;
    }
    if (Number.isFinite(payload.blockingCount)) {
      parsedPayload.blockingCount = Number(payload.blockingCount);
    }
    const summary = this.parseSecurityAlertSummary(payload.summary);
    if (summary) {
      parsedPayload.summary = summary;
    }
    if (typeof payload.cycleId === 'string' && payload.cycleId.length > 0) {
      parsedPayload.cycleId = payload.cycleId;
    }
    return parsedPayload;
  }

  private parseSecurityScanCycleCompleteEventPayload(
    data: unknown,
  ): SecurityScanCycleCompleteEventPayload | undefined {
    if (!data || typeof data !== 'object') {
      return undefined;
    }
    const payload = data as Record<string, unknown>;
    if (
      typeof payload.cycleId !== 'string' ||
      payload.cycleId.length === 0 ||
      !Number.isFinite(payload.scannedCount)
    ) {
      return undefined;
    }
    const parsed: SecurityScanCycleCompleteEventPayload = {
      cycleId: payload.cycleId,
      scannedCount: Number(payload.scannedCount),
    };
    if (Number.isFinite(payload.alertCount)) {
      parsed.alertCount = Number(payload.alertCount);
    }
    if (typeof payload.startedAt === 'string' && payload.startedAt.length > 0) {
      parsed.startedAt = payload.startedAt;
    }
    if (typeof payload.completedAt === 'string' && payload.completedAt.length > 0) {
      parsed.completedAt = payload.completedAt;
    }
    parsed.scope = 'agent-forwarded';
    return parsed;
  }

  async handleEvent(eventName: string, data: unknown) {
    switch (eventName) {
      case 'dd:ack':
        this.handleAckEvent(data);
        return;
      case 'dd:container-added':
      case 'dd:container-updated':
        await this.handleContainerChangeEvent(data);
        return;
      case 'dd:container-removed':
        this.handleContainerRemovedEvent(data);
        return;
      case 'dd:watcher-snapshot':
        await this.handleWatcherSnapshotEvent(data);
        return;
      case 'dd:update-applied':
        if (typeof data === 'string' && data.length > 0) {
          await emitContainerUpdateApplied(data);
        } else if (isContainerUpdateAppliedEventPayload(data)) {
          const operationId = this.maybeMarkAgentOperationSucceededFromAppliedPayload(data);
          if (operationId) {
            return;
          }
          const batchId = toNonEmptyString(data.batchId);
          await emitContainerUpdateApplied({
            ...(batchId ? { batchId: this.toAgentScopedId(batchId) } : {}),
            containerName: data.containerName,
            container:
              data.container && typeof data.container === 'object'
                ? {
                    ...data.container,
                    agent: this.name,
                  }
                : undefined,
          });
        }
        return;
      case 'dd:update-failed': {
        const payload = this.parseUpdateFailedEventPayload(data);
        if (payload) {
          const terminalized = this.maybeMarkAgentOperationFailedFromFailedPayload(payload);
          if (!terminalized) {
            await emitContainerUpdateFailed(payload);
          }
        }
        return;
      }
      case 'dd:update-operation-changed': {
        const payload = this.parseAgentUpdateOperationChangedPayload(data);
        if (payload) {
          this.applyAgentUpdateOperationChanged(payload);
        }
        return;
      }
      case 'dd:batch-update-completed': {
        const payload = this.parseBatchUpdateCompletedPayload(data);
        if (payload) {
          await emitBatchUpdateCompleted(payload);
        }
        return;
      }
      case 'dd:security-alert': {
        const payload = this.parseSecurityAlertEventPayload(data);
        if (payload) {
          if (payload.cycleId) {
            await emitSecurityAlert(payload);
          } else {
            const cycleId = uuidv7();
            const nowIso = new Date().toISOString();
            await emitSecurityAlert({ ...payload, cycleId });
            await emitSecurityScanCycleComplete({
              cycleId,
              scannedCount: 1,
              alertCount: 1,
              scope: 'agent-forwarded',
              startedAt: nowIso,
              completedAt: nowIso,
            });
          }
        }
        return;
      }
      case 'dd:security-scan-cycle-complete': {
        const payload = this.parseSecurityScanCycleCompleteEventPayload(data);
        if (payload) {
          await emitSecurityScanCycleComplete(payload);
        }
        return;
      }
      default:
        return;
    }
  }

  private getRemoteTriggerFailureMessage(error: unknown): string | undefined {
    if (!error || typeof error !== 'object') {
      return undefined;
    }
    const response = (error as { response?: unknown }).response;
    if (!response || typeof response !== 'object') {
      return undefined;
    }
    const data = (response as { data?: unknown }).data;
    if (!data || typeof data !== 'object') {
      return undefined;
    }

    const payload = data as RemoteTriggerErrorPayload;
    const errorMessage = typeof payload.error === 'string' ? payload.error : undefined;
    if (!errorMessage) {
      return undefined;
    }

    const details = payload.details;
    const reason =
      details &&
      typeof details === 'object' &&
      typeof (details as { reason?: unknown }).reason === 'string'
        ? (details as { reason: string }).reason
        : undefined;
    return reason ? `${errorMessage} (reason: ${reason})` : errorMessage;
  }

  async runRemoteTrigger(
    container: Container,
    triggerType: string,
    triggerName: string,
    runtimeContext?: unknown,
  ) {
    try {
      // For update-trigger types (docker, dockercompose), the agent's handler
      // only dereferences container.id (to look up its own stored container)
      // and container.name (for the rollback-container guard). Sending the
      // full Container object here has bloated past the agent's 256kb json
      // body limit for common :latest containers with release notes + env +
      // labels, causing HTTP 413. Post a minimal payload for update triggers;
      // notification triggers still need the full container for template
      // rendering. See #298.
      //
      // Thread the controller's operationId so the agent can reuse the
      // existing row rather than creating a new one (fixes #289).
      let payload: Record<string, unknown> | Container;
      if (REMOTE_UPDATE_TRIGGER_TYPES.has(triggerType)) {
        const operationId = getRequestedOperationId(container, runtimeContext);
        payload = {
          id: container.id,
          name: container.name,
          ...(operationId !== undefined ? { operationId } : {}),
        };
      } else {
        payload = container;
      }
      this.log.debug(
        `Running remote trigger ${sanitizeLogParam(triggerType)}.${sanitizeLogParam(triggerName)} (payload=${sanitizeLogParam(JSON.stringify(payload), 500)})`,
      );
      await axios.post(
        `${this.baseUrl}/api/triggers/${encodeURIComponent(triggerType)}/${encodeURIComponent(triggerName)}`,
        payload,
        this.axiosOptions,
      );
      if (REMOTE_UPDATE_TRIGGER_TYPES.has(triggerType)) {
        this.markPendingFreshState(container.id);
      }
    } catch (error: unknown) {
      const detailedMessage = this.getRemoteTriggerFailureMessage(error);
      const errorMessage = detailedMessage ?? getErrorMessage(error);
      this.log.error(`Error running remote trigger: ${sanitizeLogParam(errorMessage)}`);
      throw error;
    }
  }

  async runRemoteTriggerBatch(
    containers: Container[],
    triggerType: string,
    triggerName: string,
    runtimeContext?: unknown,
  ) {
    try {
      // For update-trigger types, attach per-container operationIds so the agent
      // can reuse controller-issued rows rather than minting new ones (#289).
      let body: unknown;
      if (REMOTE_UPDATE_TRIGGER_TYPES.has(triggerType) && runtimeContext !== undefined) {
        body = containers.map((container) => {
          const operationId = getRequestedOperationId(container, runtimeContext);
          return operationId !== undefined ? { ...container, operationId } : container;
        });
      } else {
        body = containers;
      }
      await axios.post(
        `${this.baseUrl}/api/triggers/${encodeURIComponent(triggerType)}/${encodeURIComponent(triggerName)}/batch`,
        body,
        this.axiosOptions,
      );
      if (REMOTE_UPDATE_TRIGGER_TYPES.has(triggerType)) {
        containers.forEach(({ id }) => this.markPendingFreshState(id));
      }
    } catch (error: unknown) {
      const detailedMessage = this.getRemoteTriggerFailureMessage(error);
      const errorMessage = detailedMessage ?? getErrorMessage(error);
      this.log.error(`Error running remote batch trigger: ${sanitizeLogParam(errorMessage)}`);
      throw error;
    }
  }

  async getLogEntries(
    options: { level?: string; component?: string; tail?: number; since?: number } = {},
  ) {
    try {
      const params = new URLSearchParams();
      if (options.level) params.set('level', options.level);
      if (options.component) params.set('component', options.component);
      if (options.tail) params.set('tail', String(options.tail));
      if (options.since) params.set('since', String(options.since));
      const query = params.toString();
      const logEntriesUrl = `${this.baseUrl}/api/log/entries`;
      const requestUrl = query ? `${logEntriesUrl}?${query}` : logEntriesUrl;
      const response = await axios.get(requestUrl, this.axiosOptions);
      return response.data;
    } catch (error: unknown) {
      this.log.error(`Error fetching log entries from agent: ${getErrorMessage(error)}`);
      throw error;
    }
  }

  async getContainerLogs(
    containerId: string,
    options: { tail: number; since: number; timestamps: boolean },
  ) {
    try {
      const response = await axios.get(
        `${this.baseUrl}/api/containers/${encodeURIComponent(containerId)}/logs?tail=${options.tail}&since=${options.since}&timestamps=${options.timestamps}`,
        this.axiosOptions,
      );
      return response.data;
    } catch (error: unknown) {
      this.log.error(`Error fetching container logs from agent: ${getErrorMessage(error)}`);
      throw error;
    }
  }

  async deleteContainer(containerId: string) {
    try {
      this.log.debug(`Deleting container ${sanitizeLogParam(containerId)} on agent`);
      await axios.delete(
        `${this.baseUrl}/api/containers/${encodeURIComponent(containerId)}`,
        this.axiosOptions,
      );
    } catch (error: unknown) {
      this.log.error(`Error deleting container on agent: ${getErrorMessage(error)}`);
      throw error;
    }
  }

  async getWatcher(watcherType: string, watcherName: string) {
    try {
      const response = await axios.get<AgentComponentDescriptor>(
        `${this.baseUrl}/api/watchers/${encodeURIComponent(watcherType)}/${encodeURIComponent(watcherName)}`,
        this.axiosOptions,
      );
      return response.data;
    } catch (error: unknown) {
      this.log.error(
        `Error fetching watcher on agent: ${sanitizeLogParam(getErrorMessage(error))}`,
      );
      throw error;
    }
  }

  async watch(watcherType: string, watcherName: string) {
    try {
      const response = await axios.post<ContainerReport[]>(
        `${this.baseUrl}/api/watchers/${encodeURIComponent(watcherType)}/${encodeURIComponent(watcherName)}`,
        {},
        this.axiosOptions,
      );
      const reports = response.data;
      await this.processAuthoritativeContainers(reports.map((report) => report.container));
      const containers = reports.map((report) => report.container);
      this.pruneOldContainers(containers, watcherName);
      this.scheduleStatsChanged();
      return reports;
    } catch (error: unknown) {
      this.log.error(`Error watching on agent: ${sanitizeLogParam(getErrorMessage(error))}`);
      throw error;
    }
  }

  async watchContainer(watcherType: string, watcherName: string, container: Container) {
    try {
      const response = await axios.post<ContainerReport>(
        `${this.baseUrl}/api/watchers/${encodeURIComponent(watcherType)}/${encodeURIComponent(watcherName)}/container/${encodeURIComponent(container.id)}`,
        {},
        this.axiosOptions,
      );
      const report = response.data;

      // Process the result (registry check, store update)
      await this.processAuthoritativeContainer(report.container);
      this.scheduleStatsChanged();
      return report;
    } catch (error: unknown) {
      this.log.error(
        `Error watching container ${container.name} on agent: ${getErrorMessage(error)}`,
      );
      throw error;
    }
  }
}
