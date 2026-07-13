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
    return this.maskSensitiveFields(['password', 'token', 'auth']);
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
    const credentials = this.getAuthCredentials();
    return this.authenticateBearerFromAuthUrl(
      requestOptions,
      `https://dhi.io/token?service=registry.docker.io&scope=${scope}&grant_type=password`,
      credentials,
      undefined,
      `Unable to authenticate registry ${this.getId()}: DHI token endpoint response does not contain token`,
      'https://dhi.io',
    );
  }
}

export default Dhi;
