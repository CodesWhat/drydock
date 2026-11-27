import BaseRegistry from '../../BaseRegistry.js';
import { getBasicAuthConfigurationSchema } from '../shared/basicAuthConfigurationSchema.js';

/**
 * Elastic Container Registry (docker.elastic.co) integration.
 *
 * Anonymous pulls work through the standard bearer challenge handled by
 * BaseRegistry; login/password or auth are sent to the token endpoint.
 */
class Elastic extends BaseRegistry {
  getConfigurationSchema() {
    return getBasicAuthConfigurationSchema(this.joi);
  }

  maskConfiguration() {
    return this.maskFields(['password', 'auth']);
  }

  protected getTrustedAuthHosts(): string[] {
    return ['docker-auth.elastic.co'];
  }

  match(image) {
    return this.matchRegistryHost(image, 'docker.elastic.co');
  }

  normalizeImage(image) {
    return this.normalizeImageUrl(image);
  }

  async authenticate(_image, requestOptions) {
    return this.authenticateBasic(requestOptions, this.getAuthCredentials());
  }
}

export default Elastic;
