import Custom from '../custom/Custom.js';

/**
 * Gitea Container Registry integration.
 */
class Gitea extends Custom {
  getConfigurationSchema(): any {
    return this.joi
      .object()
      .keys({
        url: this.joi.string().uri().required(),
        login: this.joi.string(),
        password: this.joi.string(),
        auth: this.joi.alternatives().try(this.joi.string().base64(), this.joi.string().valid('')),
      })
      .and('login', 'password')
      .without('login', 'auth')
      .without('password', 'auth');
  }

  /**
   * Custom init behavior.
   */
  init() {
    // Prepend the URL with https protocol if protocol is missing
    if (!this.configuration.url.toLowerCase().startsWith('http')) {
      this.configuration.url = `https://${this.configuration.url}`;
    }
  }

  /**
   * Return true if image registry match gitea fqdn.
   * @param image the image
   * @returns {boolean}
   */
  match(image) {
    const fqdnConfigured = /(?:https?:\/\/)?(.*)/.exec(this.configuration.url)[1].toLowerCase();
    const imageRegistryFqdn = /(?:https?:\/\/)?(.*)/.exec(image.registry.url)[1].toLowerCase();
    return fqdnConfigured === imageRegistryFqdn;
  }

  /**
   * Normalize image according to Gitea Container Registry characteristics.
   * @param image
   * @returns {*}
   */
  normalizeImage(image) {
    const imageNormalized = image;
    imageNormalized.registry.url = `${this.configuration.url}/v2`;
    return imageNormalized;
  }
}

export default Gitea;
