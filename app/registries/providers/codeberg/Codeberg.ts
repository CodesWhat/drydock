import Forgejo from '../forgejo/Forgejo.js';

/**
 * Codeberg Container Registry integration.
 */
class Codeberg extends Forgejo {
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

    return this.joi.alternatives().try(this.joi.string().allow(''), credentialsSchema);
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
