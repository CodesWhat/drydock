import type { MqttClient } from 'mqtt';
import { recordAuditEvent } from '../../../api/audit-events.js';
import { getVersion } from '../../../configuration/index.js';
import { getPreferredLabelValue } from '../../../docker/legacy-label.js';
import {
  registerContainerAdded,
  registerContainerRemoved,
  registerContainerUpdated,
  registerWatcherStart,
  registerWatcherStop,
} from '../../../event/index.js';
import type { Container } from '../../../model/container.js';
import * as containerStore from '../../../store/container.js';
import { requestContainerUpdate, UpdateRequestError } from '../../../updates/request-update.js';
import { HassCommandRateLimiter } from './hass-command-rate-limiter.js';
import {
  getHassCommandTopicFilters,
  getHassCommandTopicFromStateTopic,
  getStateTopicFromCommandTopic,
  HASS_COMMAND_QOS,
  HASS_INSTALL_PAYLOAD,
  isHassInstallPayload,
  resolveHassCommandContainer,
} from './hass-commands.js';
import {
  getSanitizedCanonicalContainerName,
  getStaleSanitizedContainerNameCandidates,
} from './naming.js';

const HASS_DEVICE_ID = 'drydock';
const HASS_DEVICE_NAME = 'drydock';
const HASS_MANUFACTURER = 'drydock';
const HASS_ENTITY_VALUE_TEMPLATE = '{{ value_json.image_tag_value }}';
// Newest version. When no update is pending, container.result is absent, so
// result_tag/result_digest never appear in the flattened payload. Fall back to
// the installed tag (image_tag_value) so HA resolves latest == installed ("up to
// date") instead of rendering an empty string — which HA silently discards,
// leaving both "Newest version" and the entity state permanently Unknown (#491).
// The `if value_json.result_digest` guard also avoids the `Undefined[:15]` slice
// error HA's Jinja throws when a digest-kind report carries no result_digest.
const HASS_LATEST_VERSION_TEMPLATE =
  '{% if value_json.update_kind_kind == "digest" %}{{ value_json.result_digest[:15] if value_json.result_digest else value_json.image_tag_value }}{% else %}{{ value_json.result_tag if value_json.result_tag else value_json.image_tag_value }}{% endif %}';
const HASS_DEFAULT_ENTITY_PICTURE =
  'https://raw.githubusercontent.com/CodesWhat/drydock/main/docs/assets/whale-logo.png';
export const HASS_CONTAINER_STATE_TOPIC_TRACK_LIMIT = 10_000;
// #210 — per-container hardcoded v1 rate limit for hass install commands
const HASS_COMMAND_RATE_LIMIT_MS = 30_000;

interface HassClient {
  publish: (
    topic: string,
    message: string,
    options?: {
      retain?: boolean;
    },
  ) => Promise<unknown> | unknown;
  // #210 — optional: only the real mqtt.MqttClient (or a fully-capable test
  // double) needs to satisfy these; hass.commands=false should not force
  // every caller's client to support subscriptions.
  subscribeAsync?: (topic: string | string[], opts?: { qos?: 0 | 1 | 2 }) => Promise<unknown>;
  unsubscribeAsync?: (topic: string | string[]) => Promise<unknown>;
  on?: (
    event: 'message',
    listener: (topic: string, payload: Buffer, packet: { retain: boolean }) => void,
  ) => unknown;
  removeListener?: (
    event: 'message',
    listener: (topic: string, payload: Buffer, packet: { retain: boolean }) => void,
  ) => unknown;
}

// #210 — the subset of the real mqtt.MqttClient needed to run hass install commands
type HassCommandCapableClient = HassClient &
  Pick<MqttClient, 'subscribeAsync' | 'unsubscribeAsync' | 'on' | 'removeListener'>;

function hasHassCommandCapableClient(client: HassClient): client is HassCommandCapableClient {
  const c = client as Partial<HassCommandCapableClient>;
  return (
    typeof c.subscribeAsync === 'function' &&
    typeof c.unsubscribeAsync === 'function' &&
    typeof c.on === 'function' &&
    typeof c.removeListener === 'function'
  );
}

interface HassConfiguration {
  topic: string;
  hass: {
    prefix: string;
    discovery: boolean;
    agenttopicsegment?: boolean;
    commands?: boolean;
  };
}

// #386 — replicated from Docker.ts (not exported there)
function normalizeAgentValue(agent: unknown): string | undefined {
  if (typeof agent !== 'string') {
    return undefined;
  }
  return agent === '' ? undefined : agent;
}

// Deprecation: "Agent-less Home Assistant MQTT topic layout (multi-agent)"
// (DEPRECATIONS.md) — warn once per watcher name when the agent-less layout
// is actually in collision (>1 distinct agent sharing the watcher name)
// rather than on every use, since single-node deployments are unaffected.
const warnedAgentlessHassTopicLayoutWatchers = new Set<string>();

interface HassLogger {
  info: (message: string) => void;
  warn: (message: string) => void;
  debug: (message: string) => void;
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

function resolveEntityPictureOverride(
  container: {
    displayPicture?: string;
    labels?: Record<string, string>;
  },
  warn?: (message: string) => void,
): string | undefined {
  // This call site previously read `dd.display.picture || wud.display.picture`,
  // which falls through to the wud.* label on an explicit empty dd.* value
  // (e.g. an unset compose-file env-substitution default), not just when
  // dd.* is absent. treatEmptyAsAbsent preserves that behavior so a
  // container that still relies on wud.display.picture doesn't silently
  // lose it.
  const configuredPicture =
    container.displayPicture ||
    getPreferredLabelValue(container.labels, 'dd.display.picture', 'wud.display.picture', {
      warn,
      treatEmptyAsAbsent: true,
    });
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

  private isContainerAllowed: (container: Container) => boolean;

  // #491 — containers excluded from the trigger (mustTrigger()=false) must
  // not keep a stale discovery entity around. Tracks which excluded
  // containers have already had their sensor cleaned up, so a repeat
  // containerAdded/containerUpdated event for the same still-excluded
  // container does not re-publish the (empty) removal payload on every
  // watch cycle. Cleared when the container is re-included so a later
  // re-exclusion cleans again.
  private cleanedExcludedContainerKeys = new Set<string>();

  private unregisterContainerAdded?: () => void;
  private unregisterContainerUpdated?: () => void;
  private unregisterContainerRemoved?: () => void;
  private unregisterWatcherStart?: () => void;
  private unregisterWatcherStop?: () => void;

  // #210
  private commandTopicFilters?: string[];
  private commandMessageHandler?: (
    topic: string,
    payload: Buffer,
    packet: { retain: boolean },
  ) => void;
  private commandRateLimiter = new HassCommandRateLimiter({
    minIntervalMs: HASS_COMMAND_RATE_LIMIT_MS,
  });
  // #210 — true only while a command subscription is actually live. The
  // discovery payload gates the Install button on this (not just the config
  // flag) so we never advertise a button we are not listening for — e.g. a
  // publish-only broker ACL where subscribeAsync rejects.
  private commandSubscriptionActive = false;

  constructor({
    client,
    configuration,
    log,
    isContainerAllowed,
  }: {
    client: HassClient;
    configuration: HassConfiguration;
    log: HassLogger;
    isContainerAllowed: (container: Container) => boolean;
  }) {
    this.client = client;
    this.configuration = configuration;
    this.log = log;
    this.isContainerAllowed = isContainerAllowed;

    // Subscribe to container events to sync HA
    this.unregisterContainerAdded = registerContainerAdded((container) =>
      this.syncContainerSensor(container),
    );
    this.unregisterContainerUpdated = registerContainerUpdated((container) =>
      this.syncContainerSensor(container),
    );
    this.unregisterContainerRemoved = registerContainerRemoved((container) => {
      // #491 — a re-included container starts clean again, so drop its key
      // here too (not just on re-inclusion in syncContainerSensor).
      this.cleanedExcludedContainerKeys.delete(this.getContainerSyncKey(container));
      return this.removeContainerSensor(container);
    });

    // Subscribe to watcher events to sync HA
    this.unregisterWatcherStart = registerWatcherStart((watcher) =>
      this.updateWatcherSensors({ watcher, isRunning: true }),
    );
    this.unregisterWatcherStop = registerWatcherStop((watcher) =>
      this.updateWatcherSensors({ watcher, isRunning: false }),
    );
  }

  async deregister(): Promise<void> {
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

    // #210 — unwind the command subscription, if one was ever established
    if (this.commandMessageHandler && hasHassCommandCapableClient(this.client)) {
      this.client.removeListener('message', this.commandMessageHandler);
    }
    this.commandMessageHandler = undefined;

    if (this.commandTopicFilters && hasHassCommandCapableClient(this.client)) {
      try {
        await this.client.unsubscribeAsync(this.commandTopicFilters);
      } catch (error: unknown) {
        this.log.warn(
          `Failed to unsubscribe hass command topics (${error instanceof Error ? error.message : String(error)})`,
        );
      }
    }
    this.commandTopicFilters = undefined;
    this.commandSubscriptionActive = false;
    this.commandRateLimiter.clear();

    this.containerStateTopicById.clear();
    this.cleanedExcludedContainerKeys.clear();
  }

  /**
   * Subscribe to the fixed-depth hass install-command topic filters. No-op
   * when `hass.commands` is off, or when the configured client does not
   * support subscriptions (e.g. `hass.enabled=true` with a publish-only
   * client). Called explicitly by Mqtt.ts after constructing this instance —
   * not from the constructor — so a broker ACL that denies subscribe (but
   * allows publish) degrades to "commands don't work" instead of failing
   * `initTrigger()` outright.
   * @returns {Promise<void>}
   */
  async initCommandSubscription(): Promise<void> {
    if (!this.configuration.hass.commands) {
      return;
    }
    if (!hasHassCommandCapableClient(this.client)) {
      this.log.warn(
        'Home Assistant install commands are enabled but the MQTT client does not support subscriptions; skipping.',
      );
      return;
    }
    try {
      this.commandMessageHandler = (topic, payload, packet) => {
        void this.handleCommandMessage(topic, payload, packet).catch((error: Error) => {
          this.log.warn(`Error handling hass command message on [${topic}] (${error.message})`);
        });
      };
      this.client.on('message', this.commandMessageHandler);
      const filters = getHassCommandTopicFilters(this.configuration.topic);
      await this.client.subscribeAsync(filters, { qos: HASS_COMMAND_QOS });
      this.commandTopicFilters = filters;
      this.commandSubscriptionActive = true;
    } catch (error: unknown) {
      this.log.warn(
        `Failed to subscribe to Home Assistant command topics (${error instanceof Error ? error.message : String(error)})`,
      );
      if (this.commandMessageHandler && hasHassCommandCapableClient(this.client)) {
        this.client.removeListener('message', this.commandMessageHandler);
      }
      this.commandMessageHandler = undefined;
      this.commandSubscriptionActive = false;
    }
  }

  /**
   * Handle an inbound hass install-command message. Resolves the state topic
   * back to a live container via a fresh `containerStore.getContainers({})`
   * scan (see #210 plan Gotcha B — the event-driven `containerStateTopicById`
   * cache is deliberately not reused here, since it starts empty on every
   * trigger re-init and would silently drop commands until the next full
   * watch cycle) and, on a clean resolve, delegates to the same
   * `requestContainerUpdate()` used by the webhook trigger.
   * @param topic
   * @param payload
   * @param packet
   * @returns {Promise<void>}
   */
  private async handleCommandMessage(
    topic: string,
    payload: Buffer,
    packet: { retain: boolean },
  ): Promise<void> {
    if (packet.retain) {
      this.log.debug(`Ignoring retained hass command message on [${topic}]`);
      return;
    }
    const stateTopic = getStateTopicFromCommandTopic(topic, this.configuration.topic);
    if (!stateTopic) {
      return;
    }
    if (!isHassInstallPayload(payload)) {
      this.log.debug(`Ignoring hass command message on [${topic}] with unexpected payload`);
      return;
    }

    // Explicit `Container` annotation on the callback param pins the generic
    // inference for `resolveHassCommandContainer<C>` — `getContainers()`'s
    // return type is itself inferred (no explicit annotation upstream in
    // store/container.ts), and leaving this callback's parameter untyped
    // causes TS to fall back to `C = unknown` here.
    const resolution = resolveHassCommandContainer(
      containerStore.getContainers({}),
      stateTopic,
      (container: Container) => this.getContainerStateTopic({ container }),
    );
    if (resolution.status === 'not-found') {
      this.log.debug(`No tracked container for hass command topic [${topic}]`);
      return;
    }
    if (resolution.status === 'ambiguous') {
      this.log.warn(
        `Ambiguous hass command topic [${topic}] matches ${resolution.containers.length} containers; ignoring.`,
      );
      return;
    }

    const container = resolution.container;
    // #491 — a container excluded from this trigger (mustTrigger()=false)
    // never gets a discovery entity/state publish, so an Install command
    // addressed to it must not drive an update either.
    if (!this.isContainerAllowed(container)) {
      this.log.warn(
        `Ignoring hass install command for [${container.name}]: container is excluded from this trigger`,
      );
      return;
    }
    const rateLimitKey = this.getContainerId(container) ?? stateTopic;
    if (!this.commandRateLimiter.tryConsume(rateLimitKey)) {
      this.log.warn(`Ignoring hass command for [${container.name}]: rate limited`);
      return;
    }

    try {
      const accepted = await requestContainerUpdate(container);
      this.log.info(
        `Accepted hass install command for container [${container.name}] (operation ${accepted.operationId})`,
      );
      recordAuditEvent({
        action: 'mqtt-command-update',
        container,
        status: 'success',
        details: `operation ${accepted.operationId}`,
      });
    } catch (error: unknown) {
      if (error instanceof UpdateRequestError) {
        this.log.info(
          `Hass install command rejected for container [${container.name}] (${error.message})`,
        );
        recordAuditEvent({
          action: 'mqtt-command-update',
          container,
          status: 'error',
          details: error.message,
        });
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.log.warn(
        `Unexpected error handling hass install command for container [${container.name}] (${message})`,
      );
      recordAuditEvent({
        action: 'mqtt-command-update',
        container,
        status: 'error',
        details: 'Unexpected error',
      });
    }
  }

  private getContainerId(container: { id?: unknown }) {
    if (typeof container?.id !== 'string' || container.id === '') {
      return undefined;
    }
    return container.id;
  }

  // #491 — a stable per-container key for cleanedExcludedContainerKeys.
  // Falls back to the state topic when the container has no id (mirrors
  // the rate-limit key fallback in handleCommandMessage).
  private getContainerSyncKey(container): string {
    return this.getContainerId(container) ?? this.getContainerStateTopic({ container });
  }

  private getContainerStateTopicFromName({
    watcherName,
    containerName,
    agentName,
  }: {
    watcherName: string;
    containerName: string;
    agentName?: string;
  }) {
    return `${this.getWatcherTopicPrefix({ watcherName, agentName })}/${containerName}`;
  }

  private getWatcherTopicPrefix({
    watcherName,
    agentName,
  }: {
    watcherName: string;
    agentName?: string;
  }) {
    // #386 — insert agent segment only when flag is on and agent is non-empty
    if (this.configuration.hass.agenttopicsegment && agentName) {
      return `${this.configuration.topic}/agent/${agentName}/${watcherName}`;
    }
    return `${this.configuration.topic}/${watcherName}`;
  }

  private getStaleContainerStateTopics({
    container,
    currentStateTopic,
  }: {
    container: { id?: unknown; name?: unknown; watcher?: unknown; agent?: unknown };
    currentStateTopic: string;
  }) {
    const staleStateTopics = new Set<string>();
    const watcherName = typeof container?.watcher === 'string' ? container.watcher : '';
    if (watcherName === '') {
      return [];
    }

    // #386 — pass agent so stale topics use the same namespace as the current one
    const agentName = normalizeAgentValue(container?.agent);

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
        agentName,
      });
      if (staleStateTopic !== currentStateTopic) {
        staleStateTopics.add(staleStateTopic);
      }
    }

    return Array.from(staleStateTopics);
  }

  private getActiveContainerStateTopicsForWatcher({
    watcherName,
    excludingContainerId,
    agentValue,
  }: {
    watcherName: string;
    excludingContainerId?: string;
    agentValue?: string | undefined;
  }) {
    if (watcherName === '') {
      return new Set<string>();
    }

    try {
      return new Set<string>(
        containerStore
          .getContainers({ watcher: watcherName })
          .filter(
            (storedContainer) => this.getContainerId(storedContainer) !== excludingContainerId,
          )
          // #386 — when flag is on, only match containers belonging to the same agent
          .filter((storedContainer) => {
            if (!this.configuration.hass.agenttopicsegment) {
              return true;
            }
            return normalizeAgentValue(storedContainer.agent) === normalizeAgentValue(agentValue);
          })
          .map((storedContainer) => this.getContainerStateTopic({ container: storedContainer })),
      );
    } catch {
      return new Set<string>();
    }
  }

  private getTrackedContainerStateTopicsForWatcher({
    watcherName,
    excludingContainerId,
    agentValue,
  }: {
    watcherName: string;
    excludingContainerId?: string;
    agentValue?: string | undefined;
  }): Set<string> {
    if (watcherName === '') {
      return new Set<string>();
    }

    const agentName = this.configuration.hass.agenttopicsegment
      ? normalizeAgentValue(agentValue)
      : undefined;
    const watcherTopicPrefix = `${this.getWatcherTopicPrefix({ watcherName, agentName })}/`;

    return new Set<string>(
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

  // #386 / DEPRECATIONS.md "Agent-less Home Assistant MQTT topic layout" —
  // warn once per watcher name the first time we observe more than one
  // distinct agent sharing it while the corrected (agent-segmented) layout
  // is not enabled, since that is exactly the case where topics/sensors
  // collide across agents.
  private warnIfAgentlessHassTopicLayoutCollides(container: { watcher?: unknown }) {
    if (this.configuration.hass.agenttopicsegment) {
      return;
    }
    const watcherName = typeof container?.watcher === 'string' ? container.watcher : '';
    if (!watcherName || warnedAgentlessHassTopicLayoutWatchers.has(watcherName)) {
      return;
    }
    const distinctAgents = new Set(
      containerStore
        .getContainers({ watcher: watcherName })
        .map((c) => normalizeAgentValue(c.agent) ?? ''),
    );
    if (distinctAgents.size <= 1) {
      return;
    }
    warnedAgentlessHassTopicLayoutWatchers.add(watcherName);
    this.log.warn(
      `Multiple agents share watcher name "${watcherName}" but the Home Assistant MQTT topic layout has no agent segment, so their topics/sensors will collide. Set DD_NOTIFICATION_MQTT_<name>_HASS_AGENTTOPICSEGMENT=true to opt into the corrected layout before it becomes the default in v1.7.0.`,
    );
  }

  /**
   * Sync a container's hass sensor with this trigger's mustTrigger gating
   * (rollback/agent scoping plus dd.notification.include/exclude). A
   * container the trigger does not cover must not get a discovery entity
   * whose state topic never receives a publish — that leaves a permanent
   * "Unknown" ghost entity in HA (#491). Any entity created before the
   * container became excluded (including one retained in HA from a
   * previous run) is cleaned up the first time the container is seen here.
   * @param container
   * @returns {Promise<void>}
   */
  private syncContainerSensor(container) {
    if (this.isContainerAllowed(container)) {
      this.cleanedExcludedContainerKeys.delete(this.getContainerSyncKey(container));
      return this.addContainerSensor(container);
    }

    const containerKey = this.getContainerSyncKey(container);
    if (this.cleanedExcludedContainerKeys.has(containerKey)) {
      this.log.debug(
        `Skip hass sensor sync for excluded container [${this.getContainerStateTopic({ container })}]`,
      );
      return;
    }
    this.cleanedExcludedContainerKeys.add(containerKey);
    return this.removeContainerSensor(container);
  }

  /**
   * Add container sensor.
   * @param container
   * @returns {Promise<void>}
   */
  async addContainerSensor(container) {
    this.warnIfAgentlessHassTopicLayoutCollides(container);
    const containerStateSensor = {
      kind: 'update',
      topic: this.getContainerStateTopic({ container }),
    };
    const staleStateTopics = this.getStaleContainerStateTopics({
      container,
      currentStateTopic: containerStateSensor.topic,
    });
    const entityPictureOverride = resolveEntityPictureOverride(container, (message) =>
      this.log.warn(message),
    );
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
          // #210 — advertise the Install button ONLY when a command subscription
          // is actually live (commandSubscriptionActive), not merely when the config
          // flag is on: otherwise a broker that rejects subscribe would leave a
          // clickable button whose clicks go to a topic we never listen on.
          // command_topic and payload_install are always published together (HA has
          // no default for payload_install, so command_topic alone renders a broken
          // button); retain/qos are pinned explicitly since users can override them.
          ...(this.configuration.hass.commands && this.commandSubscriptionActive
            ? {
                command_topic: getHassCommandTopicFromStateTopic(containerStateSensor.topic),
                payload_install: HASS_INSTALL_PAYLOAD,
                qos: HASS_COMMAND_QOS,
                retain: false,
              }
            : {}),
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
    if (this.configuration.hass.discovery) {
      const watcherName = typeof container?.watcher === 'string' ? container.watcher : '';
      const excludingContainerId = this.getContainerId(container);
      const replacementExpected = container?.replacementExpected === true;
      // #386 — forward agent so cleanup is scoped to the same agent namespace
      const agentValue = normalizeAgentValue(container?.agent);
      const activeFromStore = this.getActiveContainerStateTopicsForWatcher({
        watcherName,
        excludingContainerId,
        agentValue,
      });
      const trackedLocally = this.getTrackedContainerStateTopicsForWatcher({
        watcherName,
        excludingContainerId,
        agentValue,
      });
      const activeStateTopics = new Set<string>();
      for (const topic of activeFromStore) activeStateTopics.add(topic);
      for (const topic of trackedLocally) activeStateTopics.add(topic);
      const discoveryStateTopicsToRemove = stateTopicsToRemove.filter((stateTopic) => {
        if (replacementExpected && stateTopic === containerStateSensor.topic) {
          return false;
        }
        return !activeStateTopics.has(stateTopic);
      });
      const staleAliasTopicsToRemove = discoveryStateTopicsToRemove.filter(
        (stateTopic) => stateTopic !== containerStateSensor.topic,
      );

      if (discoveryStateTopicsToRemove.includes(containerStateSensor.topic)) {
        this.log.info(`Remove hass container update sensor [${containerStateSensor.topic}]`);
      } else if (staleAliasTopicsToRemove.length > 0) {
        this.log.info(
          `Preserve canonical hass container update sensor [${containerStateSensor.topic}]; removing stale alias topics [${staleAliasTopicsToRemove.join(', ')}]`,
        );
      } else {
        this.log.info(`Skip hass container update sensor removal [${containerStateSensor.topic}]`);
      }

      await this.removeDiscoveryTopics({
        kind: containerStateSensor.kind,
        stateTopics: discoveryStateTopicsToRemove,
      });
    }
    this.clearTrackedContainerStateTopic(container);
    await this.updateContainerSensors(container);
  }

  async updateContainerSensors(container) {
    const containerAgentName = normalizeAgentValue(container?.agent);
    const watcherSensorPrefix = this.getWatcherTopicPrefix({
      watcherName: container.watcher,
      agentName: containerAgentName,
    });

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
      topic: `${watcherSensorPrefix}/total_count`,
    };
    const watcherUpdateCountSensor = {
      kind: 'sensor',
      topic: `${watcherSensorPrefix}/update_count`,
    };
    const watcherUpdateStatusSensor = {
      kind: 'binary_sensor',
      topic: `${watcherSensorPrefix}/update_status`,
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

    // Count all containers belonging to the current watcher (scoped by agent when flag is on)
    let watcherTotalCount: number;
    let watcherUpdateCount: number;
    if (this.configuration.hass.agenttopicsegment) {
      // #386 — filter by agent to avoid cross-agent contamination on shared watcher names
      const watcherContainers = containerStore
        .getContainers({ watcher: container.watcher })
        .filter((c) => normalizeAgentValue(c.agent) === containerAgentName);
      watcherTotalCount = watcherContainers.length;
      watcherUpdateCount = watcherContainers.filter((c) => c.updateAvailable).length;
    } else {
      watcherTotalCount = containerStore.getContainerCount({
        watcher: container.watcher,
      });
      watcherUpdateCount = containerStore.getContainerCount({
        watcher: container.watcher,
        updateAvailable: true,
      });
    }

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
    const watcherStatusTopicPrefix = this.getWatcherTopicPrefix({
      watcherName: watcher.name,
      agentName: normalizeAgentValue(watcher?.agent),
    });
    const watcherStatusSensor = {
      kind: 'binary_sensor',
      topic: `${watcherStatusTopicPrefix}/running`,
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
      agentName: normalizeAgentValue(container?.agent),
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
