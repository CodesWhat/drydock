import BaseRegistry, { type BaseRegistryConfiguration } from '../../BaseRegistry.js';
import { getSelfHostedBasicConfigurationSchema } from '../shared/selfHostedBasicConfigurationSchema.js';

export interface CustomRegistryConfiguration extends BaseRegistryConfiguration {
  url?: string;
}

/**
 * Docker Custom Registry V2 integration.
 */
class Custom<
  TConfiguration extends CustomRegistryConfiguration = CustomRegistryConfiguration,
> extends BaseRegistry<TConfiguration> {
  getConfigurationSchema() {
    return this.joi
      .alternatives()
      .try(this.joi.string().allow(''), getSelfHostedBasicConfigurationSchema(this.joi));
  }

  maskConfiguration() {
    return this.maskSensitiveFields(['password', 'auth']);
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
   * Normalize images according to Custom characteristics.
   * @param image
   * @returns {*}
   */
  normalizeImage(image) {
    const imageNormalized = {
      ...image,
      registry: {
        ...image.registry,
      },
    };
    imageNormalized.registry.url = `${this.configuration.url}/v2`;
    return imageNormalized;
  }

  async authenticate(image, requestOptions) {
    return this.authenticateBasic(requestOptions, this.getAuthCredentials());
  }
}

export default Custom;
