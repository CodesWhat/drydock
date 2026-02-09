import axios, { AxiosRequestConfig } from 'axios';
import https from 'https';
import fs from 'fs';
import { StringDecoder } from 'string_decoder';
import logger from '../log';
import * as storeContainer from '../store/container';
import { emitContainerReport } from '../event';
import { Container, ContainerReport } from '../model/container';
import * as registry from '../registry';

export interface AgentClientConfig {
    host: string;
    port: number;
    secret: string;
    cafile?: string;
    certfile?: string;
    keyfile?: string;
}

export class AgentClient {
    public name: string;
    public config: AgentClientConfig;
    private log: any;
    private baseUrl: string;
    private axiosOptions: AxiosRequestConfig;
    public isConnected: boolean;
    private reconnectTimer: NodeJS.Timeout | null;

    constructor(name: string, config: AgentClientConfig) {
        this.name = name;
        this.config = config;
        this.log = logger.child({ component: `agent-client.${name}` });
        this.baseUrl = `${this.config.host}:${this.config.port || 3000}`;
        // Add protocol if not present
        if (!this.baseUrl.startsWith('http')) {
            this.baseUrl = `http${this.config.certfile ? 's' : ''}://${this.baseUrl}`;
        }

        this.axiosOptions = {
            headers: {
                'X-Wud-Agent-Secret': this.config.secret,
            },
        };

        if (this.config.certfile) {
            this.axiosOptions.httpsAgent = new https.Agent({
                ca: this.config.cafile
                    ? fs.readFileSync(this.config.cafile)
                    : undefined,
                cert: this.config.certfile
                    ? fs.readFileSync(this.config.certfile)
                    : undefined,
                key: this.config.keyfile
                    ? fs.readFileSync(this.config.keyfile)
                    : undefined,
                rejectUnauthorized: false,
            });
        }

        this.isConnected = false;
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

        const containersToRemove = containersInStore.filter(
            (containerInStore) =>
                !newContainers.find((c) => c.id === containerInStore.id),
        );

        containersToRemove.forEach((c) => {
            this.log.info(`Pruning container ${c.name} (removed on Agent)`);
            storeContainer.deleteContainer(c.id);
        });
    }

    private async registerAgentComponents(
        kind: 'watcher' | 'trigger',
        remoteComponents: any[],
    ) {
        for (const remoteComponent of remoteComponents) {
            await registry.registerComponent(
                kind,
                remoteComponent.type,
                remoteComponent.name,
                remoteComponent.configuration,
                '../agent/components',
                this.name,
            );
        }
    }

    async handshake() {
        const response = await axios.get<Container[]>(
            `${this.baseUrl}/api/containers`,
            this.axiosOptions,
        );
        const containers = response.data;
        this.log.info(
            `Handshake successful. Received ${containers.length} containers.`,
        );

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
            await this.registerAgentComponents(
                'watcher',
                responseWatchers.data,
            );
        } catch (e: any) {
            this.log.warn(`Failed to fetch/register watchers: ${e.message}`);
        }

        // Fetch and register triggers
        try {
            const responseTriggers = await axios.get<any[]>(
                `${this.baseUrl}/api/triggers`,
                this.axiosOptions,
            );
            await this.registerAgentComponents(
                'trigger',
                responseTriggers.data,
            );
        } catch (e: any) {
            this.log.warn(`Failed to fetch/register triggers: ${e.message}`);
        }

        this.isConnected = true;
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

        if (!existing) {
            containerReport.container =
                storeContainer.insertContainer(container);
            containerReport.changed = true;
        } else {
            containerReport.container =
                storeContainer.updateContainer(container);
            // existing is the old state (from store), container is new state (from Agent)
            // But storeContainer.updateContainer returns the NEW state object with validation/methods
            // We use existing.resultChanged() to compare with the new state
            if (existing.resultChanged) {
                containerReport.changed =
                    existing.resultChanged(containerReport.container) &&
                    containerReport.container.updateAvailable;
            }
        }

        // Emit report so Triggers can fire if changed
        emitContainerReport(containerReport);
    }

    scheduleReconnect(delay: number) {
        if (this.reconnectTimer) {
            return;
        }
        this.isConnected = false;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.startSse();
        }, delay);
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
                const stream = response.data;
                const decoder = new StringDecoder('utf8');
                let buffer = '';

                stream.on('data', (chunk: Buffer) => {
                    buffer += decoder.write(chunk);
                    const messages = buffer.split('\n\n');
                    // The last element is either empty (if buffer ended with \n\n) or incomplete
                    buffer = messages.pop() || '';

                    for (const message of messages) {
                        const lines = message.split('\n');
                        for (const line of lines) {
                            if (line.startsWith('data: ')) {
                                try {
                                    const payload = JSON.parse(
                                        line.substring(6),
                                    );
                                    if (payload.type && payload.data) {
                                        this.handleEvent(
                                            payload.type,
                                            payload.data,
                                        );
                                    }
                                } catch (e: any) {
                                    this.log.warn(
                                        `Error parsing SSE data: ${e.message}`,
                                    );
                                }
                            }
                        }
                    }
                });
                stream.on('error', (e: Error) => {
                    this.log.error(`SSE Connection failed: ${e.message}`);
                    this.scheduleReconnect(1000);
                });
                stream.on('end', () => {
                    this.log.warn('SSE stream ended. Reconnecting...');
                    this.scheduleReconnect(1000);
                });
            })
            .catch((e) => {
                this.log.error(
                    `SSE Connection failed: ${e.message}. Retrying...`,
                );
                this.scheduleReconnect(5000);
            });
    }

    async handleEvent(eventName: string, data: any) {
        if (eventName === 'wud:ack') {
            this.log.info(
                `Agent ${this.name} connected (version: ${data.version})`,
            );
            this.handshake();
        } else if (
            eventName === 'wud:container-added' ||
            eventName === 'wud:container-updated'
        ) {
            await this.processContainer(data as Container);
        } else if (eventName === 'wud:container-removed') {
            storeContainer.deleteContainer(data.id);
        }
    }

    async runRemoteTrigger(
        container: Container,
        triggerType: string,
        triggerName: string,
    ) {
        try {
            this.log.debug(
                `Running remote trigger ${triggerType}.${triggerName} (container=${JSON.stringify(
                    container,
                )})`,
            );
            await axios.post(
                `${this.baseUrl}/api/triggers/${triggerType}/${triggerName}`,
                container,
                this.axiosOptions,
            );
        } catch (e: any) {
            this.log.error(`Error running remote trigger: ${e.message}`);
            throw e;
        }
    }

    async runRemoteTriggerBatch(
        containers: Container[],
        triggerType: string,
        triggerName: string,
    ) {
        try {
            await axios.post(
                `${this.baseUrl}/api/triggers/${triggerType}/${triggerName}/batch`,
                containers,
                this.axiosOptions,
            );
        } catch (e: any) {
            this.log.error(`Error running remote batch trigger: ${e.message}`);
            throw e;
        }
    }

    async deleteContainer(containerId: string) {
        try {
            this.log.debug(`Deleting container ${containerId} on agent`);
            await axios.delete(
                `${this.baseUrl}/api/containers/${containerId}`,
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
                `${this.baseUrl}/api/watchers/${watcherType}/${watcherName}`,
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
            this.log.error(`Error watching on agent: ${e.message}`);
            throw e;
        }
    }

    async watchContainer(
        watcherType: string,
        watcherName: string,
        container: Container,
    ) {
        try {
            const response = await axios.post<ContainerReport>(
                `${this.baseUrl}/api/watchers/${watcherType}/${watcherName}/container/${container.id}`,
                {},
                this.axiosOptions,
            );
            const report = response.data;

            // Process the result (registry check, store update)
            await this.processContainer(report.container);
            return report;
        } catch (e: any) {
            this.log.error(
                `Error watching container ${container.name} on agent: ${e.message}`,
            );
            throw e;
        }
    }
}
