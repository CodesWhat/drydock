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
  protected getTrustedAuthHosts(): string[] {
    /* v8 ignore next -- GitLab config schema supplies authurl; empty config is direct-construction only. */
    return typeof this.configuration?.authurl === 'string' ? [this.configuration.authurl] : [];
  }

  private getTokenRequestCredentials(): string | undefined {
    /* v8 ignore next -- GitLab config schema requires token; missing token is direct-construction only. */
    return this.configuration.token ? Gitlab.base64Encode('', this.configuration.token) : undefined;
  }

  protected override getBearerChallengeAuthOptions() {
    return {
      credentials: this.getTokenRequestCredentials(),
      tokenFailureMessage: `Unable to authenticate registry ${this.getId()}: GitLab token endpoint response does not contain token`,
    };
  }

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
    const credentials = this.getTokenRequestCredentials();
    const request = {
      method: 'GET',
      url: `${this.configuration.authurl}/jwt/auth?service=container_registry&scope=${scope}`,
      headers: {
        Accept: 'application/json',
        /* v8 ignore next -- GitLab config schema requires token before authenticate is callable. */
        ...(credentials ? { Authorization: `Basic ${credentials}` } : {}),
      },
    };
    const response = await axios(this.withTlsRequestOptions(request));
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
