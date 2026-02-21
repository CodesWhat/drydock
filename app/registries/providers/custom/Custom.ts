// @ts-nocheck
import BaseRegistry from '../../BaseRegistry.js';

/**
 * Docker Custom Registry V2 integration.
 */
class Custom extends BaseRegistry {
  getConfigurationSchema() {
    const authSchema = this.joi
      .alternatives()
      .try(this.joi.string().base64(), this.joi.string().valid(''));

    const customConfigSchema = this.joi
      .object()
      .keys({
        url: this.joi.string().uri().required(),
        login: this.joi.string(),
        password: this.joi.string(),
        auth: authSchema,
        cafile: this.joi.string(),
        insecure: this.joi.boolean(),
      })
      .and('login', 'password')
      .without('login', 'auth')
      .without('password', 'auth');

    return this.joi.alternatives([this.joi.string().allow(''), customConfigSchema]);
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
    const imageNormalized = image;
    imageNormalized.registry.url = `${this.configuration.url}/v2`;
    return imageNormalized;
  }

  async authenticate(image, requestOptions) {
    return this.authenticateBasic(requestOptions, this.getAuthCredentials());
  }
}

export default Custom;
