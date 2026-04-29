import axios, { type AxiosRequestConfig } from 'axios';
import { getOutboundHttpTimeoutMs } from '../../../configuration/runtime-defaults.js';
import {
  failClosedAuth,
  requireAuthString,
  withAuthorizationHeader,
} from '../../../security/auth.js';

import Trigger, { type BatchRuntimeContext, type TriggerConfiguration } from '../Trigger.js';

interface HttpRequestOptions extends Omit<AxiosRequestConfig, 'proxy'> {
  proxy?: {
    host: string;
    port: number;
  };
}

const SUPPORTED_PROXY_PROTOCOLS = new Set(['http:', 'https:']);

interface HttpConfiguration extends TriggerConfiguration {
  url: string;
  method: 'GET' | 'POST';
  auth?: {
    type?: 'BASIC' | 'BEARER';
    user?: string;
    password?: string;
    bearer?: string;
  };
  proxy?: string;
}

/**
 * HTTP Trigger implementation
 */
class Http extends Trigger<HttpConfiguration> {
  private parseProxyConfiguration(proxy: string): NonNullable<HttpRequestOptions['proxy']> {
    const proxyUrl = new URL(proxy);
    if (!SUPPORTED_PROXY_PROTOCOLS.has(proxyUrl.protocol)) {
      throw new Error(
        `Unable to configure HTTP trigger ${this.getId()}: proxy URL scheme "${proxyUrl.protocol}" is unsupported`,
      );
    }

    const defaultProxyPort = proxyUrl.protocol === 'https:' ? 443 : 80;
    const proxyPort = proxyUrl.port ? Number.parseInt(proxyUrl.port, 10) : defaultProxyPort;
    return {
      host: proxyUrl.hostname,
      port: proxyPort,
    };
  }

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
      method: this.joi.string().valid('GET', 'POST').default('POST'),
      auth: this.joi
        .object({
          type: this.joi.string().uppercase().valid('BASIC', 'BEARER').default('BASIC'),
          user: this.joi.string(),
          password: this.joi.string(),
          bearer: this.joi.string(),
        })
        .custom((auth, helpers) => {
          const authType = auth.type as 'BASIC' | 'BEARER';
          if (authType === 'BASIC') {
            if (!auth.user) {
              return helpers.error('auth.basic.userMissing');
            }
            if (!auth.password) {
              return helpers.error('auth.basic.passwordMissing');
            }
          } else if (!auth.bearer) {
            return helpers.error('auth.bearer.missing');
          }

          return auth;
        }, 'HTTP auth validation')
        .messages({
          'auth.basic.userMissing': '"auth.user" is required',
          'auth.basic.passwordMissing': '"auth.password" is required',
          'auth.bearer.missing': '"auth.bearer" is required',
        }),
      proxy: this.joi.string().uri({
        scheme: ['http', 'https'],
      }),
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
  async triggerBatch(containers, runtimeContext?: BatchRuntimeContext) {
    // Security-digest (and any other prerendered-batch) callers supply a
    // title/body in runtimeContext; forward them as a structured envelope so
    // the webhook receiver gets the right text instead of a raw dump of stub
    // rows (#328). Update-digest callers continue to receive the raw
    // container array for backwards compatibility.
    if (runtimeContext?.title || runtimeContext?.body) {
      return this.sendHttpRequest({
        title: runtimeContext.title ?? '',
        body: runtimeContext.body ?? '',
        eventKind: runtimeContext.eventKind,
        containers,
      });
    }
    return this.sendHttpRequest(containers);
  }

  async sendHttpRequest(body) {
    let options: HttpRequestOptions = {
      method: this.configuration.method,
      url: this.configuration.url,
      timeout: getOutboundHttpTimeoutMs(),
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
      options.proxy = this.parseProxyConfiguration(this.configuration.proxy);
    }
    const response = await axios(options);
    return response.data;
  }
}

export default Http;
