import { getVersion } from '../../../configuration/index.js';
import {
  registerContainerAdded,
  registerContainerRemoved,
  registerContainerUpdated,
  registerWatcherStart,
  registerWatcherStop,
} from '../../../event/index.js';
import * as containerStore from '../../../store/container.js';
import {
  getSanitizedCanonicalContainerName,
  getStaleSanitizedContainerNameCandidates,
} from './naming.js';

const HASS_DEVICE_ID = 'drydock';
const HASS_DEVICE_NAME = 'drydock';
const HASS_MANUFACTURER = 'drydock';
const HASS_ENTITY_VALUE_TEMPLATE = '{{ value_json.image_tag_value }}';
const HASS_LATEST_VERSION_TEMPLATE =
  '{% if value_json.update_kind_kind == "digest" %}{{ value_json.result_digest[:15] }}{% else %}{{ value_json.result_tag }}{% endif %}';
const HASS_DEFAULT_ENTITY_PICTURE =
  'https://raw.githubusercontent.com/CodesWhat/drydock/main/docs/assets/whale-logo.png';
export const HASS_CONTAINER_STATE_TOPIC_TRACK_LIMIT = 10_000;

interface HassClient {
  publish: (
    topic: string,
    message: string,
    options?: {
      retain?: boolean;
    },
  ) => Promise<unknown> | unknown;
}

interface HassConfiguration {
  topic: string;
  hass: {
    prefix: string;
    discovery: boolean;
  };
}

interface HassLogger {
  info: (message: string) => void;
}

/**
 * Get hass entity unique id.
 * @param topic
 * @return {*}
 */
function getHassEntityId(topic) {
  return topic.replaceAll('/', '_');
}

/**
 * Get HA drydock device info.
 * @returns {*}
 */
function getHaDevice() {
  return {
    identifiers: [HASS_DEVICE_ID],
    manufacturer: HASS_MANUFACTURER,
    model: HASS_DEVICE_ID,
    name: HASS_DEVICE_NAME,
    sw_version: getVersion(),
  };
}

/**
 * Sanitize icon to meet hass requirements.
 * @param icon
 * @return {*}
 */
function sanitizeIcon(icon) {
  if (typeof icon !== 'string') {
    return '';
  }
  const normalized = icon.trim();
  if (!normalized || normalized.startsWith('http://') || normalized.startsWith('https://')) {
    return normalized;
  }
  return normalized
    .replace(/^mdi-/i, 'mdi:')
    .replace(/^fa-/i, 'fa:')
    .replace(/^fab-/i, 'fab:')
    .replace(/^far-/i, 'far:')
    .replace(/^fas-/i, 'fas:')
    .replace(/^hl-/i, 'hl:')
    .replace(/^sh-/i, 'sh:')
    .replace(/^si-/i, 'si:');
}

function normalizeIconSlug(slug: string, extension: string): string {
  const normalizedSlug = slug.trim().toLowerCase();
  const suffix = `.${extension}`;
  if (normalizedSlug.endsWith(suffix)) {
    return normalizedSlug.slice(0, -suffix.length);
  }
  return normalizedSlug;
}

function resolveEntityPicture(icon?: string): string {
  const sanitizedIcon = sanitizeIcon(icon);
  if (!sanitizedIcon) {
    return HASS_DEFAULT_ENTITY_PICTURE;
  }
  if (sanitizedIcon.startsWith('http://') || sanitizedIcon.startsWith('https://')) {
    return sanitizedIcon;
  }

  const iconMatch = sanitizedIcon.match(/^(sh|hl|si):(.+)$/i);
  if (!iconMatch) {
    return HASS_DEFAULT_ENTITY_PICTURE;
  }

  const provider = iconMatch[1].toLowerCase();
  const rawSlug = iconMatch[2];
  const cdnMap: Record<string, { ext: string; base: string }> = {
    sh: { ext: 'png', base: 'https://cdn.jsdelivr.net/gh/selfhst/icons/png' },
    hl: { ext: 'png', base: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/png' },
    si: { ext: 'svg', base: 'https://cdn.jsdelivr.net/npm/simple-icons@latest/icons' },
  };
  // Provider is guaranteed to be sh|hl|si by the regex above
  const cdn = cdnMap[provider];
  const slug = normalizeIconSlug(rawSlug, cdn.ext);
  return `${cdn.base}/${slug}.${cdn.ext}`;
}

function resolveEntityPictureOverride(container: {
  displayPicture?: string;
  labels?: Record<string, string>;
}): string | undefined {
  const configuredPicture =
    container.displayPicture ||
    container.labels?.['dd.display.picture'] ||
    container.labels?.['wud.display.picture'];
  if (typeof configuredPicture !== 'string') {
    return undefined;
  }
  const normalized = configuredPicture.trim();
  if (!normalized) {
    return undefined;
  }
  if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
    return undefined;
  }
  return normalized;
}

class Hass {
  client: HassClient;

  configuration: HassConfiguration;

  log: HassLogger;

  private containerStateTopicById = new Map<string, string>();

  private unregisterContainerAdded?: () => void;
  private unregisterContainerUpdated?: () => void;
  private unregisterContainerRemoved?: () => void;
  private unregisterWatcherStart?: () => void;
  private unregisterWatcherStop?: () => void;

  constructor({
    client,
    configuration,
    log,
  }: {
    client: HassClient;
    configuration: HassConfiguration;
    log: HassLogger;
  }) {
    this.client = client;
    this.configuration = configuration;
    this.log = log;

    // Subscribe to container events to sync HA
    this.unregisterContainerAdded = registerContainerAdded((container) =>
      this.addContainerSensor(container),
    );
    this.unregisterContainerUpdated = registerContainerUpdated((container) =>
      this.addContainerSensor(container),
    );
    this.unregisterContainerRemoved = registerContainerRemoved((container) =>
      this.removeContainerSensor(container),
    );

    // Subscribe to watcher events to sync HA
    this.unregisterWatcherStart = registerWatcherStart((watcher) =>
      this.updateWatcherSensors({ watcher, isRunning: true }),
    );
    this.unregisterWatcherStop = registerWatcherStop((watcher) =>
      this.updateWatcherSensors({ watcher, isRunning: false }),
    );
  }

  deregister() {
    this.unregisterContainerAdded?.();
    this.unregisterContainerAdded = undefined;

    this.unregisterContainerUpdated?.();
    this.unregisterContainerUpdated = undefined;

    this.unregisterContainerRemoved?.();
    this.unregisterContainerRemoved = undefined;

    this.unregisterWatcherStart?.();
    this.unregisterWatcherStart = undefined;

    this.unregisterWatcherStop?.();
    this.unregisterWatcherStop = undefined;

    this.containerStateTopicById.clear();
  }

  private getContainerId(container: { id?: unknown }) {
    if (typeof container?.id !== 'string' || container.id === '') {
      return undefined;
    }
    return container.id;
  }

  private getContainerStateTopicFromName({
    watcherName,
    containerName,
  }: {
    watcherName: string;
    containerName: string;
  }) {
    return `${this.configuration.topic}/${watcherName}/${containerName}`;
  }

  private getStaleContainerStateTopics({
    container,
    currentStateTopic,
  }: {
    container: { id?: unknown; name?: unknown; watcher?: unknown };
    currentStateTopic: string;
  }) {
    const staleStateTopics = new Set<string>();
    const watcherName = typeof container?.watcher === 'string' ? container.watcher : '';
    if (watcherName === '') {
      return [];
    }

    const containerId = this.getContainerId(container);
    if (containerId) {
      const trackedStateTopic = this.containerStateTopicById.get(containerId);
      if (trackedStateTopic && trackedStateTopic !== currentStateTopic) {
        staleStateTopics.add(trackedStateTopic);
      }
    }

    for (const staleContainerName of getStaleSanitizedContainerNameCandidates(container)) {
      const staleStateTopic = this.getContainerStateTopicFromName({
        watcherName,
        containerName: staleContainerName,
      });
      /* v8 ignore start -- defensive: stale candidates are always different from current topic */
      if (staleStateTopic !== currentStateTopic) {
        /* v8 ignore stop */
        staleStateTopics.add(staleStateTopic);
      }
    }

    return Array.from(staleStateTopics);
  }

  private getActiveContainerStateTopicsForWatcher({
    watcherName,
    excludingContainerId,
  }: {
    watcherName: string;
    excludingContainerId?: string;
  }) {
    if (watcherName === '') {
      return new Set<string>();
    }

    try {
      return new Set(
        containerStore
          .getContainers({ watcher: watcherName })
          .filter(
            (storedContainer) => this.getContainerId(storedContainer) !== excludingContainerId,
          )
          .map((storedContainer) => this.getContainerStateTopic({ container: storedContainer })),
      );
    } catch {
      return new Set<string>();
    }
  }

  private getTrackedContainerStateTopicsForWatcher({
    watcherName,
    excludingContainerId,
  }: {
    watcherName: string;
    excludingContainerId?: string;
  }) {
    if (watcherName === '') {
      return new Set<string>();
    }

    const watcherTopicPrefix = `${this.configuration.topic}/${watcherName}/`;
    return new Set(
      Array.from(this.containerStateTopicById.entries())
        .filter(([containerId]) => containerId !== excludingContainerId)
        .map(([, stateTopic]) => stateTopic)
        .filter((stateTopic) => stateTopic.startsWith(watcherTopicPrefix)),
    );
  }

  private async removeDiscoveryTopics({
    kind,
    stateTopics,
  }: {
    kind: string;
    stateTopics: string[];
  }) {
    for (const stateTopic of stateTopics) {
      await this.removeSensor({
        discoveryTopic: this.getDiscoveryTopic({
          kind,
          topic: stateTopic,
        }),
      });
    }
  }

  private trackContainerStateTopic(container: { id?: unknown }, stateTopic: string) {
    const containerId = this.getContainerId(container);
    if (!containerId) {
      return;
    }
    if (this.containerStateTopicById.has(containerId)) {
      this.containerStateTopicById.delete(containerId);
    }
    this.containerStateTopicById.set(containerId, stateTopic);
    this.enforceContainerStateTopicTrackLimit();
  }

  private enforceContainerStateTopicTrackLimit() {
    const overLimitBy = this.containerStateTopicById.size - HASS_CONTAINER_STATE_TOPIC_TRACK_LIMIT;
    if (overLimitBy <= 0) {
      return;
    }

    let removedEntries = 0;
    for (const trackedContainerId of this.containerStateTopicById.keys()) {
      this.containerStateTopicById.delete(trackedContainerId);
      removedEntries += 1;
      if (removedEntries >= overLimitBy) {
        break;
      }
    }
  }

  private clearTrackedContainerStateTopic(container: { id?: unknown }) {
    const containerId = this.getContainerId(container);
    if (!containerId) {
      return;
    }
    this.containerStateTopicById.delete(containerId);
  }

  /**
   * Add container sensor.
   * @param container
   * @returns {Promise<void>}
   */
  async addContainerSensor(container) {
    const containerStateSensor = {
      kind: 'update',
      topic: this.getContainerStateTopic({ container }),
    };
    const staleStateTopics = this.getStaleContainerStateTopics({
      container,
      currentStateTopic: containerStateSensor.topic,
    });
    const entityPictureOverride = resolveEntityPictureOverride(container);
    this.log.info(`Add hass container update sensor [${containerStateSensor.topic}]`);
    if (this.configuration.hass.discovery) {
      await this.removeDiscoveryTopics({
        kind: containerStateSensor.kind,
        stateTopics: staleStateTopics,
      });
      await this.publishDiscoveryMessage({
        discoveryTopic: this.getDiscoveryTopic({
          kind: containerStateSensor.kind,
          topic: containerStateSensor.topic,
        }),
        kind: containerStateSensor.kind,
        stateTopic: containerStateSensor.topic,
        name: container.displayName,
        icon: sanitizeIcon(container.displayIcon),
        entityPicture: entityPictureOverride,
        options: {
          force_update: true,
          value_template: HASS_ENTITY_VALUE_TEMPLATE,
          latest_version_topic: containerStateSensor.topic,
          latest_version_template: HASS_LATEST_VERSION_TEMPLATE,
          release_url: container.result ? container.result.link : undefined,
          json_attributes_topic: containerStateSensor.topic,
        },
      });
    }
    this.trackContainerStateTopic(container, containerStateSensor.topic);
    await this.updateContainerSensors(container);
  }

  /**
   * Remove container sensor.
   * @param container
   * @returns {Promise<void>}
   */
  async removeContainerSensor(container) {
    const containerStateSensor = {
      kind: 'update',
      topic: this.getContainerStateTopic({ container }),
    };
    const staleStateTopics = this.getStaleContainerStateTopics({
      container,
      currentStateTopic: containerStateSensor.topic,
    });
    const stateTopicsToRemove = [
      containerStateSensor.topic,
      ...staleStateTopics.filter((stateTopic) => stateTopic !== containerStateSensor.topic),
    ];
    this.log.info(`Remove hass container update sensor [${containerStateSensor.topic}]`);
    if (this.configuration.hass.discovery) {
      const watcherName = typeof container?.watcher === 'string' ? container.watcher : '';
      const excludingContainerId = this.getContainerId(container);
      const activeStateTopics = new Set<string>([
        ...this.getActiveContainerStateTopicsForWatcher({
          watcherName,
          excludingContainerId,
        }),
        ...this.getTrackedContainerStateTopicsForWatcher({
          watcherName,
          excludingContainerId,
        }),
      ]);
      await this.removeDiscoveryTopics({
        kind: containerStateSensor.kind,
        stateTopics: stateTopicsToRemove.filter((stateTopic) => !activeStateTopics.has(stateTopic)),
      });
    }
    this.clearTrackedContainerStateTopic(container);
    await this.updateContainerSensors(container);
  }

  async updateContainerSensors(container) {
    // Sensor topics and kinds
    const totalCountSensor = {
      kind: 'sensor',
      topic: `${this.configuration.topic}/total_count`,
    };
    const totalUpdateCountSensor = {
      kind: 'sensor',
      topic: `${this.configuration.topic}/update_count`,
    };
    const totalUpdateStatusSensor = {
      kind: 'binary_sensor',
      topic: `${this.configuration.topic}/update_status`,
    };
    const watcherTotalCountSensor = {
      kind: 'sensor',
      topic: `${this.configuration.topic}/${container.watcher}/total_count`,
    };
    const watcherUpdateCountSensor = {
      kind: 'sensor',
      topic: `${this.configuration.topic}/${container.watcher}/update_count`,
    };
    const watcherUpdateStatusSensor = {
      kind: 'binary_sensor',
      topic: `${this.configuration.topic}/${container.watcher}/update_status`,
    };

    // Discovery topics
    const totalCountDiscoveryTopic = this.getDiscoveryTopic({
      kind: totalCountSensor.kind,
      topic: totalCountSensor.topic,
    });
    const totalUpdateCountDiscoveryTopic = this.getDiscoveryTopic({
      kind: totalUpdateCountSensor.kind,
      topic: totalUpdateCountSensor.topic,
    });
    const totalUpdateStatusDiscoveryTopic = this.getDiscoveryTopic({
      kind: totalUpdateStatusSensor.kind,
      topic: totalUpdateStatusSensor.topic,
    });
    const watcherTotalCountDiscoveryTopic = this.getDiscoveryTopic({
      kind: watcherTotalCountSensor.kind,
      topic: watcherTotalCountSensor.topic,
    });
    const watcherUpdateCountDiscoveryTopic = this.getDiscoveryTopic({
      kind: watcherUpdateCountSensor.kind,
      topic: watcherUpdateCountSensor.topic,
    });
    const watcherUpdateStatusDiscoveryTopic = this.getDiscoveryTopic({
      kind: watcherUpdateStatusSensor.kind,
      topic: watcherUpdateStatusSensor.topic,
    });

    // Publish discovery messages
    if (this.configuration.hass.discovery) {
      await this.publishDiscoveryMessage({
        discoveryTopic: totalCountDiscoveryTopic,
        stateTopic: totalCountSensor.topic,
        kind: totalCountSensor.kind,
        name: 'Total container count',
      });
      await this.publishDiscoveryMessage({
        discoveryTopic: totalUpdateCountDiscoveryTopic,
        stateTopic: totalUpdateCountSensor.topic,
        kind: totalUpdateCountSensor.kind,
        name: 'Total container update count',
      });
      await this.publishDiscoveryMessage({
        discoveryTopic: totalUpdateStatusDiscoveryTopic,
        stateTopic: totalUpdateStatusSensor.topic,
        kind: totalUpdateStatusSensor.kind,
        name: 'Total container update status',
        options: {
          payload_on: true.toString(),
          payload_off: false.toString(),
        },
      });
      await this.publishDiscoveryMessage({
        discoveryTopic: watcherTotalCountDiscoveryTopic,
        stateTopic: watcherTotalCountSensor.topic,
        kind: watcherTotalCountSensor.kind,
        name: `Watcher ${container.watcher} container count`,
      });
      await this.publishDiscoveryMessage({
        discoveryTopic: watcherUpdateCountDiscoveryTopic,
        stateTopic: watcherUpdateCountSensor.topic,
        kind: watcherUpdateCountSensor.kind,
        name: `Watcher ${container.watcher} container update count`,
      });
      await this.publishDiscoveryMessage({
        discoveryTopic: watcherUpdateStatusDiscoveryTopic,
        stateTopic: watcherUpdateStatusSensor.topic,
        kind: watcherUpdateStatusSensor.kind,
        name: `Watcher ${container.watcher} container update status`,
        options: {
          payload_on: true.toString(),
          payload_off: false.toString(),
        },
      });
    }

    // Count all containers
    const totalCount = containerStore.getContainerCount();
    const updateCount = containerStore.getContainerCount({
      updateAvailable: true,
    });

    // Count all containers belonging to the current watcher
    const watcherTotalCount = containerStore.getContainerCount({
      watcher: container.watcher,
    });
    const watcherUpdateCount = containerStore.getContainerCount({
      watcher: container.watcher,
      updateAvailable: true,
    });

    // Publish sensors
    await this.updateSensor({
      topic: totalCountSensor.topic,
      value: totalCount,
    });
    await this.updateSensor({
      topic: totalUpdateCountSensor.topic,
      value: updateCount,
    });
    await this.updateSensor({
      topic: totalUpdateStatusSensor.topic,
      value: updateCount > 0,
    });
    await this.updateSensor({
      topic: watcherTotalCountSensor.topic,
      value: watcherTotalCount,
    });
    await this.updateSensor({
      topic: watcherUpdateCountSensor.topic,
      value: watcherUpdateCount,
    });
    await this.updateSensor({
      topic: watcherUpdateStatusSensor.topic,
      value: watcherUpdateCount > 0,
    });

    // Delete watcher sensors when watcher does not exist anymore
    if (watcherTotalCount === 0 && this.configuration.hass.discovery) {
      await this.removeSensor({
        discoveryTopic: watcherTotalCountDiscoveryTopic,
      });
      await this.removeSensor({
        discoveryTopic: watcherUpdateCountDiscoveryTopic,
      });
      await this.removeSensor({
        discoveryTopic: watcherUpdateStatusDiscoveryTopic,
      });
    }
  }

  async updateWatcherSensors({ watcher, isRunning }) {
    const watcherStatusSensor = {
      kind: 'binary_sensor',
      topic: `${this.configuration.topic}/${watcher.name}/running`,
    };
    const watcherStatusDiscoveryTopic = this.getDiscoveryTopic({
      kind: watcherStatusSensor.kind,
      topic: watcherStatusSensor.topic,
    });

    // Publish discovery messages
    if (this.configuration.hass.discovery) {
      await this.publishDiscoveryMessage({
        discoveryTopic: watcherStatusDiscoveryTopic,
        stateTopic: watcherStatusSensor.topic,
        kind: watcherStatusSensor.kind,
        options: {
          payload_on: true.toString(),
          payload_off: false.toString(),
        },
        name: `Watcher ${watcher.name} running status`,
      });
    }

    // Publish sensors
    await this.updateSensor({
      topic: watcherStatusSensor.topic,
      value: isRunning,
    });
  }

  /**
   * Publish a discovery message.
   * @param discoveryTopic
   * @param stateTopic
   * @param kind
   * @param name
   * @param icon
   * @param entityPicture
   * @param options
   * @returns {Promise<*>}
   */
  async publishDiscoveryMessage({
    discoveryTopic,
    stateTopic,
    kind,
    name,
    icon,
    entityPicture,
    options = {},
  }: {
    discoveryTopic: string;
    stateTopic: string;
    kind: string;
    name: string;
    icon?: string;
    entityPicture?: string;
    options?: Record<string, unknown>;
  }) {
    const entityId = getHassEntityId(stateTopic);
    return this.client.publish(
      discoveryTopic,
      JSON.stringify({
        unique_id: entityId,
        default_entity_id: `${kind}.${entityId}`,
        name: name || entityId,
        device: getHaDevice(),
        icon: icon || sanitizeIcon('mdi:docker'),
        entity_picture: entityPicture || resolveEntityPicture(icon),
        state_topic: stateTopic,
        ...options,
      }),
      {
        retain: true,
      },
    );
  }

  /**
   * Publish an empty message to discovery topic to remove the sensor.
   * @param discoveryTopic
   * @returns {Promise<*>}
   */
  async removeSensor({ discoveryTopic }) {
    return this.client.publish(discoveryTopic, '', {
      retain: true,
    });
  }

  /**
   * Publish a sensor message.
   * @param topic
   * @param value
   * @returns {Promise<*>}
   */
  async updateSensor({ topic, value }) {
    return this.client.publish(topic, value.toString(), { retain: true });
  }

  /**
   * Get container state topic.
   * @param container
   * @return {string}
   */
  getContainerStateTopic({ container }) {
    return this.getContainerStateTopicFromName({
      watcherName: container.watcher,
      containerName: getSanitizedCanonicalContainerName(container),
    });
  }

  /**
   * Get discovery topic for an entity topic.
   * @param kind
   * @param topic
   * @returns {string}
   */
  getDiscoveryTopic({ kind, topic }) {
    return `${this.configuration.hass.prefix}/${kind}/${getHassEntityId(topic)}/config`;
  }
}

export default Hass;
