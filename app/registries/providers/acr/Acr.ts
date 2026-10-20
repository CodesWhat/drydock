import BaseRegistry, { type BaseRegistryConfiguration } from '../../BaseRegistry.js';

interface AcrRegistryConfiguration extends BaseRegistryConfiguration {
  clientid: string;
  clientsecret: string;
}

/**
 * Azure Container Registry integration.
 */
class Acr extends BaseRegistry<AcrRegistryConfiguration> {
  getConfigurationSchema() {
    return this.joi.object().keys({
      clientid: this.joi.string().required(),
      clientsecret: this.joi.string().required(),
    });
  }

  /**
   * Sanitize sensitive data
   * @returns {*}
   */
  maskConfiguration() {
    return this.maskSensitiveFields(['clientsecret']);
  }

  /**
   * Return true if image has not registryUrl.
   * @param image the image
   * @returns {boolean}
   */

  match(image) {
    return this.matchRegistryHost(image, 'azurecr.io');
  }

  /**
   * Normalize image according to AWS ECR characteristics.
   * @param image
   * @returns {*}
   */

  normalizeImage(image) {
    return this.normalizeImageUrl(image);
  }

  async authenticate(image, requestOptions) {
    return this.authenticateBasic(
      {
        ...requestOptions,
        headers: {
          ...(requestOptions?.headers || {}),
        },
      },
      Acr.base64Encode(this.configuration.clientid, this.configuration.clientsecret),
    );
  }

  async getAuthPull() {
    return {
      username: this.configuration.clientid,
      password: this.configuration.clientsecret,
    };
  }
}

export default Acr;
