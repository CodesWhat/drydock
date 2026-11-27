import axios from 'axios';
import { getOutboundHttpTimeoutMs } from '../../../configuration/runtime-defaults.js';
import Trigger, { type BatchRuntimeContext, type TriggerConfiguration } from '../Trigger.js';

interface BarkConfiguration extends TriggerConfiguration {
  url: string;
  devicekey: string;
  barkgroup: string;
  icon?: string;
  sound?: string;
  badge?: number;
  urltoopen?: string;
  disabletitle: boolean;
}

/**
 * Bark Trigger implementation (iOS push notifications).
 * Request contract adapted from What's up Docker (MIT, Copyright (c) 2019 Manfred Martin).
 */
class Bark extends Trigger<BarkConfiguration> {
  /**
   * Get the Trigger configuration schema.
   * @returns {*}
   */
  getConfigurationSchema() {
    return this.joi.object().keys({
      url: this.joi
        .string()
        .uri({ scheme: ['http', 'https'] })
        .replace(/\/$/, '')
        .default('https://api.day.app'),
      devicekey: this.joi.string().trim().required(),
      barkgroup: this.joi.string().default('drydock'),
      icon: this.joi.string().uri({ scheme: ['http', 'https'] }),
      sound: this.joi.string(),
      badge: this.joi.number().integer().min(0),
      urltoopen: this.joi.string().uri({ scheme: ['http', 'https'] }),
      disabletitle: this.joi.boolean().default(false),
    });
  }

  /**
   * Sanitize sensitive data
   * @returns {*}
   */
  maskConfiguration() {
    return this.maskFields(['devicekey']);
  }

  /**
   * Notify Bark with container update details.
   * @param container the container
   * @returns {Promise<*>}
   */
  async trigger(container) {
    const title = this.configuration.disabletitle ? '' : this.renderSimpleTitle(container);
    return this.sendMessage(title, this.renderSimpleBody(container), container.result?.link);
  }

  /**
   * Notify Bark with batch container update details.
   * @param containers
   * @returns {Promise<*>}
   */
  async triggerBatch(containers, runtimeContext?: BatchRuntimeContext) {
    const title = this.configuration.disabletitle
      ? ''
      : this.renderBatchTitle(containers, runtimeContext);
    return this.sendMessage(title, this.renderBatchBody(containers, runtimeContext));
  }

  /**
   * Send a push notification through the Bark API.
   * @param title the notification title (omitted when empty)
   * @param body the notification body
   * @param link optional link opened when the notification is tapped
   * @returns {Promise<*>}
   */
  async sendMessage(title: string, body: string, link?: string) {
    const { devicekey, barkgroup, icon, sound, badge, urltoopen } = this.configuration;
    const openUrl = urltoopen || link;
    const payload = {
      device_key: devicekey,
      body,
      group: barkgroup,
      ...(title ? { title } : {}),
      ...(icon ? { icon } : {}),
      ...(sound ? { sound } : {}),
      ...(badge !== undefined ? { badge } : {}),
      ...(openUrl ? { url: openUrl } : {}),
    };
    const response = await axios.post(`${this.configuration.url}/push`, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: getOutboundHttpTimeoutMs(),
    });
    return response.data;
  }
}

export default Bark;
