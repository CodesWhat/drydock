import fs from 'node:fs';
import https from 'node:https';
import { StringDecoder } from 'node:string_decoder';
import axios, { type AxiosRequestConfig } from 'axios';
import { emitAgentConnected, emitAgentDisconnected, emitContainerReport } from '../event/index.js';
import logger from '../log/index.js';
import { sanitizeLogParam } from '../log/sanitize.js';
import type { Container, ContainerReport } from '../model/container.js';
import * as registry from '../registry/index.js';
import { resolveConfiguredPath } from '../runtime/paths.js';
import * as storeContainer from '../store/container.js';

export interface AgentClientConfig {
  host: string;
  port: number;
  secret: string;
  cafile?: string;
  certfile?: string;
  keyfile?: string;
}

export interface AgentClientRuntimeInfo {
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

export class AgentClient {
  public name: string;
  public config: AgentClientConfig;
  private readonly log: any;
  private readonly baseUrl: string;
  private readonly axiosOptions: AxiosRequestConfig;
  public isConnected: boolean;
  public info: AgentClientRuntimeInfo;
  private reconnectTimer: NodeJS.Timeout | null;

  constructor(name: string, config: AgentClientConfig) {
    this.name = name;
    this.config = config;
    this.log = logger.child({ component: `agent-client.${name}` });
    const port = this.config.port || 3000;
    let candidateUrl = `${this.config.host}:${port}`;
    // Add protocol if not present
    if (!candidateUrl.startsWith('http')) {
      const useHttps = Boolean(this.config.certfile) || port === 443;
      candidateUrl = `http${useHttps ? 's' : ''}://${candidateUrl}`;
    }
    // Validate the URL to prevent request forgery (CodeQL js/request-forgery)
    const parsed = new URL(candidateUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error(`Invalid agent URL protocol: ${parsed.protocol}`);
    }
    this.baseUrl = parsed.origin;

    this.axiosOptions = {
      headers: {
        'X-Dd-Agent-Secret': this.config.secret,
      },
    };

    if (this.config.certfile) {
      const caPath = this.config.cafile
        ? resolveConfiguredPath(this.config.cafile, { label: `${name} ca file` })
        : undefined;
      const certPath = resolveConfiguredPath(this.config.certfile, {
        label: `${name} cert file`,
      });
      const keyPath = this.config.keyfile
        ? resolveConfiguredPath(this.config.keyfile, { label: `${name} key file` })
        : undefined;
      // Intentional: mTLS with optional self-signed CA for agent communication
      // lgtm[js/disabling-certificate-validation]
      this.axiosOptions.httpsAgent = new https.Agent({
        ca: caPath ? fs.readFileSync(caPath) : undefined,
        cert: certPath ? fs.readFileSync(certPath) : undefined,
        key: keyPath ? fs.readFileSync(keyPath) : undefined,
      });
    }

    this.isConnected = false;
    this.info = {};
    this.reconnectTimer = null;
  }

  async init() {
    this.log.info(`Connecting to agent ${this.name} at ${this.baseUrl}`);
    this.startSse();
  }

  private pruneOldContainers(newContainers: Container[], watcher?: string) {
    const query: any = { agent: this.name };
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
      storeContainer.deleteContainer(c.id);
    });
  }

  private async registerAgentComponents(kind: 'watcher' | 'trigger', remoteComponents: any[]) {
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
    const wasConnected = this.isConnected;
    const response = await axios.get<Container[]>(
      `${this.baseUrl}/api/containers`,
      this.axiosOptions,
    );
    const containers = response.data;
    this.log.info(`Handshake successful. Received ${containers.length} containers.`);

    for (const container of containers) {
      await this.processContainer(container);
    }
    this.pruneOldContainers(containers);

    // Unregister any existing components for this agent
    await registry.deregisterAgentComponents(this.name);

    // Fetch and register watchers
    try {
      const responseWatchers = await axios.get<any[]>(
        `${this.baseUrl}/api/watchers`,
        this.axiosOptions,
      );
      await this.registerAgentComponents('watcher', responseWatchers.data);
    } catch (e: any) {
      this.log.warn(`Failed to fetch/register watchers: ${e.message}`);
    }

    // Fetch and register triggers
    try {
      const responseTriggers = await axios.get<any[]>(
        `${this.baseUrl}/api/triggers`,
        this.axiosOptions,
      );
      await this.registerAgentComponents('trigger', responseTriggers.data);
    } catch (e: any) {
      this.log.warn(`Failed to fetch/register triggers: ${e.message}`);
    }

    this.isConnected = true;
    if (!wasConnected) {
      void emitAgentConnected({
        agentName: this.name,
      }).catch((e: any) => {
        this.log.debug(`Failed to emit agent connected event (${e.message})`);
      });
    }
  }

  async processContainer(container: Container) {
    container.agent = this.name;
    // The container coming from Agent should already be normalized and have results
    // We rely on the Agent to perform Registry checks if configured

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

    // Emit report so Triggers can fire if changed
    emitContainerReport(containerReport);
  }

  scheduleReconnect(delay: number) {
    if (this.reconnectTimer) {
      return;
    }
    const wasConnected = this.isConnected;
    this.isConnected = false;
    if (wasConnected) {
      void emitAgentDisconnected({
        agentName: this.name,
        reason: 'SSE connection lost',
      }).catch((e: any) => {
        this.log.debug(`Failed to emit agent disconnected event (${e.message})`);
      });
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.startSse();
    }, delay);
  }

  private parseSseLine(line: string) {
    if (!line.startsWith('data: ')) {
      return;
    }
    try {
      const payload = JSON.parse(line.substring(6));
      if (payload.type && payload.data) {
        this.handleEvent(payload.type, payload.data);
      }
    } catch (e: any) {
      this.log.warn(`Error parsing SSE data: ${e.message}`);
    }
  }

  private processSseBuffer(buffer: string): string {
    const messages = buffer.split('\n\n');
    // The last element is either empty (if buffer ended with \n\n) or incomplete
    const remainder = messages.pop() || '';

    for (const message of messages) {
      for (const line of message.split('\n')) {
        this.parseSseLine(line);
      }
    }
    return remainder;
  }

  private attachStreamHandlers(stream: NodeJS.EventEmitter) {
    const decoder = new StringDecoder('utf8');
    let buffer = '';

    stream.on('data', (chunk: Buffer) => {
      buffer += decoder.write(chunk);
      buffer = this.processSseBuffer(buffer);
    });
    stream.on('error', (e: Error) => {
      this.log.error(`SSE Connection failed: ${e.message}`);
      this.scheduleReconnect(1000);
    });
    stream.on('end', () => {
      this.log.warn('SSE stream ended. Reconnecting...');
      this.scheduleReconnect(1000);
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
        this.attachStreamHandlers(response.data);
      })
      .catch((e) => {
        this.log.error(`SSE Connection failed: ${e.message}. Retrying...`);
        this.scheduleReconnect(5000);
      });
  }

  async handleEvent(eventName: string, data: any) {
    if (eventName === 'dd:ack') {
      this.info = {
        ...this.info,
        version: typeof data?.version === 'string' ? data.version : this.info.version,
        os: typeof data?.os === 'string' ? data.os : this.info.os,
        arch: typeof data?.arch === 'string' ? data.arch : this.info.arch,
        cpus: Number.isFinite(data?.cpus) ? Number(data.cpus) : this.info.cpus,
        memoryGb: Number.isFinite(data?.memoryGb) ? Number(data.memoryGb) : this.info.memoryGb,
        uptimeSeconds: Number.isFinite(data?.uptimeSeconds)
          ? Number(data.uptimeSeconds)
          : this.info.uptimeSeconds,
        lastSeen:
          typeof data?.lastSeen === 'string' && data.lastSeen
            ? data.lastSeen
            : new Date().toISOString(),
      };
      this.log.info(`Agent ${this.name} connected (version: ${data.version})`);
      this.handshake();
    } else if (eventName === 'dd:container-added' || eventName === 'dd:container-updated') {
      await this.processContainer(data as Container);
    } else if (eventName === 'dd:container-removed') {
      storeContainer.deleteContainer(data.id);
    }
  }

  async runRemoteTrigger(container: Container, triggerType: string, triggerName: string) {
    try {
      this.log.debug(
        `Running remote trigger ${sanitizeLogParam(triggerType)}.${sanitizeLogParam(triggerName)} (container=${sanitizeLogParam(JSON.stringify(container), 500)})`,
      );
      await axios.post(
        `${this.baseUrl}/api/triggers/${encodeURIComponent(triggerType)}/${encodeURIComponent(triggerName)}`,
        container,
        this.axiosOptions,
      );
    } catch (e: any) {
      this.log.error(`Error running remote trigger: ${sanitizeLogParam(e.message)}`);
      throw e;
    }
  }

  async runRemoteTriggerBatch(containers: Container[], triggerType: string, triggerName: string) {
    try {
      await axios.post(
        `${this.baseUrl}/api/triggers/${encodeURIComponent(triggerType)}/${encodeURIComponent(triggerName)}/batch`,
        containers,
        this.axiosOptions,
      );
    } catch (e: any) {
      this.log.error(`Error running remote batch trigger: ${sanitizeLogParam(e.message)}`);
      throw e;
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
    } catch (e: any) {
      this.log.error(`Error fetching log entries from agent: ${e.message}`);
      throw e;
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
    } catch (e: any) {
      this.log.error(`Error fetching container logs from agent: ${e.message}`);
      throw e;
    }
  }

  async deleteContainer(containerId: string) {
    try {
      this.log.debug(`Deleting container ${sanitizeLogParam(containerId)} on agent`);
      await axios.delete(
        `${this.baseUrl}/api/containers/${encodeURIComponent(containerId)}`,
        this.axiosOptions,
      );
    } catch (e: any) {
      this.log.error(`Error deleting container on agent: ${e.message}`);
      throw e;
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
      for (const report of reports) {
        await this.processContainer(report.container);
      }
      const containers = reports.map((report) => report.container);
      this.pruneOldContainers(containers, watcherName);
      return reports;
    } catch (e: any) {
      this.log.error(`Error watching on agent: ${sanitizeLogParam(e.message)}`);
      throw e;
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
      await this.processContainer(report.container);
      return report;
    } catch (e: any) {
      this.log.error(`Error watching container ${container.name} on agent: ${e.message}`);
      throw e;
    }
  }
}
