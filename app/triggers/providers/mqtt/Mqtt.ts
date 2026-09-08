import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import mqtt, { type IClientOptions, type MqttClient } from 'mqtt';
import {
  registerContainerAdded,
  registerContainerUpdated,
  registerUpdateOperationChanged,
  type UpdateOperationChangedEventPayload,
} from '../../../event/index.js';
import { flatten } from '../../../model/container.js';
import { resolveConfiguredPath } from '../../../runtime/paths.js';
import * as containerStore from '../../../store/container.js';
import * as updateOperationStore from '../../../store/update-operation.js';
import { getErrorMessage } from '../../../util/error.js';
import Trigger, { type TriggerConfiguration } from '../Trigger.js';
import {
  filterContainer,
  filterContainerInclude,
  HASS_ATTRIBUTE_PRESET_VALUES,
  HASS_ATTRIBUTE_PRESETS,
  type HassAttributePreset,
} from './filter.js';
import Hass from './Hass.js';
import {
  buildHassUpdateState,
  getHassUpdateProgress,
  HASS_UPDATE_STATE_KEY,
} from './hass-progress.js';
import { getContainerStateTopic } from './topics.js';

const containerDefaultTopic = 'dd/container';
const hassDefaultPrefix = 'homeassistant';
const hassAgentTopicSegmentDefault = true;
// roadmap 7.8 (#210) — one HA device per watched container, nested under the
// drydock device via `via_device`. Default-on for v1.8; `false` restores the
// pre-v1.8 layout where every entity hangs off the single drydock device.
const hassDevicePerContainerDefault = true;

function generateClientId() {
  return `dd_${randomBytes(4).toString('hex')}`;
}

interface MqttConfiguration extends TriggerConfiguration {
  url: string;
  topic: string;
  clientid: string;
  user?: string;
  password?: string;
  exclude: string;
  hass: {
    enabled: boolean;
    prefix: string;
    discovery: boolean;
    agenttopicsegment: boolean;
    commands: boolean;
    devicepercontainer: boolean;
    attributes: HassAttributePreset;
    filter: {
      include: string;
      exclude: string;
    };
  };
  tls: {
    clientkey?: string;
    clientcert?: string;
    cachain?: string;
    rejectunauthorized: boolean;
  };
}

interface MqttFilterConfig {
  mode: 'include' | 'exclude';
  stage: 'container' | 'flattened';
  paths: string[];
}

function splitFilterPaths(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(',')
    .map((path) => path.trim())
    .filter(Boolean);
}

/**
 * MQTT Trigger implementation
 */
class Mqtt extends Trigger<MqttConfiguration> {
  public configuration: MqttConfiguration = {
    url: '',
    topic: containerDefaultTopic,
    clientid: '',
    exclude: '',
    hass: {
      enabled: false,
      prefix: hassDefaultPrefix,
      discovery: false,
      agenttopicsegment: hassAgentTopicSegmentDefault,
      commands: false,
      devicepercontainer: hassDevicePerContainerDefault,
      attributes: 'short',
      filter: {
        include: '',
        exclude: '',
      },
    },
    tls: {
      rejectunauthorized: true,
    },
  };
  private client!: MqttClient;
  private hass?: Hass;
  private unregisterContainerAdded?: () => void;
  private unregisterContainerUpdated?: () => void;
  private unregisterUpdateOperationChanged?: () => void;

  private clearContainerEventSubscriptions() {
    this.unregisterContainerAdded?.();
    this.unregisterContainerAdded = undefined;

    this.unregisterContainerUpdated?.();
    this.unregisterContainerUpdated = undefined;

    this.unregisterUpdateOperationChanged?.();
    this.unregisterUpdateOperationChanged = undefined;
  }

  handleContainerEvent(container) {
    if (!this.mustTrigger(container)) {
      return;
    }
    void this.trigger(container).catch((error) => {
      this.log.warn(`Error (${error.message})`);
      this.log.debug(error);
    });
  }

  /**
   * Republish a container's state payload when its update operation changes phase, so
   * the Home Assistant `update` entity's progress bar advances during an install and
   * clears itself the moment the operation reaches a terminal state (#210). Without
   * this the entity only refreshes on the watcher's next scan, which is why pressing
   * Install used to show nothing at all until the update was already over.
   *
   * The operation's own status and phase are deliberately not read from the event.
   * `trigger()` re-derives progress from the operation store on every publish, so this
   * handler only has to say "this container changed, publish it again" — one code path
   * produces the payload whichever event brought us here.
   */
  handleUpdateOperationChangedEvent(payload: UpdateOperationChangedEventPayload) {
    const container = this.resolveUpdateOperationContainer(payload);
    if (!container) {
      this.log.debug(
        `No stored container for update operation ${payload.operationId} (${payload.containerName}); skipping progress publish`,
      );
      return;
    }
    this.handleContainerEvent(container);
  }

  /**
   * Resolve the event back to the container row the state topic is built from.
   *
   * `newContainerId` comes first: once a local-Docker recreate has created the
   * replacement, the original id no longer exists in the store, and the terminal event
   * for a successful update is exactly the one that must land. A miss here costs a
   * delayed clear, not a stuck one — the watcher's next scan republishes the container
   * and `trigger()` recomputes progress from the store.
   */
  private resolveUpdateOperationContainer(payload: UpdateOperationChangedEventPayload) {
    try {
      for (const containerId of [payload.newContainerId, payload.containerId]) {
        if (typeof containerId === 'string' && containerId !== '') {
          const storedContainer = containerStore.getContainer(containerId);
          if (storedContainer) {
            return storedContainer;
          }
        }
      }
      return undefined;
    } catch (error: unknown) {
      this.log.warn(
        `Failed to resolve container for update operation ${payload.operationId} (${getErrorMessage(error)})`,
      );
      return undefined;
    }
  }

  /**
   * The Home Assistant `update` object for a container, or undefined when this trigger
   * is not driving a Home Assistant entity. Gated on `hass.enabled` rather than
   * `hass.discovery` so a hand-configured HA entity (the documented
   * `HASS_ENABLED=true, HASS_DISCOVERY=false` setup) still gets progress, while a
   * plain MQTT consumer's payload keeps exactly the shape it has today.
   */
  private getHassUpdateState(container): Record<string, unknown> | undefined {
    if (!this.configuration.hass?.enabled) {
      return undefined;
    }
    return buildHassUpdateState({
      installedVersion: container?.image?.tag?.value,
      progress: getHassUpdateProgress(this.getActiveUpdateOperation(container)),
    });
  }

  private getActiveUpdateOperation(container) {
    const containerId = typeof container?.id === 'string' ? container.id : '';
    if (containerId === '') {
      return undefined;
    }
    try {
      return updateOperationStore.getActiveOperationByContainerId(containerId);
    } catch (error: unknown) {
      // A store read that fails must not cost the state publish itself; the entity
      // falls back to "no update running", which the next publish corrects.
      this.log.warn(
        `Failed to read active update operation for container [${container?.name}] (${getErrorMessage(error)})`,
      );
      return undefined;
    }
  }

  /**
   * Get the Trigger configuration schema.
   * @returns {*}
   */
  getConfigurationSchema() {
    return this.joi.object().keys({
      url: this.joi
        .string()
        .uri({
          scheme: ['mqtt', 'mqtts', 'tcp', 'tls', 'ws', 'wss'],
        })
        .required(),
      topic: this.joi.string().default(containerDefaultTopic),
      clientid: this.joi.string().default(() => generateClientId()),
      user: this.joi.string(),
      password: this.joi.string(),
      exclude: this.joi.string().allow('').default(''),
      hass: this.joi
        .object({
          enabled: this.joi.boolean().default(false),
          prefix: this.joi.string().default(hassDefaultPrefix),
          discovery: this.joi.boolean().default((parent) => !!parent?.enabled),
          agenttopicsegment: this.joi.boolean().default(hassAgentTopicSegmentDefault),
          commands: this.joi.boolean().default(false),
          devicepercontainer: this.joi.boolean().default(hassDevicePerContainerDefault),
          attributes: this.joi
            .string()
            .valid(...HASS_ATTRIBUTE_PRESET_VALUES)
            .default('short'),
          filter: this.joi
            .object({
              include: this.joi.string().allow('').default(''),
              exclude: this.joi.string().allow('').default(''),
            })
            .default({
              include: '',
              exclude: '',
            }),
        })
        .default({
          enabled: false,
          prefix: hassDefaultPrefix,
          discovery: false,
          agenttopicsegment: hassAgentTopicSegmentDefault,
          commands: false,
          devicepercontainer: hassDevicePerContainerDefault,
          attributes: 'short',
          filter: {
            include: '',
            exclude: '',
          },
        }),
      tls: this.joi
        .object({
          clientkey: this.joi.string(),
          clientcert: this.joi.string(),
          cachain: this.joi.string(),
          rejectunauthorized: this.joi.boolean().default(true),
        })
        .default({
          clientkey: undefined,
          clientcert: undefined,
          cachain: undefined,
          rejectunauthorized: true,
        }),
    });
  }

  /**
   * Sanitize sensitive data
   * @returns {*}
   */
  maskConfiguration() {
    return this.maskFields(['password']);
  }

  async initTrigger() {
    this.clearContainerEventSubscriptions();
    await this.hass?.deregister();
    this.hass = undefined;

    // Enforce simple mode
    this.configuration.mode = 'simple';

    const options: IClientOptions = {
      clientId: this.configuration.clientid,
    };
    if (this.configuration.user) {
      options.username = this.configuration.user;
    }
    if (this.configuration.password) {
      options.password = this.configuration.password;
    }
    if (this.configuration.tls.clientkey) {
      options.key = await fs.readFile(
        resolveConfiguredPath(this.configuration.tls.clientkey, {
          label: 'MQTT client key path',
        }),
      );
    }
    if (this.configuration.tls.clientcert) {
      options.cert = await fs.readFile(
        resolveConfiguredPath(this.configuration.tls.clientcert, {
          label: 'MQTT client certificate path',
        }),
      );
    }
    if (this.configuration.tls.cachain) {
      options.ca = [
        await fs.readFile(
          resolveConfiguredPath(this.configuration.tls.cachain, {
            label: 'MQTT CA chain path',
          }),
        ),
      ];
    }
    options.rejectUnauthorized = this.configuration.tls.rejectunauthorized;

    this.client = await mqtt.connectAsync(this.configuration.url, options);

    if (this.configuration.hass.enabled) {
      this.hass = new Hass({
        client: this.client,
        configuration: this.configuration,
        log: this.log,
        isContainerAllowed: (container) => this.mustTrigger(container),
      });
      await this.hass.initCommandSubscription(); // #210
      await this.hass.resyncDiscovery();
    }
    this.unregisterContainerAdded = registerContainerAdded((container) =>
      this.handleContainerEvent(container),
    );
    this.unregisterContainerUpdated = registerContainerUpdated((container) =>
      this.handleContainerEvent(container),
    );
    if (this.configuration.hass.enabled) {
      this.unregisterUpdateOperationChanged = registerUpdateOperationChanged((payload) =>
        this.handleUpdateOperationChangedEvent(payload),
      );
    }
  }

  async deregisterComponent(): Promise<void> {
    this.clearContainerEventSubscriptions();
    await this.hass?.deregister();
    this.hass = undefined;
    await super.deregisterComponent();
  }

  /**
   * Whether container state topics carry the `agent/<name>` segment. Requires
   * the Home Assistant integration to be on: the segment exists to keep the
   * state topic in step with the Home Assistant discovery/command topics
   * `Hass` builds, and `Hass` is only constructed when `hass.enabled` is true.
   */
  private isHassAgentTopicSegmentEnabled(): boolean {
    return (
      this.configuration.hass?.enabled === true && !!this.configuration.hass?.agenttopicsegment
    );
  }

  getFilterConfig(): MqttFilterConfig {
    const includePaths = splitFilterPaths(this.configuration.hass?.filter?.include);
    if (includePaths.length > 0) {
      return {
        mode: 'include',
        stage: 'flattened',
        paths: includePaths,
      };
    }

    const hassExcludePaths = splitFilterPaths(this.configuration.hass?.filter?.exclude);
    if (hassExcludePaths.length > 0) {
      return {
        mode: 'exclude',
        stage: 'flattened',
        paths: hassExcludePaths,
      };
    }

    const legacyExcludePaths = splitFilterPaths(this.configuration.exclude);
    if (legacyExcludePaths.length > 0) {
      return {
        mode: 'exclude',
        stage: 'container',
        paths: legacyExcludePaths,
      };
    }

    return {
      mode: 'exclude',
      stage: 'container',
      paths: HASS_ATTRIBUTE_PRESETS[this.configuration.hass?.attributes ?? 'short'],
    };
  }

  /**
   * Send an MQTT message with new image version details.
   *
   * @param container the container
   * @returns {Promise}
   */
  async trigger(container) {
    const containerTopic = getContainerStateTopic({
      baseTopic: this.configuration.topic,
      container,
      // #386 — the state payload has to land on the exact topic the Home
      // Assistant discovery config names as `state_topic`, and `Hass` is only
      // ever constructed when `hass.enabled` is on. Keeping the segment tied
      // to `hass.enabled` here means the two are identical whenever a `Hass`
      // exists, and that plain (non-Home-Assistant) MQTT subscribers keep the
      // unscoped topic they have always had.
      agentTopicSegment: this.isHassAgentTopicSegmentEnabled(),
    });

    const filterConfig = this.getFilterConfig();
    const containerToPublish =
      filterConfig.stage === 'container'
        ? filterContainer(container, filterConfig.paths)
        : container;
    const flattenedContainer = flatten(containerToPublish);
    const containerToPublishFlattened =
      filterConfig.stage === 'flattened'
        ? filterConfig.mode === 'include'
          ? filterContainerInclude(flattenedContainer, filterConfig.paths)
          : filterContainer(flattenedContainer, filterConfig.paths)
        : flattenedContainer;

    // Additive: the Home Assistant `update` object is appended AFTER filtering, so an
    // aggressive include/exclude filter cannot strip the one key the entity's
    // value_template reads (#210).
    const hassUpdateState = this.getHassUpdateState(container);
    const containerToPublishWithState = hassUpdateState
      ? { ...containerToPublishFlattened, [HASS_UPDATE_STATE_KEY]: hassUpdateState }
      : containerToPublishFlattened;

    this.log.debug(`Publish container result to ${containerTopic}`);
    return this.client.publish(containerTopic, JSON.stringify(containerToPublishWithState), {
      retain: true,
    });
  }

  /**
   * Mqtt trigger does not support batch mode.
   * @returns {Promise<void>}
   */

  async triggerBatch() {
    throw new Error('This trigger does not support "batch" mode');
  }
}

export default Mqtt;
