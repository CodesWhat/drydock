// @ts-nocheck
import BaseRegistry from '../../BaseRegistry.js';

/**
 * Github Container Registry integration.
 */
class Ghcr extends BaseRegistry {
  private getRejectedCredentialStatus(error) {
    if (!(error instanceof Error)) {
      return undefined;
    }
    const match = error.message.match(
      /token request failed \(Request failed with status code (401|403)\)/,
    );
    return match ? match[1] : undefined;
  }

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
    const tokenExtractor = (response) => response.data.token || response.data.access_token;

    try {
      return await this.authenticateBearerFromAuthUrl(
        requestOptions,
        authUrl,
        credentials,
        tokenExtractor,
      );
    } catch (error) {
      const rejectedStatus = this.getRejectedCredentialStatus(error);
      if (!credentials || !rejectedStatus) {
        throw error;
      }

      this.log.warn(
        `GHCR credentials were rejected for registry ${this.getId()} (status ${rejectedStatus}); retrying token request without credentials for public image checks`,
      );

      return this.authenticateBearerFromAuthUrl(requestOptions, authUrl, undefined, tokenExtractor);
    }
  }
}

export default Ghcr;
