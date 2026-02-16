import axios from 'axios';
import type { ContainerImage } from '../../../model/container.js';
import BaseRegistry from '../../BaseRegistry.js';

/**
 * Google Artifact Registry integration.
 */
class Gar extends BaseRegistry {
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

  private getRegistryHostname(image: ContainerImage): string {
    const registryUrl = image.registry?.url || '';
    const withProtocol = /^https?:\/\//i.test(registryUrl)
      ? registryUrl
      : `https://${registryUrl}`;
    try {
      return new URL(withProtocol).hostname;
    } catch {
      return registryUrl.split('/')[0];
    }
  }

  match(image) {
    const registryHostname = this.getRegistryHostname(image);
    return /^(?:[a-z0-9-]+\.)*[a-z0-9-]+-docker\.pkg\.dev$/i.test(registryHostname);
  }

  normalizeImage(image) {
    return this.normalizeImageUrl(image);
  }

  async authenticate(image, requestOptions) {
    if (!this.configuration.clientemail) {
      return requestOptions;
    }

    const registryHostname = this.getRegistryHostname(image);
    const tokenUrl = new URL('/v2/token', `https://${registryHostname}`);
    tokenUrl.searchParams.set('scope', `repository:${image.name}:pull`);
    tokenUrl.searchParams.set('service', registryHostname);

    const request = {
      method: 'GET',
      url: tokenUrl.toString(),
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${Gar.base64Encode(
          '_json_key',
          JSON.stringify({
            client_email: this.configuration.clientemail,
            private_key: this.configuration.privatekey,
          }),
        )}`,
      },
    };

    const response = await axios(request);
    const token = response.data.token || response.data.access_token;
    const requestOptionsWithAuth = {
      ...requestOptions,
      headers: {
        ...(requestOptions.headers || {}),
      },
    };
    if (token) {
      requestOptionsWithAuth.headers.Authorization = `Bearer ${token}`;
    }
    return requestOptionsWithAuth;
  }

  async getAuthPull() {
    return {
      username: this.configuration.clientemail,
      password: this.configuration.privatekey,
    };
  }
}

export default Gar;
