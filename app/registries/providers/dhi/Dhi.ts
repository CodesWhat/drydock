import axios from 'axios';
import { withAuthorizationHeader } from '../../../security/auth.js';
import Custom, { type CustomRegistryConfiguration } from '../custom/Custom.js';
import { getTokenAuthConfigurationSchema } from '../shared/tokenAuthConfigurationSchema.js';

interface DhiRegistryConfiguration extends CustomRegistryConfiguration {
  token?: string;
}

/**
 * Docker Hardened Images registry integration.
 */
class Dhi extends Custom<DhiRegistryConfiguration> {
  init() {
    this.configuration.url = 'https://dhi.io';
    if (this.configuration.token) {
      this.configuration.password = this.configuration.token;
    }
  }

  /**
   * Get the DHI configuration schema.
   * @returns {*}
   */
  getConfigurationSchema() {
    return getTokenAuthConfigurationSchema(this.joi);
  }

  /**
   * Sanitize sensitive data.
   * @returns {*}
   */
  maskConfiguration() {
    return {
      ...this.configuration,
      url: this.configuration.url,
      login: this.configuration.login,
      password: Dhi.mask(this.configuration.password),
      token: Dhi.mask(this.configuration.token),
      auth: Dhi.mask(this.configuration.auth),
    };
  }

  /**
   * Return true if image is from DHI.
   * @param image
   * @returns {boolean}
   */
  match(image) {
    return /^.*\.?dhi.io$/.test(image.registry.url);
  }

  /**
   * Authenticate to DHI token endpoint.
   * @param image
   * @param requestOptions
   * @returns {Promise<*>}
   */
  async authenticate(image, requestOptions) {
    const scope = encodeURIComponent(`repository:${image.name}:pull`);
    const axiosConfig = {
      method: 'GET',
      url: `https://dhi.io/token?service=registry.docker.io&scope=${scope}&grant_type=password`,
      headers: {
        Accept: 'application/json',
      } as Record<string, string>,
    };

    const credentials = this.getAuthCredentials();
    if (credentials) {
      axiosConfig.headers.Authorization = `Basic ${credentials}`;
    }

    const response = await axios(axiosConfig);
    return withAuthorizationHeader(
      requestOptions,
      'Bearer',
      response.data.token,
      `Unable to authenticate registry ${this.getId()}: DHI token endpoint response does not contain token`,
    );
  }
}

export default Dhi;
