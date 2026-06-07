import BaseRegistry, { type BaseRegistryConfiguration } from '../../BaseRegistry.js';

interface GcrRegistryConfiguration extends BaseRegistryConfiguration {
  clientemail?: string;
  privatekey?: string;
}

interface GcrTokenResponse {
  access_token?: unknown;
  token?: unknown;
}

/**
 * Google Container Registry integration.
 */
class Gcr extends BaseRegistry<GcrRegistryConfiguration> {
  protected getTrustedAuthHosts(): string[] {
    return ['gcr.io'];
  }

  private getServiceAccountCredentials(): string | undefined {
    if (!this.configuration.clientemail) {
      return undefined;
    }

    return Gcr.base64Encode(
      '_json_key',
      JSON.stringify({
        client_email: this.configuration.clientemail,
        private_key: this.configuration.privatekey,
      }),
    );
  }

  private extractToken(response: { data?: GcrTokenResponse }): unknown {
    return response.data?.token || response.data?.access_token;
  }

  protected override getBearerChallengeAuthOptions() {
    return {
      credentials: this.getServiceAccountCredentials(),
      tokenExtractor: (response: { data?: GcrTokenResponse }) => this.extractToken(response),
      tokenFailureMessage: `Unable to authenticate registry ${this.getId()}: GCR token endpoint response does not contain token`,
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
    return this.matchUrlPattern(image, /^.*\.?gcr.io$/);
  }

  normalizeImage(image) {
    return this.normalizeImageUrl(image);
  }

  async authenticate(image, requestOptions) {
    if (!this.configuration.clientemail) {
      return requestOptions;
    }
    const credentials = this.getServiceAccountCredentials();

    return this.authenticateBearerFromAuthUrlWithPublicFallback(
      requestOptions,
      `https://gcr.io/v2/token?scope=repository:${image.name}:pull`,
      credentials,
      {
        providerLabel: 'GCR',
        tokenFailureMessage: `Unable to authenticate registry ${this.getId()}: GCR token endpoint response does not contain token`,
        tokenExtractor: (response: { data?: GcrTokenResponse }) => this.extractToken(response),
      },
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
