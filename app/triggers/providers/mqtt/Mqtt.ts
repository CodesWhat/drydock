import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import mqtt, { type IClientOptions, type MqttClient } from 'mqtt';
import { registerContainerAdded, registerContainerUpdated } from '../../../event/index.js';
import { flatten } from '../../../model/container.js';
import { resolveConfiguredPath } from '../../../runtime/paths.js';
import Trigger, { type TriggerConfiguration } from '../Trigger.js';
import {
  filterContainer,
  HASS_ATTRIBUTE_PRESET_VALUES,
  HASS_ATTRIBUTE_PRESETS,
  type HassAttributePreset,
} from './filter.js';
import Hass from './Hass.js';

const containerDefaultTopic = 'dd/container';
const hassDefaultPrefix = 'homeassistant';

function generateClientId() {
  return `dd_${randomBytes(4).toString('hex')}`;
}

/**
 * Get container topic.
 * @param baseTopic
 * @param container
 * @return {string}
 */
function getContainerTopic({ baseTopic, container }) {
  const containerName = container.name.replaceAll('.', '-');
  return `${baseTopic}/${container.watcher}/${containerName}`;
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
    attributes: HassAttributePreset;
  };
  tls: {
    clientkey?: string;
    clientcert?: string;
    cachain?: string;
    rejectunauthorized: boolean;
  };
}

/**
 * MQTT Trigger implementation
 */
class Mqtt extends Trigger {
  public configuration: MqttConfiguration = {
    url: '',
    topic: containerDefaultTopic,
    clientid: '',
    exclude: '',
    hass: {
      enabled: false,
      prefix: hassDefaultPrefix,
      discovery: false,
      attributes: 'full',
    },
    tls: {
      rejectunauthorized: true,
    },
  };
  private client!: MqttClient;
  private hass?: Hass;
  private unregisterContainerAdded?: () => void;
  private unregisterContainerUpdated?: () => void;

  private clearContainerEventSubscriptions() {
    this.unregisterContainerAdded?.();
    this.unregisterContainerAdded = undefined;

    this.unregisterContainerUpdated?.();
    this.unregisterContainerUpdated = undefined;
  }

  handleContainerEvent(container) {
    void this.trigger(container).catch((error) => {
      this.log.warn(`Error (${error.message})`);
      this.log.debug(error);
    });
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
          attributes: this.joi
            .string()
            .valid(...HASS_ATTRIBUTE_PRESET_VALUES)
            .default('full'),
        })
        .default({
          enabled: false,
          prefix: hassDefaultPrefix,
          discovery: false,
          attributes: 'full',
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
    this.hass?.deregister();
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
      });
    }
    this.unregisterContainerAdded = registerContainerAdded((container) =>
      this.handleContainerEvent(container),
    );
    this.unregisterContainerUpdated = registerContainerUpdated((container) =>
      this.handleContainerEvent(container),
    );
  }

  async deregisterComponent(): Promise<void> {
    this.clearContainerEventSubscriptions();
    this.hass?.deregister();
    this.hass = undefined;
    await super.deregisterComponent();
  }

  getExcludePaths(): string[] {
    if (this.configuration.exclude) {
      return this.configuration.exclude
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
    return HASS_ATTRIBUTE_PRESETS[this.configuration.hass.attributes];
  }

  /**
   * Send an MQTT message with new image version details.
   *
   * @param container the container
   * @returns {Promise}
   */
  async trigger(container) {
    const containerTopic = getContainerTopic({
      baseTopic: this.configuration.topic,
      container,
    });

    const excludePaths = this.getExcludePaths();
    const containerToPublish = filterContainer(container, excludePaths);

    this.log.debug(`Publish container result to ${containerTopic}`);
    return this.client.publish(containerTopic, JSON.stringify(flatten(containerToPublish)), {
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
