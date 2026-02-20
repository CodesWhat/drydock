// @ts-nocheck
import BaseRegistry from '../../BaseRegistry.js';

/**
 * Generic self-hosted Docker v2 registry with optional basic auth.
 */
class SelfHostedBasic extends BaseRegistry {
  getConfigurationSchema(): any {
    const authSchema = this.joi
      .alternatives()
      .try(this.joi.string().base64(), this.joi.string().valid(''));

    return this.joi
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
  }

  maskConfiguration() {
    return this.maskSensitiveFields(['password', 'auth']);
  }

  init() {
    if (!this.configuration.url.toLowerCase().startsWith('http')) {
      this.configuration.url = `https://${this.configuration.url}`;
    }
    this.configuration.url = this.configuration.url.replace(/\/+$/, '');
  }

  private getHostname(value: string): string {
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
    const configuredHost = this.getHostname(this.configuration.url);
    const imageHost = this.getHostname(image.registry.url);
    return configuredHost === imageHost;
  }

  normalizeImage(image) {
    const imageNormalized = image;
    imageNormalized.registry.url = `${this.configuration.url}/v2`;
    return imageNormalized;
  }

  async authenticate(_image, requestOptions) {
    return this.authenticateBasic(requestOptions, this.getAuthCredentials());
  }
}

export default SelfHostedBasic;
