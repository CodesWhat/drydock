// @ts-nocheck
import axios from 'axios';
import Trigger from '../Trigger.js';

/**
 * Mattermost Trigger implementation
 */
class Mattermost extends Trigger {
  /**
   * Get the Trigger configuration schema.
   * @returns {*}
   */
  getConfigurationSchema() {
    return this.joi.object().keys({
      url: this.joi
        .string()
        .uri({
          scheme: ['http', 'https'],
        })
        .required(),
      channel: this.joi.string(),
      username: this.joi.string().default('drydock'),
      iconemoji: this.joi.string(),
      iconurl: this.joi.string().uri({
        scheme: ['http', 'https'],
      }),
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

  /**
   * Compose title/body in a markdown-friendly format for Mattermost.
   */
  formatTitleAndBody(title, body) {
    return `**${title}**\n\n${body}`;
  }

  async trigger(container) {
    return this.postMessage(this.composeMessage(container));
  }

  async triggerBatch(containers) {
    return this.postMessage(this.composeBatchMessage(containers));
  }

  buildMessageBody(text) {
    const body: any = { text };
    if (this.configuration.channel) {
      body.channel = this.configuration.channel;
    }
    if (this.configuration.username) {
      body.username = this.configuration.username;
    }
    if (this.configuration.iconemoji) {
      body.icon_emoji = this.configuration.iconemoji;
    }
    if (this.configuration.iconurl) {
      body.icon_url = this.configuration.iconurl;
    }
    return body;
  }

  async postMessage(text) {
    return axios.post(this.configuration.url, this.buildMessageBody(text), {
      headers: {
        'content-type': 'application/json',
      },
    });
  }
}

export default Mattermost;
