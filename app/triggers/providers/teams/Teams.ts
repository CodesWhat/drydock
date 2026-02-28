// @ts-nocheck
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
    const message = this.composeMessage(container);
    const resultLink =
      typeof container?.result?.link === 'string' && container.result.link.length > 0
        ? container.result.link
        : undefined;
    if (resultLink) {
      return this.postMessage(message, resultLink);
    }
    return this.postMessage(message);
  }

  async triggerBatch(containers) {
    return this.postMessage(this.composeBatchMessage(containers));
  }

  buildMessageBody(text, resultLink) {
    const content: any = {
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
    };

    if (resultLink) {
      content.actions = [
        {
          type: 'Action.OpenUrl',
          title: 'Open release',
          url: resultLink,
        },
      ];
    }

    return {
      type: 'message',
      attachments: [
        {
          contentType: 'application/vnd.microsoft.card.adaptive',
          contentUrl: null,
          content,
        },
      ],
    };
  }

  async postMessage(text, resultLink) {
    return axios.post(this.configuration.url, this.buildMessageBody(text, resultLink), {
      headers: {
        'content-type': 'application/json',
      },
      timeout: 30000,
    });
  }
}

export default Teams;
