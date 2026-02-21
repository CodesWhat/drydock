// @ts-nocheck
import BaseRegistry from '../../BaseRegistry.js';

/**
 * Oracle Cloud Infrastructure Registry integration.
 */
class Ocir extends BaseRegistry {
  getConfigurationSchema() {
    const authSchema = this.joi
      .alternatives()
      .try(this.joi.string().base64(), this.joi.string().valid(''));

    const credentialsSchema = this.joi
      .object()
      .keys({
        login: this.joi.string(),
        password: this.joi.string(),
        auth: authSchema,
      })
      .and('login', 'password')
      .without('login', 'auth')
      .without('password', 'auth');

    return this.joi.alternatives().try(this.joi.string().allow(''), credentialsSchema);
  }

  maskConfiguration() {
    return this.maskSensitiveFields(['password', 'auth']);
  }

  private getRegistryHostname(value: string): string {
    const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    try {
      return new URL(withProtocol).hostname.toLowerCase();
    } catch {
      return value
        .replace(/^https?:\/\//i, '')
        .split('/')[0]
        .toLowerCase();
    }
  }

  match(image) {
    const registryHostname = this.getRegistryHostname(image.registry.url);
    return /^(?:[a-z0-9-]+\.)*ocir\.io$/i.test(registryHostname);
  }

  normalizeImage(image) {
    return this.normalizeImageUrl(image);
  }

  async authenticate(_image, requestOptions) {
    return this.authenticateBasic(requestOptions, this.getAuthCredentials());
  }
}

export default Ocir;
