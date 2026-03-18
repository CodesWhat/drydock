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
  private buildNotifyPayload(
    title: string,
    message: string,
  ): { uri: string; body: AppriseNotifyBody } {
    let uri = `${this.configuration.url}/notify`;
    const body: AppriseNotifyBody = {
      title,
      body: message,
      format: 'text',
      type: 'info',
    };

    // Persistent storage usage (target apprise yml config file and tags)
    if (this.configuration.config) {
      uri += `/${encodeURIComponent(this.configuration.config)}`;
      if (this.configuration.tag) {
        body.tag = this.configuration.tag;
      }
    } else {
      // Standard usage
      body.urls = this.configuration.urls;
    }

    return { uri, body };
  }

  private async sendNotification(title: string, message: string): Promise<unknown> {
    const { uri, body } = this.buildNotifyPayload(title, message);
    const response = await axios({
      method: 'POST',
      url: uri,
      headers: { 'Content-Type': 'application/json' },
      data: body,
      timeout: getOutboundHttpTimeoutMs(),
    });
    return response.data;
  }

  /**
   * Get the Trigger configuration schema.
   * @returns {*}
   */
  getConfigurationSchema() {
    return this.joi
      .object()
      .keys({
        url: this.joi
          .string()
          .uri({
            scheme: ['http', 'https'],
          })
          .required(),
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
    return this.sendNotification(
      this.renderSimpleTitle(container),
      this.renderSimpleBody(container),
    );
  }

  /**
   * Send an HTTP Request to Apprise.
   * @param containers
   * @returns {Promise<*>}
   */
  async triggerBatch(containers) {
    return this.sendNotification(
      this.renderBatchTitle(containers),
      this.renderBatchBody(containers),
    );
  }
}

export default Apprise;
