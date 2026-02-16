import axios from 'axios';
import Trigger from '../Trigger.js';

/**
 * Microsoft Teams Trigger implementation
 */
class Teams extends Trigger {
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
      cardversion: this.joi.string().default('1.4'),
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
    return {
      type: 'message',
      attachments: [
        {
          contentType: 'application/vnd.microsoft.card.adaptive',
          contentUrl: null,
          content: {
            type: 'AdaptiveCard',
            $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
            version: this.configuration.cardversion,
            body: [
              {
                type: 'TextBlock',
                text,
                wrap: true,
              },
            ],
          },
        },
      ],
    };
  }

  async postMessage(text) {
    return axios.post(this.configuration.url, this.buildMessageBody(text), {
      headers: {
        'content-type': 'application/json',
      },
    });
  }
}

export default Teams;
