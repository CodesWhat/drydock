import Quay from '../quay/Quay.js';

/**
 * Linux-Server Container Registry integration.
 */
class Trueforge extends Quay {
  getConfigurationSchema() {
    return this.joi.alternatives([
      // Anonymous configuration
      this.joi.string().allow(''),

      // Auth configuration (username + token, unlike Quay's namespace + account)
      this.joi.object().keys({
        username: this.joi.string().required(),
        token: this.joi.string().required(),
      }),
    ]);
  }

  /**
   * Return true if image has not registry url.
   * @param image the image
   * @returns {boolean}
   */

  match(image) {
    const url = image?.registry?.url;
    if (typeof url !== 'string') {
      return false;
    }
    return (
      url === 'oci.trueforge.org' ||
      (url.endsWith('.oci.trueforge.org') && /^[a-zA-Z0-9.-]+$/.test(url))
    );
  }

  /**
   * Normalize image according to Trueforge registry characteristics.
   * @param image
   * @returns {*}
   */

  normalizeImage(image) {
    return this.normalizeImageUrl(image);
  }

  /**
   * Return Base64 credentials if any.
   * @returns {string|undefined}
   */
  getAuthCredentials() {
    if (this.configuration.username) {
      return Trueforge.base64Encode(this.configuration.username, this.configuration.token);
    }
    return undefined;
  }

  /**
   * Return username / password for Docker(+compose) triggers usage.
   * @return {{password: string, username: string}|undefined}
   */
  async getAuthPull() {
    if (this.configuration.username) {
      return {
        username: this.configuration.username,
        password: this.configuration.token,
      };
    }
    return undefined;
  }
}

export default Trueforge;
