import axios from 'axios';
import { getOutboundHttpTimeoutMs } from '../../../configuration/runtime-defaults.js';

import Trigger from '../Trigger.js';

interface AppriseNotifyBody {
  title: string;
  body: string;
  format: 'text';
  type: 'info';
  tag?: string;
  urls?: string;
}

/**
 * Apprise Trigger implementation
 */
class Apprise extends Trigger {
  /**
   * Get the Trigger configuration schema.
   * @returns {*}
   */
  getConfigurationSchema() {
    return this.joi
      .object()
      .keys({
        url: this.joi.string().uri({
          scheme: ['http', 'https'],
        }),
        urls: this.joi.string(),
        config: this.joi.string(),
        tag: this.joi.string(),
      })
      .xor('urls', 'config');
  }

  /**
   * Sanitize sensitive data
   * @returns {*}
   */
  maskConfiguration() {
    return this.maskFields(['urls']);
  }

  /**
   * Send an HTTP Request to Apprise.
   * @param container the container
   * @returns {Promise<void>}
   */
  async trigger(container) {
    let uri = `${this.configuration.url}/notify`;
    const body: AppriseNotifyBody = {
      title: this.renderSimpleTitle(container),
      body: this.renderSimpleBody(container),
      format: 'text',
      type: 'info',
    };

    // Persistent storage usage (target apprise yml config file and tags)
    if (this.configuration.config) {
      uri += `/${encodeURIComponent(this.configuration.config)}`;
      if (this.configuration.tag) {
        body.tag = this.configuration.tag;
      }

      // Standard usage
    } else {
      body.urls = this.configuration.urls;
    }
    const options = {
      method: 'POST',
      url: uri,
      headers: { 'Content-Type': 'application/json' },
      data: body,
      timeout: getOutboundHttpTimeoutMs(),
    };
    const response = await axios(options);
    return response.data;
  }

  /**
   * Send an HTTP Request to Apprise.
   * @param containers
   * @returns {Promise<*>}
   */
  async triggerBatch(containers) {
    let uri = `${this.configuration.url}/notify`;
    const body: AppriseNotifyBody = {
      title: this.renderBatchTitle(containers),
      body: this.renderBatchBody(containers),
      format: 'text',
      type: 'info',
    };

    // Persistent storage usage (target apprise yml config file and tags)
    if (this.configuration.config) {
      uri += `/${encodeURIComponent(this.configuration.config)}`;
      if (this.configuration.tag) {
        body.tag = this.configuration.tag;
      }

      // Standard usage
    } else {
      body.urls = this.configuration.urls;
    }

    const options = {
      method: 'POST',
      url: uri,
      headers: { 'Content-Type': 'application/json' },
      data: body,
      timeout: getOutboundHttpTimeoutMs(),
    };
    const response = await axios(options);
    return response.data;
  }
}

export default Apprise;
