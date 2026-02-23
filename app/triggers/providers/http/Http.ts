// @ts-nocheck
import axios from 'axios';
import { failClosedAuth, requireAuthString, withAuthorizationHeader } from '../../../security/auth.js';

import Trigger from '../Trigger.js';

/**
 * HTTP Trigger implementation
 */
class Http extends Trigger {
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
      method: this.joi.string().allow('GET').allow('POST').default('POST'),
      auth: this.joi.object({
        type: this.joi.string().allow('BASIC').allow('BEARER').default('BASIC'),
        user: this.joi.string(),
        password: this.joi.string(),
        bearer: this.joi.string(),
      }),
      proxy: this.joi.string(),
    });
  }

  /**
   * Send an HTTP Request with new image version details.
   *
   * @param container the container
   * @returns {Promise<void>}
   */
  async trigger(container) {
    return this.sendHttpRequest(container);
  }

  /**
   * Send an HTTP Request with new image versions details.
   * @param containers
   * @returns {Promise<*>}
   */
  async triggerBatch(containers) {
    return this.sendHttpRequest(containers);
  }

  async sendHttpRequest(body) {
    let options = {
      method: this.configuration.method,
      url: this.configuration.url,
      timeout: 30000,
    };
    if (this.configuration.method === 'POST') {
      options.data = body;
    } else if (this.configuration.method === 'GET') {
      options.params = body;
    }
    if (this.configuration.auth) {
      const authType = `${this.configuration.auth.type || 'BASIC'}`.toUpperCase();
      if (authType === 'BASIC') {
        options.auth = {
          username: requireAuthString(
            this.configuration.auth.user,
            `Unable to authenticate HTTP trigger ${this.getId()}: basic auth username is missing`,
          ),
          password: requireAuthString(
            this.configuration.auth.password,
            `Unable to authenticate HTTP trigger ${this.getId()}: basic auth password is missing`,
          ),
        };
      } else if (authType === 'BEARER') {
        options = withAuthorizationHeader(
          options,
          'Bearer',
          this.configuration.auth.bearer,
          `Unable to authenticate HTTP trigger ${this.getId()}: bearer token is missing`,
        );
      } else {
        failClosedAuth(
          `Unable to authenticate HTTP trigger ${this.getId()}: auth type "${authType}" is unsupported`,
        );
      }
    }
    if (this.configuration.proxy) {
      const proxyUrl = new URL(this.configuration.proxy);
      options.proxy = {
        host: proxyUrl.hostname,
        port: proxyUrl.port,
      };
    }
    const response = await axios(options);
    return response.data;
  }
}

export default Http;
