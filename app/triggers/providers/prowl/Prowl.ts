import axios from 'axios';
import { getOutboundHttpTimeoutMs } from '../../../configuration/runtime-defaults.js';
import Trigger, { type BatchRuntimeContext, type TriggerConfiguration } from '../Trigger.js';

const PROWL_API_URL = 'https://api.prowlapp.com/publicapi/add';

interface ProwlConfiguration extends TriggerConfiguration {
  apikey: string;
  priority: number;
  application: string;
  url: string;
  openurl?: string;
  providerkey?: string;
  disabletitle: boolean;
}

/**
 * Prowl Trigger implementation (iOS push notifications).
 * Request contract adapted from What's up Docker (MIT, Copyright (c) 2019 Manfred Martin).
 */
class Prowl extends Trigger<ProwlConfiguration> {
  /**
   * Get the Trigger configuration schema.
   * @returns {*}
   */
  getConfigurationSchema() {
    return this.joi.object().keys({
      apikey: this.joi.string().trim().required(),
      priority: this.joi.number().integer().min(-2).max(2).default(0),
      application: this.joi.string().default('drydock'),
      url: this.joi
        .string()
        .uri({ scheme: ['http', 'https'] })
        .default(PROWL_API_URL),
      openurl: this.joi.string().uri({ scheme: ['http', 'https'] }),
      providerkey: this.joi.string().trim(),
      disabletitle: this.joi.boolean().default(false),
    });
  }

  /**
   * Sanitize sensitive data
   * @returns {*}
   */
  maskConfiguration() {
    return this.maskFields(['apikey', 'providerkey']);
  }

  /**
   * Notify Prowl with container update details.
   * @param container the container
   * @returns {Promise<*>}
   */
  async trigger(container) {
    const title = this.configuration.disabletitle ? 'Update' : this.renderSimpleTitle(container);
    return this.sendMessage(title, this.renderSimpleBody(container), container.result?.link);
  }

  /**
   * Notify Prowl with batch container update details.
   * @param containers
   * @returns {Promise<*>}
   */
  async triggerBatch(containers, runtimeContext?: BatchRuntimeContext) {
    const title = this.configuration.disabletitle
      ? 'Batch Updates'
      : this.renderBatchTitle(containers, runtimeContext);
    return this.sendMessage(title, this.renderBatchBody(containers, runtimeContext));
  }

  /**
   * Send a push notification through the Prowl public API.
   * @param title the Prowl event name
   * @param body the Prowl description
   * @param link optional link opened from the notification
   * @returns {Promise<*>}
   */
  async sendMessage(title: string, body: string, link?: string) {
    const params = new URLSearchParams();
    params.append('apikey', this.configuration.apikey);
    params.append('priority', this.configuration.priority.toString());
    params.append('application', this.configuration.application);
    params.append('event', title);
    params.append('description', body);
    const openUrl = this.configuration.openurl || link;
    if (openUrl) {
      params.append('url', openUrl);
    }
    if (this.configuration.providerkey) {
      params.append('providerkey', this.configuration.providerkey);
    }
    const response = await axios.post(this.configuration.url, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: getOutboundHttpTimeoutMs(),
    });
    return response.data;
  }
}

export default Prowl;
