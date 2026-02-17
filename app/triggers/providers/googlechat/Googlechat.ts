// @ts-nocheck
import axios from 'axios';
import Trigger from '../Trigger.js';

/**
 * Google Chat Trigger implementation
 */
class Googlechat extends Trigger {
  /**
   * Get the Trigger configuration schema.
   * @returns {*}
   */
  getConfigurationSchema() {
    return this.joi.object().keys({
      url: this.joi
        .string()
        .uri({
          scheme: ['https'],
        })
        .required(),
      threadkey: this.joi.string(),
      messagereplyoption: this.joi
        .string()
        .valid('REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD', 'REPLY_MESSAGE_OR_FAIL'),
      disabletitle: this.joi.boolean().default(false),
    });
  }

  /**
   * Sanitize sensitive data
   * @returns {*}
   */
  maskConfiguration() {
    return this.maskFields(['url']);
  }

  async trigger(container) {
    return this.postMessage(this.composeMessage(container));
  }

  async triggerBatch(containers) {
    return this.postMessage(this.composeBatchMessage(containers));
  }

  buildMessageBody(text) {
    const body: any = { text };
    if (this.configuration.threadkey) {
      body.thread = { threadKey: this.configuration.threadkey };
    }
    return body;
  }

  buildWebhookUrl() {
    if (!this.configuration.messagereplyoption) {
      return this.configuration.url;
    }
    const webhookUrl = new URL(this.configuration.url);
    webhookUrl.searchParams.set('messageReplyOption', this.configuration.messagereplyoption);
    return webhookUrl.toString();
  }

  async postMessage(text) {
    return axios.post(this.buildWebhookUrl(), this.buildMessageBody(text), {
      headers: {
        'content-type': 'application/json',
      },
    });
  }
}

export default Googlechat;
