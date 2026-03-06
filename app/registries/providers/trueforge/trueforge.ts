import Quay from '../quay/Quay.js';

/**
 * Linux-Server Container Registry integration.
 */
class Trueforge extends Quay {
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
}

export default Trueforge;
