import axios from 'axios';
import { withAuthorizationHeader } from '../../../security/auth.js';
import BaseRegistry, { type BaseRegistryConfiguration } from '../../BaseRegistry.js';

interface GarRegistryConfiguration extends BaseRegistryConfiguration {
  clientemail?: string;
  privatekey?: string;
}

interface GarTokenResponse {
  access_token?: unknown;
  token?: unknown;
}

/**
 * Google Artifact Registry integration.
 */
class Gar extends BaseRegistry<GarRegistryConfiguration> {
  private getServiceAccountCredentials(): string | undefined {
    /* v8 ignore next 3 -- GAR object config requires clientemail; absence is an anonymous fallback. */
    if (!this.configuration.clientemail) {
      return undefined;
    }

    return Gar.base64Encode(
      '_json_key',
      JSON.stringify({
        client_email: this.configuration.clientemail,
        private_key: this.configuration.privatekey,
      }),
    );
  }

  private extractToken(response: { data?: GarTokenResponse }): unknown {
    return response.data?.token || response.data?.access_token;
  }

  protected override getBearerChallengeAuthOptions() {
    return {
      credentials: this.getServiceAccountCredentials(),
      tokenExtractor: (response: { data?: GarTokenResponse }) => this.extractToken(response),
      tokenFailureMessage: `Unable to authenticate registry ${this.getId()}: GAR token endpoint response does not contain token`,
    };
  }

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
    const registryHostname = this.getRegistryHostname(image.registry?.url || '');
    return /^(?:[a-z0-9-]+\.)*[a-z0-9-]+-docker\.pkg\.dev$/i.test(registryHostname);
  }

  normalizeImage(image) {
    return this.normalizeImageUrl(image);
  }

  async authenticate(image, requestOptions) {
    if (!this.configuration.clientemail) {
      return requestOptions;
    }

    const registryHostname = this.getRegistryHostname(image.registry?.url || '');
    const tokenUrl = new URL('/v2/token', `https://${registryHostname}`);
    tokenUrl.searchParams.set('scope', `repository:${image.name}:pull`);
    tokenUrl.searchParams.set('service', registryHostname);

    const request = {
      method: 'GET',
      url: tokenUrl.toString(),
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${this.getServiceAccountCredentials()}`,
      },
    };

    const response = await axios(this.withTlsRequestOptions(request));
    return withAuthorizationHeader(
      requestOptions,
      'Bearer',
      this.extractToken(response),
      `Unable to authenticate registry ${this.getId()}: GAR token endpoint response does not contain token`,
    );
  }

  async getAuthPull() {
    return {
      username: this.configuration.clientemail,
      password: this.configuration.privatekey,
    };
  }
}

export default Gar;
