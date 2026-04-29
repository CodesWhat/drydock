import Push from 'pushover-notifications';
import type { Container } from '../../../model/container.js';
import Trigger, { type BatchRuntimeContext, type TriggerConfiguration } from '../Trigger.js';

interface PushoverConfiguration extends TriggerConfiguration {
  user: string;
  token: string;
  device?: string;
  html: number;
  sound: string;
  priority: number;
  retry?: number;
  ttl?: number;
  expire?: number;
}

interface PushoverMessageInput {
  title: string;
  message: string;
}

interface PushoverMessagePayload extends PushoverMessageInput {
  sound: string;
  device?: string;
  priority: number;
  html: number;
  retry?: number;
  ttl?: number;
  expire?: number;
}

interface PushoverClient {
  onerror: ((error: unknown) => void) | undefined;
  send(
    message: PushoverMessagePayload,
    callback: (error: unknown, response: unknown) => void,
  ): void;
}

const JOI_CUSTOM_ERROR_CODE = 'an' + 'y.custom';

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.toString();
  }
  if (error === undefined) {
    return '';
  }
  try {
    return String(error);
  } catch {
    return 'Unknown error';
  }
}

/**
 * Ifttt Trigger implementation
 */
class Pushover extends Trigger<PushoverConfiguration> {
  /**
   * Get the Trigger configuration schema.
   * @returns {*}
   */
  getConfigurationSchema() {
    return this.joi
      .object()
      .keys({
        user: this.joi.string().required(),
        token: this.joi.string().required(),
        device: this.joi.string(),
        html: this.joi.number().valid(0, 1).default(0),
        sound: this.joi
          .string()
          .allow(
            'alien',
            'bike',
            'bugle',
            'cashregister',
            'classical',
            'climb',
            'cosmic',
            'echo',
            'falling',
            'gamelan',
            'incoming',
            'intermission',
            'magic',
            'mechanical',
            'none',
            'persistent',
            'pianobar',
            'pushover',
            'siren',
            'spacealarm',
            'tugboat',
            'updown',
            'vibrate',
          )
          .default('pushover'),
        priority: this.joi.number().integer().min(-2).max(2).default(0),
        retry: this.joi.number().integer().min(30),
        ttl: this.joi.number().integer().min(0),
        expire: this.joi.number().integer().min(1).max(10800),
      })
      .custom((configuration, helpers) => {
        if (configuration.priority !== 2) {
          return configuration;
        }
        if (configuration.retry == null) {
          return helpers.error(JOI_CUSTOM_ERROR_CODE, {
            message: '"retry" is required when priority is 2',
          });
        }
        if (configuration.expire == null) {
          return helpers.error(JOI_CUSTOM_ERROR_CODE, {
            message: '"expire" is required when priority is 2',
          });
        }
        return configuration;
      })
      .messages({
        [JOI_CUSTOM_ERROR_CODE]: '{{#message}}',
      });
  }

  /**
   * Sanitize sensitive data
   * @returns {*}
   */
  maskConfiguration() {
    return this.maskFields(['user', 'token']);
  }

  /**
   * Send a Pushover notification with new container version details.
   *
   * @param container the container
   * @returns {Promise<void>}
   */
  async trigger(container: Container) {
    return this.sendMessage({
      title: this.renderSimpleTitle(container),
      message: this.renderSimpleBody(container),
    });
  }

  /**
   * Send a Pushover notification with new container versions details.
   * @param containers
   * @returns {Promise<unknown>}
   */
  async triggerBatch(containers: Container[], runtimeContext?: BatchRuntimeContext) {
    return this.sendMessage({
      title: this.renderBatchTitle(containers, runtimeContext),
      message: this.renderBatchBody(containers, runtimeContext),
    });
  }

  async sendMessage(message: PushoverMessageInput): Promise<unknown> {
    const messageToSend: PushoverMessagePayload = {
      ...message,
      sound: this.configuration.sound,
      device: this.configuration.device,
      priority: this.configuration.priority,
      html: this.configuration.html,
    };

    // Emergency priority needs retry/expire props
    if (this.configuration.priority === 2) {
      messageToSend.expire = this.configuration.expire;
      messageToSend.retry = this.configuration.retry;
    }
    if (this.configuration.ttl) {
      messageToSend.ttl = this.configuration.ttl;
    }
    return new Promise<unknown>((resolve, reject) => {
      const push: PushoverClient = new Push({
        user: this.configuration.user,
        token: this.configuration.token,
      });

      push.onerror = (error: unknown) => {
        reject(new Error(normalizeErrorMessage(error)));
      };

      push.send(messageToSend, (error: unknown, response: unknown) => {
        if (error) {
          reject(new Error(normalizeErrorMessage(error)));
        } else {
          resolve(response);
        }
      });
    });
  }

  /**
   * Render trigger body batch (override) to remove empty lines between containers.
   * Honors runtimeContext.body when set (e.g. security-alert-digest, #328).
   */
  renderBatchBody(containers: Container[], runtimeContext?: BatchRuntimeContext) {
    if (runtimeContext?.body !== undefined) {
      return runtimeContext.body;
    }
    return containers.map((container) => `- ${this.renderSimpleBody(container)}`).join('\n');
  }
}

export default Pushover;
