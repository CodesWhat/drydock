// @ts-nocheck
import axios from 'axios';
import { withAuthorizationHeader } from '../../../security/auth.js';
import Gitlab from '../gitlab/Gitlab.js';

/**
 * dock.mau.dev (GitLab-based) Container Registry integration.
 */
class Mau extends Gitlab {
  /**
   * Get the mau configuration schema.
   * @returns {*}
   */
  getConfigurationSchema() {
    return this.joi.alternatives([
      this.joi.string().allow(''),
      this.joi.object().keys({
        url: this.joi.string().uri().default('https://dock.mau.dev'),
        authurl: this.joi.string().uri().default('https://dock.mau.dev'),
        token: this.joi.string(),
      }),
    ]);
  }

  /**
   * Custom init behavior.
   */
  init() {
    this.configuration = this.configuration || {};
    if (typeof this.configuration === 'string') {
      this.configuration = {};
    }
    this.configuration.url = this.configuration.url || 'https://dock.mau.dev';
    this.configuration.authurl = this.configuration.authurl || 'https://dock.mau.dev';
  }

  /**
   * Sanitize sensitive data.
   * @returns {*}
   */
  maskConfiguration() {
    return this.maskSensitiveFields(['token']);
  }

  /**
   * Return true if image registry matches dock.mau.dev.
   * @param image the image
   * @returns {boolean}
   */
  match(image) {
    const url = image?.registry?.url;
    if (typeof url !== 'string') {
      return false;
    }
    return (
      url === 'dock.mau.dev' ||
      (url.endsWith('.dock.mau.dev') && /^[a-zA-Z0-9.-]+$/.test(url))
    );
  }

  /**
   * Authenticate to dock.mau.dev.
   * @param image
   * @param requestOptions
   * @returns {Promise<*>}
   */
  async authenticate(image, requestOptions) {
    const request = {
      method: 'GET',
      url: `${this.configuration.authurl}/jwt/auth?service=container_registry&scope=repository:${image.name}:pull`,
      headers: {
        Accept: 'application/json',
      },
    };

    if (this.configuration.token) {
      request.headers.Authorization = `Basic ${Mau.base64Encode('', this.configuration.token)}`;
    }

    const response = await axios(request);
    return withAuthorizationHeader(
      requestOptions,
      'Bearer',
      response.data.token,
      `Unable to authenticate registry ${this.getId()}: dock.mau.dev token endpoint response does not contain token`,
    );
  }

  /**
   * Return auth for pull when token is configured.
   * @returns {{password: *, username: string}|undefined}
   */
  async getAuthPull() {
    if (!this.configuration.token) {
      return undefined;
    }
    return {
      username: '',
      password: this.configuration.token,
    };
  }
}

export default Mau;
