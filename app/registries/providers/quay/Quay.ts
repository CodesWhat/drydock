// @ts-nocheck
import BaseRegistry from '../../BaseRegistry.js';

/**
 * Quay.io Registry integration.
 */
class Quay extends BaseRegistry {
  getConfigurationSchema() {
    return this.joi.alternatives([
      // Anonymous configuration
      this.joi
        .string()
        .allow(''),

      // Auth configuration
      this.joi
        .object()
        .keys({
          namespace: this.joi.string().required(),
          account: this.joi.string().required(),
          token: this.joi.string().required(),
        }),
    ]);
  }

  /**
   * Sanitize sensitive data
   * @returns {*}
   */
  maskConfiguration() {
    return this.maskSensitiveFields(['token']);
  }

  /**
   * Return true if image has not registry url.
   * @param image the image
   * @returns {boolean}
   */
  match(image) {
    return this.matchUrlPattern(image, /^.*\.?quay\.io$/);
  }

  /**
   * Normalize image according to Quay.io Registry characteristics.
   * @param image
   * @returns {*}
   */
  normalizeImage(image) {
    return this.normalizeImageUrl(image);
  }

  async authenticate(image, requestOptions) {
    const credentials = this.getAuthCredentials();
    if (!credentials) {
      return requestOptions;
    }
    const authUrl = `https://quay.io/v2/auth?service=quay.io&scope=repository:${image.name}:pull`;
    return this.authenticateBearerFromAuthUrl(
      requestOptions,
      authUrl,
      credentials,
      (response) => response.data.token,
    );
  }

  /**
   * Return Base64 credentials if any.
   * @returns {string|undefined|*}
   */
  getAuthCredentials() {
    if (this.configuration.namespace && this.configuration.account) {
      return Quay.base64Encode(
        `${this.configuration.namespace}+${this.configuration.account}`,
        this.configuration.token,
      );
    }
    return undefined;
  }

  /**
   * Return username / password for Docker(+compose) triggers usage
   * @return {{password: string, username: string}|undefined}
   */
  async getAuthPull() {
    if (this.configuration.namespace && this.configuration.account) {
      return {
        username: `${this.configuration.namespace}+${this.configuration.account}`,
        password: this.configuration.token,
      };
    }
    return undefined;
  }

  getTagsPage(image, lastItem, link) {
    // Default items per page (not honoured by all registries)
    const itemsPerPage = 1000;
    let nextOrLast = '';
    if (link) {
      const nextPageRegex = link.match(/^.*next_page=(.*)$/);
      const lastRegex = link.match(/^.*last=(.*)>;.*$/);
      if (nextPageRegex) {
        nextOrLast = `&next_page=${nextPageRegex[1]}`;
      } else if (lastRegex) {
        nextOrLast = `&last=${lastRegex[1]}`;
      }
    }
    return this.callRegistry({
      image,
      url: `${image.registry.url}/${image.name}/tags/list?n=${itemsPerPage}${nextOrLast}`,
      resolveWithFullResponse: true,
    });
  }
}

export default Quay;
