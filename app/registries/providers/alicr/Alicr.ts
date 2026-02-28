// @ts-nocheck
import BaseRegistry from '../../BaseRegistry.js';
import { getBasicAuthConfigurationSchema } from '../shared/basicAuthConfigurationSchema.js';

/**
 * Alibaba Cloud Container Registry integration.
 */
class Alicr extends BaseRegistry {
  getConfigurationSchema() {
    return getBasicAuthConfigurationSchema(this.joi);
  }

  maskConfiguration() {
    return this.maskSensitiveFields(['password', 'auth']);
  }

  private getRegistryHostname(value: string): string {
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
    const registryHostname = this.getRegistryHostname(image.registry.url);
    return (
      /^registry(?:-intl)?\.[a-z0-9-]+\.aliyuncs\.com$/i.test(registryHostname) ||
      /^(?:[a-z0-9-]+\.)*cr\.aliyuncs\.com(?:\.cn)?$/i.test(registryHostname)
    );
  }

  normalizeImage(image) {
    return this.normalizeImageUrl(image);
  }

  async authenticate(_image, requestOptions) {
    return this.authenticateBasic(requestOptions, this.getAuthCredentials());
  }
}

export default Alicr;
