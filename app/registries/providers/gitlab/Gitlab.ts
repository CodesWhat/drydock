import BaseRegistry, { type BaseRegistryConfiguration } from '../../BaseRegistry.js';

export interface GitlabRegistryConfiguration extends BaseRegistryConfiguration {
  url?: string;
  authurl?: string;
  token?: string;
}

/**
 * Docker Gitlab integration.
 */
class Gitlab<
  TConfiguration extends GitlabRegistryConfiguration = GitlabRegistryConfiguration,
> extends BaseRegistry<TConfiguration> {
  protected getTrustedAuthHosts(): string[] {
    /* v8 ignore next -- GitLab config schema supplies authurl; empty config is direct-construction only. */
    return typeof this.configuration?.authurl === 'string' ? [this.configuration.authurl] : [];
  }

  private getTokenRequestCredentials(): string | undefined {
    /* v8 ignore next -- GitLab config schema requires token; missing token is direct-construction only. */
    return this.configuration.token ? Gitlab.base64Encode('', this.configuration.token) : undefined;
  }

  protected override getBearerChallengeAuthOptions() {
    return {
      credentials: this.getTokenRequestCredentials(),
      tokenFailureMessage: `Unable to authenticate registry ${this.getId()}: GitLab token endpoint response does not contain token`,
    };
  }

  /**
   * Get the Gitlab configuration schema.
   * @returns {*}
   */
  getConfigurationSchema(): import('joi').Schema {
    return this.joi.object().keys({
      url: this.joi.string().uri().default('https://registry.gitlab.com'),
      authurl: this.joi.string().uri().default('https://gitlab.com'),
      token: this.joi.string().required(),
    });
  }

  /**
   * Sanitize sensitive data
   * @returns {*}
   */
  maskConfiguration() {
    return this.maskFields(['token']);
  }

  /**
   * Return true if the image registry host equals the configured registry host.
   * @param image the image
   * @returns {boolean}
   */
  match(image) {
    const imageRegistryUrl = image?.registry?.url;
    if (typeof imageRegistryUrl !== 'string' || typeof this.configuration?.url !== 'string') {
      return false;
    }
    const configuredHost = Gitlab.getHostAndPort(this.configuration.url);
    return (
      configuredHost !== undefined && configuredHost === Gitlab.getHostAndPort(imageRegistryUrl)
    );
  }

  /**
   * Normalize a registry URL-like value into a lowercase host:port (default ports dropped).
   * Exact equality on this value is what keeps a lookalike host from receiving credentials.
   */
  private static getHostAndPort(value: string): string | undefined {
    const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    try {
      return new URL(withProtocol).host.toLowerCase();
    } catch {
      return undefined;
    }
  }

  /**
   * Normalize images according to Gitlab characteristics.
   * @param image
   * @returns {*}
   */

  normalizeImage(image) {
    return this.normalizeImageUrl(image);
  }

  /**
   * Authenticate to Gitlab.
   * @param image
   * @param requestOptions
   * @returns {Promise<*>}
   */
  async authenticate(image, requestOptions) {
    const scope = encodeURIComponent(`repository:${image.name}:pull`);
    const credentials = this.getTokenRequestCredentials();
    const authUrl = `${this.configuration.authurl}/jwt/auth?service=container_registry&scope=${scope}`;
    return this.authenticateBearerFromAuthUrl(
      requestOptions,
      authUrl,
      credentials,
      undefined,
      `Unable to authenticate registry ${this.getId()}: GitLab token endpoint response does not contain token`,
      this.configuration.url,
    );
  }

  /**
   * Return empty username and personal access token value.
   * @returns {{password: (string|undefined|*), username: string}}
   */
  async getAuthPull() {
    return {
      username: '',
      password: this.configuration.token,
    };
  }
}

export default Gitlab;
