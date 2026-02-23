// @ts-nocheck
import axios from 'axios';
import { withAuthorizationHeader } from '../../../security/auth.js';
import BaseRegistry from '../../BaseRegistry.js';

/**
 * Google Container Registry integration.
 */
class Gcr extends BaseRegistry {
  getConfigurationSchema() {
    return this.joi.alternatives([
      this.joi.string().allow(''),
      this.joi.object().keys({
        clientemail: this.joi.string().required(),
        privatekey: this.joi.string().required(),
      }),
    ]);
  }

  maskConfiguration() {
    return this.maskSensitiveFields(['privatekey']);
  }

  match(image) {
    return this.matchUrlPattern(image, /^.*\.?gcr.io$/);
  }

  normalizeImage(image) {
    return this.normalizeImageUrl(image);
  }

  async authenticate(image, requestOptions) {
    if (!this.configuration.clientemail) {
      return requestOptions;
    }
    const request = {
      method: 'GET',
      url: `https://gcr.io/v2/token?scope=repository:${image.name}:pull`,
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${Gcr.base64Encode(
          '_json_key',
          JSON.stringify({
            client_email: this.configuration.clientemail,
            private_key: this.configuration.privatekey,
          }),
        )}`,
      },
    };

    const response = await axios(request);
    return withAuthorizationHeader(
      requestOptions,
      'Bearer',
      response.data.token,
      `Unable to authenticate registry ${this.getId()}: GCR token endpoint response does not contain token`,
    );
  }

  async getAuthPull() {
    return {
      username: this.configuration.clientemail,
      password: this.configuration.privatekey,
    };
  }
}

export default Gcr;
