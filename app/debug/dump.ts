import { mapComponentsToList } from '../api/component.js';
import { ddEnvVars, getVersion } from '../configuration/index.js';
import type { Container } from '../model/container.js';
import type { RegistryState } from '../registry/index.js';
import * as registry from '../registry/index.js';
import * as storeContainer from '../store/container.js';
import * as store from '../store/index.js';
import { redactDebugDump } from './redact.js';

export const DEFAULT_RECENT_EVENT_MINUTES = 30;
export const MIN_RECENT_EVENT_MINUTES = 1;
export const MAX_RECENT_EVENT_MINUTES = 24 * 60;

interface DockerWatcherLike {
  type?: string;
  name?: string;
  configuration?: {
    watchevents?: boolean;
  };
  dockerApi?: {
    version?: () => Promise<unknown>;
    info?: () => Promise<unknown>;
  };
  ensureRemoteAuthHeaders?: () => Promise<void>;
  isDockerEventsListenerActive?: boolean;
  dockerEventsStream?: unknown;
  dockerEventsReconnectTimeout?: unknown;
  dockerEventsReconnectAttempt?: number;
  dockerEventsReconnectDelayMs?: number;
  getRecentDockerEvents?: (options?: { sinceMs?: number; limit?: number }) => unknown[];
  getRecentAliasFilterDecisions?: (options?: { sinceMs?: number; limit?: number }) => unknown[];
}

interface MqttHassLike {
  getDiscoveryTopic?: (args: { kind: string; topic: string }) => string;
  containerStateTopicById?: Map<string, string>;
}

interface MqttTriggerLike {
  type?: string;
  configuration?: {
    topic?: string;
  };
  hass?: MqttHassLike;
}

interface CollectDebugDumpOptions {
  recentMinutes?: number;
}

type JsonObject = Record<string, unknown>;

function normalizeRecentMinutes(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_RECENT_EVENT_MINUTES;
  }
  return Math.min(MAX_RECENT_EVENT_MINUTES, Math.max(MIN_RECENT_EVENT_MINUTES, Math.trunc(value)));
}

function toIsoNow(): string {
  return new Date().toISOString();
}

function getRecentWindowStartIso(recentMinutes: number): string {
  const startTimestampMs = Date.now() - recentMinutes * 60 * 1000;
  return new Date(startTimestampMs).toISOString();
}

function getDockerWatchers(
  watcherState: RegistryState['watcher'],
): Array<[string, DockerWatcherLike]> {
  return Object.entries(watcherState).filter(([, watcher]) => watcher?.type === 'docker') as Array<
    [string, DockerWatcherLike]
  >;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runOptionalAsyncHook(
  hook: (() => Promise<void>) | undefined,
  snapshot: JsonObject,
  errorField: string,
): Promise<void> {
  if (typeof hook !== 'function') {
    return;
  }

  try {
    await hook();
  } catch (error: unknown) {
    snapshot[errorField] = getErrorMessage(error);
  }
}

async function setOptionalAsyncField(
  snapshot: JsonObject,
  field: string,
  errorField: string,
  getter: (() => Promise<unknown>) | undefined,
): Promise<void> {
  if (typeof getter !== 'function') {
    return;
  }

  try {
    snapshot[field] = await getter();
  } catch (error: unknown) {
    snapshot[errorField] = getErrorMessage(error);
  }
}

async function collectDockerApiInfo(
  dockerWatchers: Array<[string, DockerWatcherLike]>,
): Promise<Array<JsonObject>> {
  const snapshots = await Promise.all(
    dockerWatchers.map(async ([watcherId, watcher]) => {
      const snapshot: JsonObject = {
        watcherId,
        watcherName: watcher.name,
      };

      await runOptionalAsyncHook(
        watcher.ensureRemoteAuthHeaders,
        snapshot,
        'authInitializationError',
      );
      await setOptionalAsyncField(snapshot, 'version', 'versionError', watcher.dockerApi?.version);
      await setOptionalAsyncField(snapshot, 'info', 'infoError', watcher.dockerApi?.info);

      return snapshot;
    }),
  );
  return snapshots;
}

function collectDockerEventSubscriptionState(
  dockerWatchers: Array<[string, DockerWatcherLike]>,
): JsonObject[] {
  return dockerWatchers.map(([watcherId, watcher]) => ({
    watcherId,
    watcherName: watcher.name,
    watchEventsEnabled: watcher.configuration?.watchevents === true,
    listenerActive: watcher.isDockerEventsListenerActive === true,
    streamActive: watcher.dockerEventsStream !== undefined,
    reconnectScheduled: watcher.dockerEventsReconnectTimeout !== undefined,
    reconnectAttempt: watcher.dockerEventsReconnectAttempt ?? 0,
    reconnectDelayMs: watcher.dockerEventsReconnectDelayMs ?? 0,
  }));
}

function collectRecentWatcherRecords(
  dockerWatchers: Array<[string, DockerWatcherLike]>,
  recentMinutes: number,
  getRecords: (
    watcher: DockerWatcherLike,
    options: { sinceMs: number; limit?: number },
  ) => unknown[] | undefined,
): unknown[] {
  const sinceMs = Date.now() - recentMinutes * 60 * 1000;
  return dockerWatchers.flatMap(([watcherId, watcher]) => {
    const records = getRecords(watcher, { sinceMs });
    if (!Array.isArray(records)) {
      return [];
    }
    return records.map((record) => ({
      watcherId,
      watcherName: watcher.name,
      ...((record as Record<string, unknown>) || {}),
    }));
  });
}

function collectRecentDockerEvents(
  dockerWatchers: Array<[string, DockerWatcherLike]>,
  recentMinutes: number,
): unknown[] {
  return collectRecentWatcherRecords(dockerWatchers, recentMinutes, (watcher, options) =>
    watcher.getRecentDockerEvents?.(options),
  );
}

function collectRecentAliasFilterDecisions(
  dockerWatchers: Array<[string, DockerWatcherLike]>,
  recentMinutes: number,
): unknown[] {
  return collectRecentWatcherRecords(dockerWatchers, recentMinutes, (watcher, options) =>
    watcher.getRecentAliasFilterDecisions?.(options),
  );
}

function addMqttSensorDefinition(
  sensorsByDiscoveryTopic: Map<string, JsonObject>,
  {
    hass,
    kind,
    stateTopic,
  }: {
    hass: MqttHassLike;
    kind: string;
    stateTopic: string;
  },
): void {
  if (typeof hass.getDiscoveryTopic !== 'function') {
    return;
  }
  const discoveryTopic = hass.getDiscoveryTopic({
    kind,
    topic: stateTopic,
  });
  if (!discoveryTopic) {
    return;
  }

  sensorsByDiscoveryTopic.set(discoveryTopic, {
    discoveryTopic,
    stateTopic,
    unique_id: stateTopic.replaceAll('/', '_'),
  });
}

function collectMqttHomeAssistantSensors(
  triggerState: RegistryState['trigger'],
  containers: Container[],
): JsonObject[] {
  const watcherNames = Array.from(
    new Set(
      containers
        .map((container) => container.watcher)
        .filter((watcherName): watcherName is string => typeof watcherName === 'string'),
    ),
  );

  const sensorsByDiscoveryTopic = new Map<string, JsonObject>();
  Object.values(triggerState).forEach((trigger) => {
    const mqttTrigger = trigger as unknown as MqttTriggerLike;
    if (mqttTrigger.type !== 'mqtt' || !mqttTrigger.hass) {
      return;
    }

    const topicBase =
      typeof mqttTrigger.configuration?.topic === 'string' &&
      mqttTrigger.configuration.topic.length > 0
        ? mqttTrigger.configuration.topic
        : 'dd/container';
    const hass = mqttTrigger.hass;

    // Global aggregate sensors.
    addMqttSensorDefinition(sensorsByDiscoveryTopic, {
      hass,
      kind: 'sensor',
      stateTopic: `${topicBase}/total_count`,
    });
    addMqttSensorDefinition(sensorsByDiscoveryTopic, {
      hass,
      kind: 'sensor',
      stateTopic: `${topicBase}/update_count`,
    });
    addMqttSensorDefinition(sensorsByDiscoveryTopic, {
      hass,
      kind: 'binary_sensor',
      stateTopic: `${topicBase}/update_status`,
    });

    // Per-watcher aggregate sensors.
    watcherNames.forEach((watcherName) => {
      addMqttSensorDefinition(sensorsByDiscoveryTopic, {
        hass,
        kind: 'sensor',
        stateTopic: `${topicBase}/${watcherName}/total_count`,
      });
      addMqttSensorDefinition(sensorsByDiscoveryTopic, {
        hass,
        kind: 'sensor',
        stateTopic: `${topicBase}/${watcherName}/update_count`,
      });
      addMqttSensorDefinition(sensorsByDiscoveryTopic, {
        hass,
        kind: 'binary_sensor',
        stateTopic: `${topicBase}/${watcherName}/update_status`,
      });
      addMqttSensorDefinition(sensorsByDiscoveryTopic, {
        hass,
        kind: 'binary_sensor',
        stateTopic: `${topicBase}/${watcherName}/running`,
      });
    });

    // Per-container sensors tracked by the Home Assistant helper.
    const trackedStateTopics =
      mqttTrigger.hass.containerStateTopicById instanceof Map
        ? Array.from(mqttTrigger.hass.containerStateTopicById.values())
        : [];
    trackedStateTopics.forEach((stateTopic) => {
      addMqttSensorDefinition(sensorsByDiscoveryTopic, {
        hass,
        kind: 'update',
        stateTopic,
      });
    });
  });

  return Array.from(sensorsByDiscoveryTopic.values()).sort((a, b) =>
    String(a.discoveryTopic).localeCompare(String(b.discoveryTopic)),
  );
}

export async function collectDebugDump(options: CollectDebugDumpOptions = {}) {
  const recentMinutes = normalizeRecentMinutes(options.recentMinutes);
  const containers = storeContainer.getContainersRaw();
  const registryState = registry.getState();
  const dockerWatchers = getDockerWatchers(registryState.watcher);

  const dump = {
    metadata: {
      generatedAt: toIsoNow(),
      generatedAtWindowStart: getRecentWindowStartIso(recentMinutes),
      recentMinutes,
      drydockVersion: getVersion(),
      nodeVersion: process.version,
      uptimeSeconds: Math.floor(process.uptime()),
    },
    state: {
      containers,
      watchers: mapComponentsToList(registryState.watcher, 'watcher'),
      triggers: mapComponentsToList(registryState.trigger, 'trigger'),
      registries: mapComponentsToList(registryState.registry, 'registry'),
      authentications: mapComponentsToList(registryState.authentication, 'authentication'),
      agents: mapComponentsToList(registryState.agent, 'agent'),
    },
    mqttHomeAssistant: {
      sensors: collectMqttHomeAssistantSensors(registryState.trigger, containers),
    },
    dockerEvents: {
      activeSubscriptions: collectDockerEventSubscriptionState(dockerWatchers),
      recentEvents: collectRecentDockerEvents(dockerWatchers, recentMinutes),
    },
    aliasFiltering: {
      recentDecisions: collectRecentAliasFilterDecisions(dockerWatchers, recentMinutes),
    },
    store: {
      stats: store.getDebugSnapshot(),
    },
    dockerApi: {
      watchers: await collectDockerApiInfo(dockerWatchers),
    },
    environment: {
      ddEnvVars,
    },
  };

  return redactDebugDump(dump);
}

export function serializeDebugDump(dump: unknown): string {
  return `${JSON.stringify(dump, null, 2)}\n`;
}

export function getDebugDumpFilename(now: Date = new Date()): string {
  const dateForFile = now.toISOString().slice(0, 10);
  return `drydock-debug-dump-${dateForFile}.json`;
}
