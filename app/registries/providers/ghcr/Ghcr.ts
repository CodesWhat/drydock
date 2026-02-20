// @ts-nocheck
import BaseRegistry from '../../BaseRegistry.js';

/**
 * Github Container Registry integration.
 */
class Ghcr extends BaseRegistry {
  getConfigurationSchema() {
    return this.joi.alternatives([
      this.joi.string().allow(''),
      this.joi.object().keys({
        username: this.joi.string().required(),
        token: this.joi.string().required(),
      }),
    ]);
  }

  maskConfiguration() {
    return this.maskSensitiveFields(['token']);
  }

  match(image) {
    return this.matchUrlPattern(image, /^.*\.?ghcr.io$/);
  }

  normalizeImage(image) {
    return this.normalizeImageUrl(image);
  }

  async authenticate(image, requestOptions) {
    const credentials =
      this.configuration.username && this.configuration.token
        ? Ghcr.base64Encode(this.configuration.username, this.configuration.token)
        : undefined;
    const scope = encodeURIComponent(`repository:${image.name}:pull`);
    const authUrl = `https://ghcr.io/token?service=ghcr.io&scope=${scope}`;
    return this.authenticateBearerFromAuthUrl(
      requestOptions,
      authUrl,
      credentials,
      (response) => response.data.token || response.data.access_token,
    );
  }
}

export default Ghcr;
