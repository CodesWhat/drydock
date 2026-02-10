// @ts-nocheck
import Quay from '../quay/Quay.js';

/**
 * Linux-Server Container Registry integration.
 */
class Trueforge extends Quay {
    getConfigurationSchema() {
        return this.joi.alternatives([
            // Anonymous configuration
            this.joi.string().allow(''),

            // Auth configuration
            this.joi.object().keys({
                namespace: this.joi.string().required(),
                account: this.joi.string().required(),
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
        const url = image.registry.url;
        return url === 'oci.trueforge.org' || (url.endsWith('.oci.trueforge.org') && /^[a-zA-Z0-9.-]+$/.test(url));
    }

    /**
     * Normalize image according to Github Container Registry characteristics.
     * @param image
     * @returns {*}
     */

    normalizeImage(image) {
        const imageNormalized = image;
        if (!imageNormalized.registry.url.startsWith('https://')) {
            imageNormalized.registry.url = `https://${imageNormalized.registry.url}/v2`;
        }
        return imageNormalized;
    }
}

export default Trueforge;
