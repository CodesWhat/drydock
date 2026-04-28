import axios, { type AxiosRequestConfig } from 'axios';
import { getOutboundHttpTimeoutMs } from '../../../configuration/runtime-defaults.js';
import Trigger, { type BatchRuntimeContext, type TriggerConfiguration } from '../Trigger.js';

interface NtfyConfiguration extends TriggerConfiguration {
  url: string;
  topic?: string;
  priority?: number;
  auth?: {
    user?: string;
    password?: string;
    token?: string;
  };
}

/**
 * Ntfy Trigger implementation
 */
class Ntfy extends Trigger<NtfyConfiguration> {
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
  async triggerBatch(containers, runtimeContext?: BatchRuntimeContext) {
    return this.sendHttpRequest({
      topic: this.configuration.topic,
      title: this.renderBatchTitle(containers, runtimeContext),
      message: this.renderBatchBody(containers, runtimeContext),
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
      timeout: getOutboundHttpTimeoutMs(),
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
