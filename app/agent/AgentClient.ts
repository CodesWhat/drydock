import type { KeyObject } from 'node:crypto';
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
import { maybeEmitMaturityGateCleared } from '../maturity/gate-watch.js';
import {
  type Container,
  type ContainerReport,
  clearDetectedUpdateState,
  deriveContainerIdentityKey,
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
import { applyUpdatePolicyOverrides, getUpdatePolicyOverrides } from '../model/update-policy.js';
import * as registry from '../registry/index.js';
import { resolveConfiguredPath } from '../runtime/paths.js';
import { createConfiguredSbomStorage } from '../security/configured-sbom-storage.js';
import { offloadSbomDocuments } from '../security/sbom-migration.js';
import type { SbomStorage } from '../security/sbom-storage.js';
import * as storeContainer from '../store/container.js';
import * as updateOperationStore from '../store/update-operation.js';
import { getRequestedOperationId } from '../triggers/providers/docker/update-runtime-context.js';
import { getErrorMessage } from '../util/error.js';
import { uuidv7 } from '../util/uuid.js';
import { findControllerLocalWatcherClaimingContainerId } from '../watchers/controller-local-container-ids.js';
import { normalizeContainer } from '../watchers/providers/docker/image-comparison.js';
import { ddRegistryLookupImage, ddRegistryLookupUrl } from '../watchers/providers/docker/label.js';
import type { AgentAuthMode } from './components/Agent.js';
import { usesControllerDockerTransport } from './controller-docker-transport.js';
import type { EdgeAgentAdapter } from './EdgeAgentAdapter.js';
import { loadEd25519PrivateKey, signRequest } from './ed25519-signer.js';

let controllerSbomStorage: SbomStorage | undefined;

function getControllerSbomStorage(): SbomStorage {
  if (!controllerSbomStorage) {
    controllerSbomStorage = createConfiguredSbomStorage();
  }
  return controllerSbomStorage;
}

export interface AgentClientConfig {
  host: string;
  port: number;
  // Required when authmode is 'token' (the default).
  secret: string;
  cafile?: string;
  certfile?: string;
  keyfile?: string;
  // Selects how requests to this agent are authenticated. Defaults to 'token'
  // (X-Dd-Agent-Secret header, unchanged). 'ed25519' signs each request with
  // the five X-Portwing-* headers per Portwing's verifier instead — see
  // app/agent/ed25519-signer.ts and app/agent/components/Agent.ts.
  authmode?: AgentAuthMode;
  // Required when authmode is 'ed25519'.
  signingkeyid?: string;
  // Required when authmode is 'ed25519': PEM-encoded PKCS#8 Ed25519 private key.
  signingkey?: string;
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
  cpuUsage?: number;
  cpuCores?: number;
  memoryUsed?: number;
  memoryFree?: number;
  diskTotal?: number;
  diskUsed?: number;
  diskFree?: number;
  networkRxBytes?: number;
  networkTxBytes?: number;
}

export interface DockerApiProxyResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: Buffer;
}

const MAX_DOCKER_PROXY_RESPONSE_BYTES = 100 * 1024 * 1024;
const PORTWING_DOCKER_PROXY_INACTIVITY_TIMEOUT_MS = 30_000;
const AGENT_REQUEST_TIMEOUT_MS = 30_000;
const SYNCHRONOUS_REMOTE_TRIGGER_TIMEOUT_MS = 65_000;
const MAX_AGENT_JSON_BYTES = 16 * 1024 * 1024;
const MAX_SSE_EVENT_BUFFER_BYTES = 16 * 1024 * 1024;

function isStreamingDockerTarget(target: string): boolean {
  const path = target.split('?', 1)[0];
  return (
    ['/logs', '/attach', '/events', '/build', '/images/create', '/images/push'].some((suffix) =>
      path.endsWith(suffix),
    ) ||
    (path.includes('/exec/') && path.endsWith('/start'))
  );
}

function normalizeDockerProxyBody(body: unknown): Buffer {
  if (body === undefined || body === null) {
    return Buffer.alloc(0);
  }
  if (Buffer.isBuffer(body)) {
    return body;
  }
  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }
  if (typeof body === 'string') {
    return Buffer.from(body);
  }
  return Buffer.from(JSON.stringify(body));
}

// Decodes a Docker API proxy response body from an edge agent response frame.
// When the edge-response-body-b64 capability was negotiated for the
// connection, the agent carries the raw response bytes as standard base64 in
// `bodyBase64` (e.g. so a non-JSON body like the literal "OK" from /_ping
// survives the tunnel). If `bodyBase64` is absent, this falls through to the
// existing legacy `body` handling unchanged — a bare string there still means
// literal UTF-8 bytes, exactly as before.
function decodeDockerProxyResponseBody(record: Record<string, unknown>): Buffer {
  if (typeof record.bodyBase64 === 'string') {
    return Buffer.from(record.bodyBase64, 'base64');
  }
  return normalizeDockerProxyBody(record.body);
}

function normalizeDockerProxyHeaders(headers: unknown): Record<string, string> {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
    return {};
  }
  const normalized: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === 'string') {
      normalized[name] = value;
    } else if (Array.isArray(value)) {
      normalized[name] = value.map(String).join(', ');
    } else if (value !== undefined && value !== null) {
      normalized[name] = String(value);
    }
  }
  return normalized;
}

interface AgentComponentDescriptor {
  id?: string;
  type: string;
  name: string;
  configuration: Record<string, unknown>;
  agent?: string;
  metadata?: Record<string, unknown>;
}

function isControllerDockerTransportWatcher(descriptor: AgentComponentDescriptor): boolean {
  return usesControllerDockerTransport(descriptor.type, descriptor.configuration);
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
  triggerName?: string;
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
  // Parsed once at construction when authmode is 'ed25519'; undefined in token mode.
  private readonly ed25519PrivateKey?: KeyObject;
  public isConnected: boolean;
  /**
   * True only while this agent's components are being replaced — the span
   * inside `_doHandshake()` (and the equivalent edge-path
   * `handleComponentSync()`) between deregistering and finishing the
   * re-registration (watchers, then triggers).
   * Eligibility display surfaces (container list, SSE enrichment)
   * read this to soften `agent-mismatch` / `no-update-trigger-configured` to a
   * soft blocker during that transient window — see issue #605. Always reset
   * in a `finally` so a handshake failure, or a disconnect via
   * `scheduleReconnect()`, reverts to the hard-blocker default. Admission
   * (`app/updates/request-update.ts`) never reads this field and stays
   * fail-closed throughout.
   */
  public isRegisteringComponents: boolean;
  public info: AgentClientRuntimeInfo;
  private reconnectTimer: NodeJS.Timeout | null;
  private reconnectAttempts: number;
  private stableConnectionTimer: NodeJS.Timeout | null;
  private activeSseStream: (NodeJS.EventEmitter & { destroy?: () => void }) | undefined;
  private stopped: boolean;
  private hasConnectedOnce: boolean;
  private readonly pendingFreshStateAfterRemoteUpdate: Set<string>;
  private readonly pendingWatcherCycleReports: Map<string, Map<string, ContainerReport>>;
  private readonly watcherSnapshotCache: Map<string, WatcherSnapshotCacheEntry>;
  private readonly controllerDockerTransportWatchers: Set<string>;
  private statsChangedTimer: ReturnType<typeof setTimeout> | undefined;
  private handshakeInProgress: Promise<void> | null = null;
  /**
   * Set by portwing-ws.ts immediately after EdgeAgentAdapter.activate() for
   * edge-mode connections. When present, container-op methods that have a
   * WS-tunnel equivalent delegate to it instead of making an axios call
   * against the (nonexistent) edge-agent-placeholder host.
   */
  public edgeAdapter?: EdgeAgentAdapter;

  constructor(name: string, config: AgentClientConfig) {
    this.name = name;
    this.config = config;
    this.log = logger.child({ component: `agent-client.${name}` });
    const parsedBaseUrl = this.parseBaseUrl();
    this.baseUrl = parsedBaseUrl.origin;
    this.rejectSecretConfiguredOverHttp(parsedBaseUrl.protocol);
    this.axiosOptions = this.buildAxiosOptions();
    if (this.config.authmode === 'ed25519') {
      this.ed25519PrivateKey = this.loadSigningKey();
    }

    this.isConnected = false;
    this.isRegisteringComponents = false;
    this.info = {};
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    this.stableConnectionTimer = null;
    this.activeSseStream = undefined;
    this.stopped = false;
    this.hasConnectedOnce = false;
    this.pendingFreshStateAfterRemoteUpdate = new Set();
    this.pendingWatcherCycleReports = new Map();
    this.watcherSnapshotCache = new Map();
    this.controllerDockerTransportWatchers = new Set();
    this.statsChangedTimer = undefined;
  }

  getWatcherSnapshot(
    watcherType: string,
    watcherName: string,
  ): WatcherSnapshotCacheEntry | undefined {
    return this.watcherSnapshotCache.get(watcherSnapshotCacheKey(watcherType, watcherName));
  }

  /**
   * Whether the given watcher on this agent advertises controller Docker
   * transport, i.e. lifecycle actions (start/stop/restart/rollback) execute
   * locally on the controller instead of being proxied to the agent.
   */
  hasControllerDockerTransport(watcherName: string): boolean {
    return this.controllerDockerTransportWatchers.has(watcherName);
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
    const options: AxiosRequestConfig = { maxRedirects: 0 };

    // Token mode (default): static X-Dd-Agent-Secret header, unchanged from
    // pre-ed25519 behavior. Ed25519 mode signs each request individually (see
    // buildRequestConfig) and sends no token header at all.
    if (this.config.authmode !== 'ed25519') {
      options.headers = {
        'X-Dd-Agent-Secret': this.config.secret,
      };
    }

    if (this.shouldBuildHttpsAgent()) {
      options.httpsAgent = this.buildHttpsAgent();
    }

    return options;
  }

  /**
   * Parses and validates the configured Ed25519 signing key at construction
   * time (fail fast, matching the style of rejectSecretConfiguredOverHttp /
   * validateProtocol above) so a misconfigured agent never silently sends
   * unsigned or malformed requests.
   */
  private loadSigningKey(): KeyObject {
    if (!this.config.signingkeyid || !this.config.signingkey) {
      throw new Error(
        `Agent ${this.name} has authmode 'ed25519' but is missing signingkeyid/signingkey`,
      );
    }
    try {
      return loadEd25519PrivateKey(this.config.signingkey);
    } catch (error: unknown) {
      throw new Error(
        `Agent ${this.name} has an invalid Ed25519 signingkey: ${getErrorMessage(error)}`,
      );
    }
  }

  /**
   * Serializes a request body exactly the way axios's default
   * transformRequest serializes a plain object (JSON.stringify), so the
   * Ed25519 body hash matches the bytes actually placed on the wire. Returns
   * an empty buffer for `undefined` (no body), matching Portwing's
   * empty-body hash rule — note this is NOT the same as an empty object: a
   * POST with body `{}` hashes `'{}'`, not the empty-body constant.
   */
  private serializeBodyForSigning(data?: unknown): Buffer {
    if (data === undefined) {
      return Buffer.alloc(0);
    }
    if (Buffer.isBuffer(data) || data instanceof Uint8Array) {
      return Buffer.from(data);
    }
    if (typeof data === 'string') {
      return Buffer.from(data, 'utf8');
    }
    return Buffer.from(JSON.stringify(data), 'utf8');
  }

  /**
   * Builds the AxiosRequestConfig for a single request to this agent.
   * `path` is the exact origin-form request target placed on the wire:
   * escaped path plus the unmodified raw query string. Portwing signature v2
   * verifies those bytes verbatim, including query ordering and escaping.
   * In token mode this uses the static authentication options. Ordinary JSON
   * requests also receive finite transport and body limits.
   */
  private buildRequestConfig(
    method: string,
    path: string,
    data?: unknown,
    timeout = AGENT_REQUEST_TIMEOUT_MS,
  ): AxiosRequestConfig {
    return {
      ...this.buildAuthenticatedRequestConfig(method, path, data),
      timeout,
      maxContentLength: MAX_AGENT_JSON_BYTES,
      maxBodyLength: MAX_AGENT_JSON_BYTES,
    };
  }

  private buildAuthenticatedRequestConfig(
    method: string,
    path: string,
    data?: unknown,
  ): AxiosRequestConfig {
    if (!this.ed25519PrivateKey || !this.config.signingkeyid) {
      return this.axiosOptions;
    }
    const signedHeaders = signRequest({
      method,
      path,
      body: this.serializeBodyForSigning(data),
      keyId: this.config.signingkeyid,
      privateKey: this.ed25519PrivateKey,
    });
    return {
      ...this.axiosOptions,
      headers: {
        ...this.axiosOptions.headers,
        ...signedHeaders,
      },
    };
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
    this.stopped = false;
    this.startSse();
  }

  /**
   * Forward one Docker Engine API request through a standard or edge Portwing
   * connection. The exact origin-form target is preserved for Docker routing
   * and Ed25519 signature v2 verification.
   */
  async requestDockerApi(
    method: string,
    target: string,
    headers: Record<string, string> = {},
    body?: Buffer,
  ): Promise<DockerApiProxyResponse> {
    if (!target.startsWith('/') || target.startsWith('//') || target.includes('\\')) {
      throw new Error('Docker API request target must be an origin-form path');
    }

    if (this.edgeAdapter) {
      let edgeBody: unknown;
      if (body && body.length > 0) {
        try {
          edgeBody = JSON.parse(body.toString('utf8'));
        } catch {
          throw new Error('Edge Docker API request body must be valid JSON');
        }
      }
      const response = await (isStreamingDockerTarget(target)
        ? this.edgeAdapter.sendStreamRequest(method, target, headers, edgeBody)
        : this.edgeAdapter.sendRequest(method, target, headers, edgeBody));
      if (!response || typeof response !== 'object' || Array.isArray(response)) {
        throw new Error('Malformed Docker API response from edge agent');
      }
      const record = response as Record<string, unknown>;
      if (!Number.isInteger(record.statusCode)) {
        throw new Error('Malformed Docker API response status from edge agent');
      }
      return {
        statusCode: Number(record.statusCode),
        headers: normalizeDockerProxyHeaders(record.headers),
        body: decodeDockerProxyResponseBody(record),
      };
    }

    const authConfig = this.buildRequestConfig(method, target, body);
    const response = await axios({
      ...authConfig,
      method,
      url: `${this.baseUrl}${target}`,
      data: body,
      headers: {
        ...headers,
        ...(authConfig.headers as Record<string, string> | undefined),
      },
      responseType: 'arraybuffer',
      timeout: PORTWING_DOCKER_PROXY_INACTIVITY_TIMEOUT_MS,
      maxContentLength: MAX_DOCKER_PROXY_RESPONSE_BYTES,
      maxBodyLength: MAX_DOCKER_PROXY_RESPONSE_BYTES,
      maxRedirects: 0,
      validateStatus: () => true,
    });
    return {
      statusCode: response.status,
      headers: normalizeDockerProxyHeaders(response.headers),
      body: normalizeDockerProxyBody(response.data),
    };
  }

  private pruneOldContainers(newContainers: Container[], watcher?: string) {
    const query: Record<string, unknown> = { agent: this.name };
    if (watcher) {
      query.watcher = watcher;
    }
    const containersInStore = storeContainer.getContainers(query);
    // Every caller prunes before handing the same list to
    // processAuthoritativeContainer(s), so the ownership gate there has not run
    // yet. Apply the same rule silently here (the ingest pass logs each
    // rejection): an id this agent may not write must not take part in the
    // keep-set, nor in the #496 replacement-identity match below, where naming
    // a foreign container would otherwise turn the removal of one of this
    // agent's own rows into a replacement.
    const ownedNewContainers = newContainers.filter(
      (container) => this.getAuthoritativeIngestRejection(container) === undefined,
    );
    const newContainerIds = new Set(ownedNewContainers.map((container) => container.id));

    const containersToRemove = containersInStore.filter(
      (containerInStore) => !newContainerIds.has(containerInStore.id),
    );

    // #496: a recreated container reappears under a fresh Docker id but keeps its name, so a
    // stale-id entry whose name is still in the authoritative list is a replacement, not a
    // removal. Flagging it lets the store retain the user's updatePolicy for the incoming doc
    // (and, as before, lets Hass keep the state topic alive across the swap). A name that is
    // genuinely gone stays unflagged so its HA discovery topics are still cleaned up.
    const newContainerIdentityKeys = new Set(
      ownedNewContainers
        .map((container) =>
          deriveContainerIdentityKey({
            ...container,
            agent: this.name,
            watcher: container.watcher || watcher,
          }),
        )
        .filter((key): key is string => key !== undefined),
    );
    const newUnscopedContainerNames = new Set(
      ownedNewContainers
        .filter((container) => !container.watcher && !watcher)
        .map((container) => container.name)
        .filter((name): name is string => typeof name === 'string' && name !== ''),
    );

    containersToRemove.forEach((c) => {
      this.log.info(`Pruning container ${c.name} (removed on Agent)`);
      this.pendingFreshStateAfterRemoteUpdate.delete(c.id);
      const identityKey = deriveContainerIdentityKey(c);
      const replacementExpected = identityKey
        ? newContainerIdentityKeys.has(identityKey)
        : typeof c.name === 'string' && newUnscopedContainerNames.has(c.name);
      if (replacementExpected) {
        storeContainer.deleteContainer(c.id, { replacementExpected: true });
        return;
      }
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

  private async buildContainerReport(
    container: Container,
    changedOverride?: boolean,
  ): Promise<ContainerReport> {
    if (container.security?.sbom?.documents) {
      container = {
        ...container,
        security: {
          ...container.security,
          sbom: await offloadSbomDocuments({
            sbom: container.security.sbom,
            storage: getControllerSbomStorage(),
            subjectDigest: container.image?.digest?.value,
          }),
        },
      };
    }
    if (container.security?.updateSbom?.documents) {
      container = {
        ...container,
        security: {
          ...container.security,
          updateSbom: await offloadSbomDocuments({
            sbom: container.security.updateSbom,
            storage: getControllerSbomStorage(),
            subjectDigest: container.result?.digest,
          }),
        },
      };
    }
    container.agent = this.name;
    if (
      this.controllerDockerTransportWatchers.has(container.watcher) &&
      container.image?.registry?.url
    ) {
      container = this.applyRegistryLookupLabels(container);
      container = normalizeContainer(container);
    }
    container = this.preserveControllerDockerEnrichment(container);
    // Traditional agents own registry normalization and results. Controller-owned
    // Docker transport instead applies the controller's configured registry above.

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
    if (existing && container.updatePolicyDeclarative !== undefined) {
      // The controller owns runtime overrides. Agent watcher normalization always
      // contributes an override layer (often `{}`), but that layer only reflects
      // the agent's local store and must not clear controller-set policy on ingest.
      applyUpdatePolicyOverrides(container, getUpdatePolicyOverrides(existing));
    }
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

  /**
   * `normalizeContainer()` (called just after this, for controller-Docker-transport
   * agents only) picks a registry provider by reading `image.registry.lookupImage` —
   * it never derives that field from labels itself. The local-watcher pipeline
   * (`container-init.ts`) does that translation for containers the controller watches
   * directly, but nothing in the agent path ever ran it, so `dd.registry.lookup.image`
   * (and its legacy alias `dd.registry.lookup.url`) silently did nothing for any
   * agent-reported container. Mirrors `container-init.ts`'s own label precedence
   * (`dd.registry.lookup.image` before the legacy `dd.registry.lookup.url` alias) and
   * never overwrites a value the agent already reported.
   */
  private applyRegistryLookupLabels(container: Container): Container {
    if (container.image.registry.lookupImage || container.image.registry.lookupUrl) {
      return container;
    }
    const labels = container.labels ?? {};
    const lookupImage = labels[ddRegistryLookupImage] || labels[ddRegistryLookupUrl];
    if (!lookupImage) {
      return container;
    }
    return {
      ...container,
      image: {
        ...container.image,
        registry: {
          ...container.image.registry,
          lookupImage,
        },
      },
    };
  }

  private preserveControllerDockerEnrichment(container: Container): Container {
    if (!this.controllerDockerTransportWatchers.has(container.watcher)) {
      return container;
    }
    const existing = storeContainer.getContainer(container.id);
    if (!existing) {
      return container;
    }

    const controllerOwnedFields: (keyof Container)[] = [
      'result',
      'error',
      'updateAvailable',
      'updateKind',
      'updateDetectedAt',
      'firstSeenAt',
      'maturityGatePendingSince',
      'updateAge',
      'updateMaturityLevel',
      'updateEligibility',
      'updatePolicy',
      'updatePolicyDeclarative',
      'updatePolicyOverrides',
      'updatePolicySources',
      'security',
      'updateRollback',
      'updateOperation',
      'sourceRepo',
      'currentReleaseNotes',
      'tagPinned',
      'tagPinGated',
    ];
    const merged = { ...container } as unknown as Record<string, unknown>;
    const existingRecord = existing as unknown as Record<string, unknown>;
    for (const field of controllerOwnedFields) {
      if (Object.hasOwn(existingRecord, field)) {
        merged[field] = existingRecord[field];
      }
    }
    return merged as unknown as Container;
  }

  private setControllerDockerTransportWatchers(descriptors: AgentComponentDescriptor[]): void {
    this.controllerDockerTransportWatchers.clear();
    for (const descriptor of descriptors) {
      if (isControllerDockerTransportWatcher(descriptor)) {
        this.controllerDockerTransportWatchers.add(descriptor.name);
      }
    }
  }

  /**
   * Ownership gate for the bulk/authoritative ingestion funnel
   * (`processAuthoritativeContainer`), which every full-inventory and
   * snapshot path reaches with no other check in between: handshake,
   * watcher-snapshot fallback, on-demand watch/watchContainer, and edge
   * container sync. Without this, any of those paths can report an id
   * already owned by another agent, or an id one of the controller's own
   * watchers is running, and have `buildContainerReport`'s unconditional
   * `container.agent = this.name` stamp reassign it.
   *
   * Carries the first two of `canMutateContainer`'s three checks (no
   * existing record for an id one of the controller's own watchers is
   * currently enumerating, and an existing record owned by a different
   * agent) but deliberately NOT its third (rejecting a `watcher` mismatch
   * against the stored record). Bulk ingestion is exactly how a legitimate watcher rename
   * propagates (an operator renaming a `DD_WATCHER_<NAME>_SOCKET` key), and
   * rejecting on watcher mismatch here would refuse every subsequent
   * report for that container id forever: `pruneOldContainers` keys on
   * container id, which a rename doesn't change, so the record is never
   * pruned and never retried. Updates would just stop landing with no
   * error surfaced.
   *
   * Returns the reason a container may not be ingested, or undefined when it
   * may. Two consumers: `canIngestAuthoritativeContainer`, which logs the
   * reason and drops the container, and `pruneOldContainers`, which runs
   * before ingestion and needs the same rule without a second log line.
   */
  private getAuthoritativeIngestRejection(container: Container): string | undefined {
    const containerId = container.id;
    if (typeof containerId !== 'string' || containerId.length === 0) {
      return `Ignoring authoritative container ingest without an id from agent ${this.name}`;
    }

    const existing = storeContainer.getContainer(containerId);
    if (!existing) {
      // No store row yet, so ownership has to be decided on evidence outside
      // the store. An agent could otherwise pre-insert a container id that
      // lives on the controller's host before the controller's own watch
      // cycle writes the real record (the discovery settle window is 30s
      // wide), claim it via `buildContainerReport`'s `container.agent` stamp,
      // and redirect every later lifecycle action on that container to
      // itself, because `isTriggerCompatibleWithContainer` in
      // `api/docker-trigger.ts` routes purely on the stored `agent` field.
      // The evidence is the id, not the watcher name: the controller's
      // default watcher and an agent following the quickstart are both
      // called `local`, so a name check refused every genuine agent
      // container instead (DR-106).
      const claimingWatcherId = findControllerLocalWatcherClaimingContainerId(containerId);
      if (claimingWatcherId) {
        return `Ignoring authoritative container ingest for ${sanitizeLogParam(containerId)} from agent ${this.name}: the controller's own watcher ${sanitizeLogParam(claimingWatcherId)} is currently running that container id`;
      }
      return undefined;
    }
    if (existing.agent !== this.name) {
      return `Ignoring authoritative container ingest for ${sanitizeLogParam(containerId)} from agent ${this.name}: container is owned by ${sanitizeLogParam(existing.agent ?? 'controller')}`;
    }
    return undefined;
  }

  private canIngestAuthoritativeContainer(container: Container): boolean {
    const rejection = this.getAuthoritativeIngestRejection(container);
    if (rejection) {
      this.log.warn(rejection);
      return false;
    }
    return true;
  }

  private async processAuthoritativeContainer(
    container: Container,
  ): Promise<ContainerReport | undefined> {
    if (!this.canIngestAuthoritativeContainer(container)) {
      return undefined;
    }
    this.clearPendingFreshState(container.id);
    return this.processContainer(container);
  }

  private async processAuthoritativeContainers(
    containers: Container[],
  ): Promise<ContainerReport[]> {
    const containerReports: ContainerReport[] = [];
    for (const container of containers) {
      try {
        const containerReport = await this.processAuthoritativeContainer(container);
        if (containerReport) {
          containerReports.push(containerReport);
        }
      } catch (error: unknown) {
        this.log.error(
          `Failed to process authoritative container ${sanitizeLogParam(container.id)} (${sanitizeLogParam(getErrorMessage(error))})`,
        );
      }
    }
    if (containers.length > 0 && containerReports.length === 0) {
      this.log.warn(
        `All ${containers.length} authoritative container(s) failed to process; no containers from this batch reached the store`,
      );
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

      if (kind === 'watcher' && isControllerDockerTransportWatcher(remoteComponent)) {
        await registry.registerComponent({
          kind: 'trigger',
          provider: 'docker',
          name: 'update',
          configuration: {
            transport: 'docker-api',
            execution: 'controller',
            events: 'portwing',
            watcher: remoteComponent.name,
          },
          componentPath: 'agent/components',
          agent: this.name,
        });
      }
    }
  }

  private async registerAgentWatchersTransactional(
    watchers: AgentComponentDescriptor[],
  ): Promise<void> {
    try {
      await this.registerAgentComponents('watcher', watchers);
    } catch (registrationError: unknown) {
      try {
        // A controller-transport watcher starts a cron and loopback bridge
        // before its synthetic Docker trigger is registered. Tear down every
        // component from this attempt if any later registration step fails.
        await registry.deregisterAgentComponents(this.name);
      } catch (cleanupError: unknown) {
        this.log.warn(
          `Failed to roll back components after watcher registration error (${getErrorMessage(cleanupError)})`,
        );
      }
      throw registrationError;
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
    // A reconnect is a fresh capability negotiation. Do not let a failed or
    // removed watcher descriptor leave the previous connection's ownership
    // contract active while the new inventory/components are fetched.
    this.setControllerDockerTransportWatchers([]);
    const wasConnected = this.isConnected;
    const reconnected = this.hasConnectedOnce;
    const response = await axios.get<Container[]>(
      `${this.baseUrl}/api/containers`,
      this.buildRequestConfig('GET', '/api/containers'),
    );
    const containers = response.data;
    this.log.info(`Handshake successful. Received ${containers.length} containers.`);

    // isRegisteringComponents is true for the entire deregister → re-register
    // span below, including the container-inventory apply that happens
    // between watcher and trigger registration. The `finally` guarantees it
    // reverts to false whether registration succeeds or this method throws.
    this.isRegisteringComponents = true;
    try {
      // Unregister existing components for this agent
      await registry.deregisterAgentComponents(this.name);

      // Fetch and register watchers
      try {
        const responseWatchers = await axios.get<AgentComponentDescriptor[]>(
          `${this.baseUrl}/api/watchers`,
          this.buildRequestConfig('GET', '/api/watchers'),
        );
        await this.registerAgentWatchersTransactional(responseWatchers.data);
        // Only transfer update-enrichment ownership after every controller-side
        // watcher/delegate has registered successfully.
        this.setControllerDockerTransportWatchers(responseWatchers.data);
        this.seedWatcherSnapshotCacheFromHandshake(responseWatchers.data);
      } catch (error: unknown) {
        this.log.warn(`Failed to fetch/register watchers: ${getErrorMessage(error)}`);
      }

      // Prune (and, for a same-identity replacement, stash the retained update
      // policy) before applying the incoming inventory. deleteContainer(...,
      // {replacementExpected: true}) stashes updatePolicy keyed by identity
      // (agent::watcher::name); insertContainer() consumes that stash as its
      // first action. Running the insert first — as this used to — leaves
      // nothing to consume, so a recreated agent-owned container silently
      // lost its maturity policy on every restart-driven replacement.
      //
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
      // Apply inventory only after watcher registration. Controller-transport
      // descriptors change which fields are authoritative: Portwing owns live
      // runtime state, while Drydock's native watcher owns update enrichment.
      await this.processAuthoritativeContainers(containers);

      // Fetch and register triggers
      try {
        const responseTriggers = await axios.get<AgentComponentDescriptor[]>(
          `${this.baseUrl}/api/triggers`,
          this.buildRequestConfig('GET', '/api/triggers'),
        );
        await this.registerAgentComponents('trigger', responseTriggers.data);
      } catch (error: unknown) {
        this.log.warn(`Failed to fetch/register triggers: ${getErrorMessage(error)}`);
      }
    } finally {
      this.isRegisteringComponents = false;
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
    const containerReport = await this.buildContainerReport(container);

    await maybeEmitMaturityGateCleared(containerReport.container);
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
    this.stopped = true;
    const activeSseStream = this.activeSseStream;
    this.activeSseStream = undefined;
    activeSseStream?.destroy?.();
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
    if (this.stopped || this.reconnectTimer) {
      return;
    }
    const reconnectDelay = delay ?? this.getNextReconnectDelayMs();
    const wasConnected = this.isConnected;
    this.isConnected = false;
    // A disconnect is never a "still registering" state — it's a hard loss of
    // the agent. Reset unconditionally so a disconnect that races a still-running
    // _doHandshake() cannot leave eligibility softened after the connection drops.
    this.isRegisteringComponents = false;
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

  private attachStreamHandlers(stream: NodeJS.EventEmitter & { destroy?: () => void }) {
    const decoder = new StringDecoder('utf8');
    let buffer = '';
    let queuedBytes = 0;
    let sseProcessing = Promise.resolve();

    const failForBufferOverflow = () => {
      this.activeSseStream = undefined;
      stream.destroy?.();
      this.log.error(
        `SSE event buffer exceeded the ${MAX_SSE_EVENT_BUFFER_BYTES}-byte limit. Reconnecting...`,
      );
      this.scheduleReconnect();
    };

    stream.on('data', (chunk: Buffer) => {
      if (this.stopped || this.activeSseStream !== stream) {
        return;
      }
      const decodedChunk = decoder.write(chunk);
      if (!decodedChunk) {
        return;
      }
      const decodedBytes = Buffer.byteLength(decodedChunk, 'utf8');
      if (
        Buffer.byteLength(buffer, 'utf8') + queuedBytes + decodedBytes >
        MAX_SSE_EVENT_BUFFER_BYTES
      ) {
        failForBufferOverflow();
        return;
      }
      queuedBytes += decodedBytes;

      sseProcessing = sseProcessing
        .then(async () => {
          queuedBytes = Math.max(0, queuedBytes - decodedBytes);
          if (this.stopped || this.activeSseStream !== stream) {
            return;
          }
          buffer += decodedChunk;
          buffer = await this.processSseBuffer(buffer);
        })
        .catch((error: unknown) => {
          this.log.error(`SSE data processing failed: ${getErrorMessage(error)}`);
        });
    });
    stream.on('error', (e: Error) => {
      if (this.activeSseStream !== stream) {
        return;
      }
      this.activeSseStream = undefined;
      this.log.error(`SSE Connection failed: ${e.message}`);
      this.scheduleReconnect();
    });
    stream.on('end', () => {
      if (this.activeSseStream !== stream) {
        return;
      }
      this.activeSseStream = undefined;
      this.log.warn('SSE stream ended. Reconnecting...');
      this.scheduleReconnect();
    });
  }

  startSse() {
    if (this.stopped) {
      return;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    axios({
      method: 'get',
      url: `${this.baseUrl}/api/events`,
      responseType: 'stream',
      ...this.buildAuthenticatedRequestConfig('GET', '/api/events'),
    })
      .then((response) => {
        if (this.stopped) {
          response.data?.destroy?.();
          return;
        }
        // Reset the backoff only after the stream stays open long enough to be
        // considered healthy. A stream that returns 200 then ends immediately
        // must not reset the backoff, or reconnects loop at a flat 1s (#362).
        this.stableConnectionTimer = setTimeout(() => {
          this.stableConnectionTimer = null;
          this.reconnectAttempts = 0;
        }, SSE_STABLE_CONNECTION_MS);
        this.activeSseStream = response.data;
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

  private canMutateContainer(data: unknown, operation: 'upsert' | 'remove'): data is Container {
    if (!data || typeof data !== 'object') {
      this.log.warn(`Ignoring invalid container ${operation} event from agent ${this.name}`);
      return false;
    }

    const candidate = data as Partial<Pick<Container, 'id' | 'watcher'>>;
    if (typeof candidate.id !== 'string' || candidate.id.length === 0) {
      this.log.warn(`Ignoring container ${operation} event without an id from agent ${this.name}`);
      return false;
    }

    const existing = storeContainer.getContainer(candidate.id);
    if (!existing) {
      if (operation !== 'upsert') {
        return false;
      }
      // Same no-record ownership rule as `getAuthoritativeIngestRejection`;
      // the reasoning is documented there.
      const claimingWatcherId = findControllerLocalWatcherClaimingContainerId(candidate.id);
      if (claimingWatcherId) {
        this.log.warn(
          `Ignoring container ${operation} for ${sanitizeLogParam(candidate.id)} from agent ${this.name}: the controller's own watcher ${sanitizeLogParam(claimingWatcherId)} is currently running that container id`,
        );
        return false;
      }
      return true;
    }
    if (existing.agent !== this.name) {
      this.log.warn(
        `Ignoring container ${operation} for ${sanitizeLogParam(candidate.id)} from agent ${this.name}: container is owned by ${sanitizeLogParam(existing.agent ?? 'controller')}`,
      );
      return false;
    }
    if (
      (operation === 'upsert' || candidate.watcher !== undefined) &&
      candidate.watcher !== existing.watcher
    ) {
      this.log.warn(
        `Ignoring container ${operation} for ${sanitizeLogParam(candidate.id)} from agent ${this.name}: watcher does not match`,
      );
      return false;
    }
    return true;
  }

  private async handleContainerChangeEvent(data: unknown) {
    if (!this.canMutateContainer(data, 'upsert')) {
      return;
    }
    const containerReport = await this.processContainer(data as Container);
    this.rememberPendingWatcherCycleReport(containerReport);
    if (containerReport?.container) {
      await this.refreshControllerDockerTransportContainer(containerReport.container);
    }
    this.scheduleStatsChanged();
  }

  private async refreshControllerDockerTransportContainer(container: Container): Promise<void> {
    if (!this.controllerDockerTransportWatchers.has(container.watcher)) {
      return;
    }

    const watcherId = `${this.name}.docker.${container.watcher}`;
    const watcher = registry.getState().watcher[watcherId] as unknown as
      | {
          watchContainer?: (
            target: Container,
            options?: { emitBatchEvent?: boolean },
          ) => Promise<ContainerReport>;
        }
      | undefined;
    if (typeof watcher?.watchContainer !== 'function') {
      this.log.warn(
        `Unable to refresh Portwing container ${sanitizeLogParam(container.id)}: controller watcher ${sanitizeLogParam(watcherId)} is unavailable`,
      );
      return;
    }

    try {
      await watcher.watchContainer(container, { emitBatchEvent: true });
    } catch (error: unknown) {
      // The Portwing event already refreshed runtime state. Preserve that
      // useful update and retry enrichment on the next event/scheduled poll.
      this.log.warn(
        `Unable to refresh Portwing container ${sanitizeLogParam(container.id)} with controller watcher ${sanitizeLogParam(watcherId)} (${sanitizeLogParam(getErrorMessage(error))})`,
      );
    }
  }

  private handleContainerRemovedEvent(data: unknown) {
    if (!this.canMutateContainer(data, 'remove')) {
      return;
    }
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

    // Prune (and stash any same-identity replacement's update policy) before
    // the loop below inserts/updates the incoming containers — insertContainer()
    // consumes the stash as its first action, so it must already exist. See the
    // reorder note in _doHandshake() above for the full mechanism.
    //
    // A zero-container snapshot is ambiguous the same way: a reconnecting agent
    // can legitimately report none because filterPendingDiscoveries() only
    // bypasses the discovery-settling delay for ids already in the agent's own
    // (just-reset) local store (#565). Skip the prune rather than wipe every
    // container this watcher owns.
    if (watcherName && containers.length > 0) {
      this.pruneOldContainers(containers, watcherName);
    } else if (watcherName && this.hasConnectedOnce) {
      this.log.warn(
        'Watcher snapshot returned 0 containers; preserving last-known state until the next snapshot arrives',
      );
    }

    const containerReports: ContainerReport[] = [];
    for (const container of containers) {
      try {
        const pendingContainerReport = this.takePendingWatcherCycleReport(watcherName, container);
        if (pendingContainerReport) {
          this.clearPendingFreshState(container.id);
          containerReports.push(
            await this.buildContainerReport(container, pendingContainerReport.changed),
          );
          continue;
        }
        const authoritativeReport = await this.processAuthoritativeContainer(container);
        if (authoritativeReport) {
          containerReports.push(authoritativeReport);
        }
      } catch (error: unknown) {
        this.log.error(
          `Failed to process watcher snapshot container ${sanitizeLogParam(container.id)} (${sanitizeLogParam(getErrorMessage(error))})`,
        );
      }
    }
    this.clearPendingWatcherCycleReports(watcherName);
    await emitContainerReports(containerReports);

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

  private qualifyAgentTriggerName(
    triggerName: string | undefined,
    existingTriggerName?: string,
  ): string | undefined {
    if (existingTriggerName !== undefined) {
      return existingTriggerName;
    }
    if (triggerName === undefined) {
      return undefined;
    }
    if (triggerName.startsWith(`${this.name}.`)) {
      return triggerName;
    }
    if (triggerName.indexOf('.') !== triggerName.lastIndexOf('.')) {
      return undefined;
    }
    return `${this.name}.${triggerName}`;
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
    const triggerName = toOptionalString(payload.triggerName);
    if (!operationId || !containerName || !isContainerUpdateOperationStatus(payload.status)) {
      return undefined;
    }
    const normalizedTriggerName = this.qualifyAgentTriggerName(triggerName);
    if (triggerName !== undefined && normalizedTriggerName === undefined) {
      return undefined;
    }

    return {
      operationId,
      containerName,
      status: payload.status,
      ...(normalizedTriggerName !== undefined ? { triggerName: normalizedTriggerName } : {}),
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
    triggerName?: string;
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
      ...(this.qualifyAgentTriggerName(payload.triggerName) !== undefined
        ? { triggerName: this.qualifyAgentTriggerName(payload.triggerName) }
        : {}),
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
    triggerName?: string;
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
            ...(this.qualifyAgentTriggerName(payload.triggerName, existing.triggerName) !==
            undefined
              ? {
                  triggerName: this.qualifyAgentTriggerName(
                    payload.triggerName,
                    existing.triggerName,
                  ),
                }
              : {}),
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
    triggerName?: string;
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
      ...(this.qualifyAgentTriggerName(payload.triggerName, existing?.triggerName) !== undefined
        ? {
            triggerName: this.qualifyAgentTriggerName(payload.triggerName, existing?.triggerName),
          }
        : {}),
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
      phase: payload.phase === 'dryrun' ? 'dryrun' : 'succeeded',
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
            ...(data.phase === 'dryrun' ? { phase: 'dryrun' } : {}),
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
      const target = `/api/triggers/${encodeURIComponent(triggerType)}/${encodeURIComponent(triggerName)}`;
      await axios.post(
        `${this.baseUrl}${target}`,
        payload,
        this.buildRequestConfig(
          'POST',
          target,
          payload,
          REMOTE_UPDATE_TRIGGER_TYPES.has(triggerType)
            ? AGENT_REQUEST_TIMEOUT_MS
            : SYNCHRONOUS_REMOTE_TRIGGER_TIMEOUT_MS,
        ),
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
      const target = `/api/triggers/${encodeURIComponent(triggerType)}/${encodeURIComponent(triggerName)}/batch`;
      await axios.post(
        `${this.baseUrl}${target}`,
        body,
        this.buildRequestConfig(
          'POST',
          target,
          body,
          REMOTE_UPDATE_TRIGGER_TYPES.has(triggerType)
            ? AGENT_REQUEST_TIMEOUT_MS
            : SYNCHRONOUS_REMOTE_TRIGGER_TIMEOUT_MS,
        ),
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
      const response = await axios.get(
        requestUrl,
        this.buildRequestConfig('GET', query ? `/api/log/entries?${query}` : '/api/log/entries'),
      );
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
    if (this.edgeAdapter) {
      // Punch-list #5 (resolved): forward `timestamps` over the edge path so a
      // log download routed through an edge agent honors the caller's request
      // (and the UI "show timestamps" toggle) the same as the SSE/axios fallback
      // below. Portwing's `dd:container_log_request` now carries a `timestamps`
      // field and its handler (handleContainerLogRequest in
      // internal/adapter/drydock/adapter.go) reads it. `follow`/`until` also work
      // end to end but the one-shot download path never sets them.
      return this.edgeAdapter.requestContainerLogs(containerId, {
        tail: options.tail,
        since: String(options.since),
        timestamps: options.timestamps,
      });
    }
    try {
      const target = `/api/containers/${encodeURIComponent(containerId)}/logs?tail=${options.tail}&since=${options.since}&timestamps=${options.timestamps}`;
      const response = await axios.get(
        `${this.baseUrl}${target}`,
        this.buildRequestConfig('GET', target),
      );
      return response.data;
    } catch (error: unknown) {
      this.log.error(`Error fetching container logs from agent: ${getErrorMessage(error)}`);
      throw error;
    }
  }

  async deleteContainer(containerId: string) {
    if (this.edgeAdapter) {
      return this.edgeAdapter.deleteContainer(containerId);
    }
    try {
      this.log.debug(`Deleting container ${sanitizeLogParam(containerId)} on agent`);
      const target = `/api/containers/${encodeURIComponent(containerId)}`;
      await axios.delete(`${this.baseUrl}${target}`, this.buildRequestConfig('DELETE', target));
    } catch (error: unknown) {
      this.log.error(`Error deleting container on agent: ${getErrorMessage(error)}`);
      throw error;
    }
  }

  async getWatcher(watcherType: string, watcherName: string) {
    try {
      const target = `/api/watchers/${encodeURIComponent(watcherType)}/${encodeURIComponent(watcherName)}`;
      const response = await axios.get<AgentComponentDescriptor>(
        `${this.baseUrl}${target}`,
        this.buildRequestConfig('GET', target),
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
      const target = `/api/watchers/${encodeURIComponent(watcherType)}/${encodeURIComponent(watcherName)}`;
      const response = await axios.post<ContainerReport[]>(
        `${this.baseUrl}${target}`,
        {},
        this.buildRequestConfig('POST', target, {}),
      );
      const reports = response.data;
      const containers = reports.map((report) => report.container);
      // Prune (and stash any same-identity replacement's update policy) before
      // processAuthoritativeContainers() inserts/updates below — insertContainer()
      // consumes the stash as its first action, so it must already exist. See the
      // reorder note in _doHandshake() for the full mechanism.
      //
      // An empty report list is ambiguous the same way a zero-container handshake
      // is: it could mean the watcher genuinely has nothing to report, or that
      // enumeration failed entirely on the agent (Docker.watch() returns []
      // without distinguishing the two). Skip the prune in that case rather than
      // wiping every container this watcher owns.
      if (containers.length > 0) {
        this.pruneOldContainers(containers, watcherName);
      } else if (this.hasConnectedOnce) {
        this.log.warn(
          'Watch returned 0 containers; preserving last-known state until the next watch cycle completes',
        );
      }
      await this.processAuthoritativeContainers(containers);
      this.scheduleStatsChanged();
      return reports;
    } catch (error: unknown) {
      this.log.error(`Error watching on agent: ${sanitizeLogParam(getErrorMessage(error))}`);
      throw error;
    }
  }

  async watchContainer(watcherType: string, watcherName: string, container: Container) {
    try {
      const target = `/api/watchers/${encodeURIComponent(watcherType)}/${encodeURIComponent(watcherName)}/container/${encodeURIComponent(container.id)}`;
      const response = await axios.post<ContainerReport>(
        `${this.baseUrl}${target}`,
        {},
        this.buildRequestConfig('POST', target, {}),
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

  /**
   * Public shim: process an authoritative container list received from an edge
   * agent via dd:container_sync. Replaces handshake() for edge connections.
   */
  async handleContainerSync(containers: Container[]): Promise<void> {
    // Prune (and stash any same-identity replacement's update policy) before
    // processAuthoritativeContainers() inserts/updates below — insertContainer()
    // consumes the stash as its first action, so it must already exist. See the
    // reorder note in _doHandshake() for the full mechanism.
    if (containers.length > 0) {
      this.pruneOldContainers(containers);
    }
    const reports = await this.processAuthoritativeContainers(containers);
    this.scheduleStatsChanged();
    // Suppress unused variable warning — reports are emitted internally.
    void reports;
  }

  /**
   * Public shim: register watchers and triggers received from an edge agent
   * via dd:component_sync. Replaces the handshake() watcher/trigger fetch.
   */
  async handleComponentSync(
    watchers: AgentComponentDescriptor[],
    triggers: AgentComponentDescriptor[],
  ): Promise<void> {
    // Same deregister → re-register window as _doHandshake(): keep transient
    // eligibility blockers soft while components are being replaced.
    this.isRegisteringComponents = true;
    try {
      this.setControllerDockerTransportWatchers([]);
      await registry.deregisterAgentComponents(this.name);
      await this.registerAgentWatchersTransactional(watchers);
      this.setControllerDockerTransportWatchers(watchers);
      this.seedWatcherSnapshotCacheFromHandshake(watchers);
      await this.registerAgentComponents('trigger', triggers);
    } finally {
      this.isRegisteringComponents = false;
    }
  }

  /**
   * Public shim: schedule a debounced agentStatsChanged event emission.
   * Allows EdgeAgentAdapter to trigger stats updates after metrics frames.
   */
  scheduleStatsChangedPublic(): void {
    this.scheduleStatsChanged();
  }
}
