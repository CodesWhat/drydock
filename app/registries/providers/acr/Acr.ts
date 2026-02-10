// @ts-nocheck
import BaseRegistry from '../../BaseRegistry.js';

/**
 * Azure Container Registry integration.
 */
class Acr extends BaseRegistry {
    getConfigurationSchema() {
        return this.joi.object().keys({
            clientid: this.joi.string().required(),
            clientsecret: this.joi.string().required(),
        });
    }

    /**
     * Sanitize sensitive data
     * @returns {*}
     */
    maskConfiguration() {
        return this.maskSensitiveFields(['clientsecret']);
    }

    /**
     * Return true if image has not registryUrl.
     * @param image the image
     * @returns {boolean}
     */

    match(image) {
        return /^.*\.?azurecr.io$/.test(image.registry.url);
    }

    /**
     * Normalize image according to AWS ECR characteristics.
     * @param image
     * @returns {*}
     */

    normalizeImage(image) {
        return this.normalizeImageUrl(image);
    }

    async authenticate(image, requestOptions) {
        const requestOptionsWithAuth = requestOptions;
        requestOptionsWithAuth.headers.Authorization = `Basic ${Acr.base64Encode(this.configuration.clientid, this.configuration.clientsecret)}`;
        return requestOptionsWithAuth;
    }

    async getAuthPull() {
        return {
            username: this.configuration.clientid,
            password: this.configuration.clientsecret,
        };
    }
}

export default Acr;
