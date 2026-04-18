import Forgejo from '../forgejo/Forgejo.js';
import type { SelfHostedBasicConfiguration } from '../shared/SelfHostedBasic.js';

interface CodebergRegistryConfiguration extends SelfHostedBasicConfiguration {
  login?: string;
  password?: string;
  auth?: string;
}

/**
 * Codeberg Container Registry integration.
 */
class Codeberg extends Forgejo<CodebergRegistryConfiguration> {
  getConfigurationSchema() {
    const authSchema = this.joi
      .alternatives()
      .try(this.joi.string().base64(), this.joi.string().valid(''));

    const credentialsSchema = this.joi
      .object()
      .keys({
        login: this.joi.string(),
        password: this.joi.string(),
        auth: authSchema,
      })
      .and('login', 'password')
      .without('login', 'auth');

    return credentialsSchema.allow('');
  }

  init() {
    this.configuration = this.configuration || {};
    if (typeof this.configuration === 'string') {
      this.configuration = {};
    }
    this.configuration.url = 'https://codeberg.org';
  }
}

export default Codeberg;
