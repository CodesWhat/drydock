// @ts-nocheck
import Ghcr from '../ghcr/Ghcr.js';

/**
 * Linux-Server Container Registry integration.
 */
class Lscr extends Ghcr {
  getConfigurationSchema() {
    return this.joi.alternatives([
      // Anonymous configuration
      this.joi.string().allow(''),

      // Auth configuration
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
    return /^.*\.?lscr.io$/.test(image.registry.url);
  }

  /**
   * Normalize image according to Github Container Registry characteristics.
   * @param image
   * @returns {*}
   */

  normalizeImage(image) {
    return this.normalizeImageUrl(image);
  }
}

export default Lscr;
