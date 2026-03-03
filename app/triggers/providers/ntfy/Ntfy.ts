import axios, { type AxiosRequestConfig } from 'axios';
import Trigger from '../Trigger.js';

/**
 * Ntfy Trigger implementation
 */
class Ntfy extends Trigger {
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
        .default('https://ntfy.sh'),
      topic: this.joi.string(),
      priority: this.joi.number().integer().min(0).max(5),
      auth: this.joi.object({
        user: this.joi.string(),
        password: this.joi.string(),
        token: this.joi.string(),
      }),
    });
  }

  /**
   * Sanitize sensitive data
   * @returns {*}
   */
  maskConfiguration() {
    return {
      ...this.configuration,
      auth: this.configuration.auth
        ? {
            user: Ntfy.mask(this.configuration.auth.user),
            password: Ntfy.mask(this.configuration.auth.password),
            token: Ntfy.mask(this.configuration.auth.token),
          }
        : undefined,
    };
  }

  /**
   * Send an HTTP Request to Ntfy.
   * @param container the container
   * @returns {Promise<void>}
   */
  async trigger(container) {
    return this.sendHttpRequest({
      topic: this.configuration.topic,
      title: this.renderSimpleTitle(container),
      message: this.renderSimpleBody(container),
      priority: this.configuration.priority,
    });
  }

  /**
   * Send an HTTP Request to Ntfy.
   * @param containers
   * @returns {Promise<*>}
   */
  async triggerBatch(containers) {
    return this.sendHttpRequest({
      topic: this.configuration.topic,
      title: this.renderBatchTitle(containers),
      message: this.renderBatchBody(containers),
      priority: this.configuration.priority,
    });
  }

  /**
   * Send http request to Ntfy.
   * @param body
   * @returns {Promise<*>}
   */
  async sendHttpRequest(body) {
    const auth = this.configuration.auth;
    const options: AxiosRequestConfig = {
      method: 'POST',
      url: this.configuration.url,
      headers: {
        'Content-Type': 'application/json',
      },
      data: body,
    };
    if (auth?.user && auth?.password) {
      options.auth = {
        username: auth.user,
        password: auth.password,
      };
    }
    if (auth?.token) {
      options.headers.Authorization = `Bearer ${auth.token}`;
    }
    const response = await axios(options);
    return response.data;
  }
}

export default Ntfy;
