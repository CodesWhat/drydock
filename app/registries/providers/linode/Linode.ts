import BaseRegistry from '../../BaseRegistry.js';
import { getBasicAuthConfigurationSchema } from '../shared/basicAuthConfigurationSchema.js';

/**
 * Linode (Akamai) container registry integration.
 */
class Linode extends BaseRegistry {
  getConfigurationSchema() {
    return getBasicAuthConfigurationSchema(this.joi);
  }

  maskConfiguration() {
    return this.maskFields(['password', 'auth']);
  }

  match(image) {
    return this.matchRegistryHost(image, 'linode.com');
  }

  normalizeImage(image) {
    return this.normalizeImageUrl(image);
  }

  async authenticate(_image, requestOptions) {
    return this.authenticateBasic(requestOptions, this.getAuthCredentials());
  }
}

export default Linode;
