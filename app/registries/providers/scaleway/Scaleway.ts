import BaseRegistry, { type BaseRegistryConfiguration } from '../../BaseRegistry.js';

interface ScalewayRegistryConfiguration extends BaseRegistryConfiguration {
  secretkey?: string;
}

/**
 * Scaleway Container Registry (*.scw.cloud) integration.
 */
class Scaleway extends BaseRegistry<ScalewayRegistryConfiguration> {
  init() {
    // Scaleway accepts any username with the API secret key as the password.
    if (this.configuration.secretkey && !this.configuration.auth) {
      this.configuration.password = this.configuration.secretkey;
      if (!this.configuration.login) {
        this.configuration.login = 'nologin';
      }
    }
  }

  getConfigurationSchema() {
    return this.joi.alternatives([
      this.joi.string().allow(''),
      this.joi
        .object()
        .keys({
          login: this.joi.string(),
          password: this.joi.string(),
          secretkey: this.joi.string(),
          auth: this.joi.string().base64(),
        })
        .without('secretkey', ['password', 'auth'])
        .without('login', 'auth')
        .without('password', 'auth'),
    ]);
  }

  maskConfiguration() {
    return this.maskFields(['password', 'secretkey', 'auth']);
  }

  protected getTrustedAuthHosts(): string[] {
    return ['api.scaleway.com'];
  }

  match(image) {
    return this.matchRegistryHost(image, 'scw.cloud');
  }

  normalizeImage(image) {
    return this.normalizeImageUrl(image);
  }

  async authenticate(_image, requestOptions) {
    return this.authenticateBasic(requestOptions, this.getAuthCredentials());
  }
}

export default Scaleway;
