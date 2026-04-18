import axios from 'axios';
import { withAuthorizationHeader } from '../../../security/auth.js';
import BaseRegistry, { type BaseRegistryConfiguration } from '../../BaseRegistry.js';

export interface GitlabRegistryConfiguration extends BaseRegistryConfiguration {
  url?: string;
  authurl?: string;
  token?: string;
}

/**
 * Docker Gitlab integration.
 */
class Gitlab<
  TConfiguration extends GitlabRegistryConfiguration = GitlabRegistryConfiguration,
> extends BaseRegistry<TConfiguration> {
  /**
   * Get the Gitlab configuration schema.
   * @returns {*}
   */
  getConfigurationSchema(): import('joi').Schema {
    return this.joi.object().keys({
      url: this.joi.string().uri().default('https://registry.gitlab.com'),
      authurl: this.joi.string().uri().default('https://gitlab.com'),
      token: this.joi.string().required(),
    });
  }

  /**
   * Sanitize sensitive data
   * @returns {*}
   */
  maskConfiguration() {
    return this.maskSensitiveFields(['token']);
  }

  /**
   * Return true if image has no registry url.
   * @param image the image
   * @returns {boolean}
   */
  match(image) {
    return this.configuration.url.includes(image.registry.url);
  }

  /**
   * Normalize images according to Gitlab characteristics.
   * @param image
   * @returns {*}
   */

  normalizeImage(image) {
    return this.normalizeImageUrl(image);
  }

  /**
   * Authenticate to Gitlab.
   * @param image
   * @param requestOptions
   * @returns {Promise<*>}
   */
  async authenticate(image, requestOptions) {
    const scope = encodeURIComponent(`repository:${image.name}:pull`);
    const request = {
      method: 'GET',
      url: `${this.configuration.authurl}/jwt/auth?service=container_registry&scope=${scope}`,
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${Gitlab.base64Encode('', this.configuration.token)}`,
      },
    };
    const response = await axios(request);
    return withAuthorizationHeader(
      requestOptions,
      'Bearer',
      response.data.token,
      `Unable to authenticate registry ${this.getId()}: GitLab token endpoint response does not contain token`,
    );
  }

  /**
   * Return empty username and personal access token value.
   * @returns {{password: (string|undefined|*), username: string}}
   */
  async getAuthPull() {
    return {
      username: '',
      password: this.configuration.token,
    };
  }
}

export default Gitlab;
