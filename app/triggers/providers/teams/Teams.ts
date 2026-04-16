import axios from 'axios';
import { getOutboundHttpTimeoutMs } from '../../../configuration/runtime-defaults.js';
import Trigger, { type TriggerConfiguration } from '../Trigger.js';

type TeamsAdaptiveCardTextBlock = {
  type: 'TextBlock';
  text: string;
  wrap: true;
};

type TeamsAdaptiveCardOpenUrlAction = {
  type: 'Action.OpenUrl';
  title: 'Open release';
  url: string;
};

type TeamsAdaptiveCardContent = {
  type: 'AdaptiveCard';
  $schema: 'http://adaptivecards.io/schemas/adaptive-card.json';
  version: string;
  body: TeamsAdaptiveCardTextBlock[];
  actions?: TeamsAdaptiveCardOpenUrlAction[];
};

type TeamsMessageBody = {
  type: 'message';
  attachments: Array<{
    contentType: 'application/vnd.microsoft.card.adaptive';
    contentUrl: null;
    content: TeamsAdaptiveCardContent;
  }>;
};

interface TeamsConfiguration extends TriggerConfiguration {
  url: string;
  cardversion: string;
}

/**
 * Microsoft Teams Trigger implementation
 */
class Teams extends Trigger<TeamsConfiguration> {
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

  buildMessageBody(text, resultLink?) {
    const content: TeamsAdaptiveCardContent = {
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

    const messageBody: TeamsMessageBody = {
      type: 'message',
      attachments: [
        {
          contentType: 'application/vnd.microsoft.card.adaptive',
          contentUrl: null,
          content,
        },
      ],
    };

    return messageBody;
  }

  async postMessage(text, resultLink?) {
    return axios.post(this.configuration.url, this.buildMessageBody(text, resultLink), {
      headers: {
        'content-type': 'application/json',
      },
      timeout: getOutboundHttpTimeoutMs(),
    });
  }
}

export default Teams;
