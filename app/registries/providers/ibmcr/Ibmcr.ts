// @ts-nocheck
import BaseRegistry from '../../BaseRegistry.js';

/**
 * IBM Cloud Container Registry integration.
 */
class Ibmcr extends BaseRegistry {
  getConfigurationSchema() {
    const authSchema = this.joi
      .alternatives()
      .try(this.joi.string().base64(), this.joi.string().valid(''));

    const credentialsSchema = this.joi
      .object()
      .keys({
        login: this.joi.string(),
        password: this.joi.string(),
        apikey: this.joi.string(),
        auth: authSchema,
      })
      .and('login', 'password')
      .without('login', 'auth')
      .without('password', 'auth')
      .without('apikey', 'auth')
      .without('apikey', 'password')
      .without('apikey', 'login');

    return this.joi.alternatives().try(this.joi.string().allow(''), credentialsSchema);
  }

  init() {
    // IBM docs recommend docker login -u iamapikey -p <API_KEY> REGISTRY_DOMAIN
    if (this.configuration.apikey && !this.configuration.password && !this.configuration.auth) {
      this.configuration.login = 'iamapikey';
      this.configuration.password = this.configuration.apikey;
    }
  }

  maskConfiguration() {
    return this.maskSensitiveFields(['password', 'auth', 'apikey']);
  }

  private getRegistryHostname(value: string): string {
    const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    try {
      return new URL(withProtocol).hostname.toLowerCase();
    } catch {
      return value.replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();
    }
  }

  match(image) {
    const registryHostname = this.getRegistryHostname(image.registry.url);
    return /^(?:[a-z0-9-]+\.)*icr\.io$/i.test(registryHostname);
  }

  normalizeImage(image) {
    return this.normalizeImageUrl(image);
  }

  async authenticate(_image, requestOptions) {
    return this.authenticateBasic(requestOptions, this.getAuthCredentials());
  }
}

export default Ibmcr;
