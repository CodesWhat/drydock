import axios, { type AxiosRequestConfig } from 'axios';
import type { ContainerImage } from '../../../model/container.js';
import Custom from '../custom/Custom.js';
import { getTokenAuthConfigurationSchema } from '../shared/tokenAuthConfigurationSchema.js';

interface HubTokenResponse {
  token?: unknown;
}

interface HubTagMetadataResponse {
  last_updated?: unknown;
}

/**
 * Docker Hub integration.
 */
class Hub extends Custom {
  protected getTrustedAuthHosts(): string[] {
    return ['auth.docker.io'];
  }

  init() {
    this.configuration.url = 'https://registry-1.docker.io';
    if (this.configuration.token) {
      this.configuration.password = this.configuration.token;
    }
  }

  /**
   * Get the Hub configuration schema.
   * @returns {*}
   */
  getConfigurationSchema() {
    return getTokenAuthConfigurationSchema(this.joi);
  }

  /**
   * Sanitize sensitive data
   * @returns {*}
   */
  maskConfiguration() {
    return this.maskSensitiveFields(['password', 'token', 'auth']);
  }

  /**
   * Return true if image has no registry url.
   * @param image the image
   * @returns {boolean}
   */

  match(image: ContainerImage) {
    const registryUrl = image?.registry?.url;
    return (
      !registryUrl ||
      registryUrl === 'docker.io' ||
      (registryUrl.endsWith('.docker.io') && /^[a-zA-Z0-9.-]+$/.test(registryUrl))
    );
  }

  /**
   * Normalize images according to Hub characteristics.
   * @param image
   * @returns {*}
   */
  normalizeImage(image: ContainerImage) {
    const imageNormalized = super.normalizeImage(image);
    if (imageNormalized.name) {
      imageNormalized.name = imageNormalized.name.includes('/')
        ? imageNormalized.name
        : `library/${imageNormalized.name}`;
    }
    return imageNormalized;
  }

  /**
   * Authenticate to Hub.
   * @param image
   * @param requestOptions
   * @returns {Promise<*>}
   */
  async authenticate(image: ContainerImage, requestOptions: AxiosRequestConfig) {
    const scope = encodeURIComponent(`repository:${image.name}:pull`);
    const credentials = this.getAuthCredentials();
    return this.authenticateBearerFromAuthUrlWithPublicFallback(
      requestOptions,
      `https://auth.docker.io/token?service=registry.docker.io&scope=${scope}&grant_type=password`,
      credentials || undefined,
      {
        providerLabel: 'Docker Hub',
        tokenFailureMessage: `Unable to authenticate registry ${this.getId()}: Docker Hub token endpoint response does not contain token`,
        tokenExtractor: (response: { data?: HubTokenResponse }) => response.data?.token,
      },
    );
  }

  getImageFullName(image: ContainerImage, tagOrDigest: string) {
    let fullName = super.getImageFullName(image, tagOrDigest);
    fullName = fullName.replaceAll('registry-1.docker.io/', '');
    fullName = fullName.replaceAll('library/', '');
    return fullName;
  }

  async getImagePublishedAt(image: ContainerImage, tag?: string): Promise<string | undefined> {
    const tagToLookup = typeof tag === 'string' && tag.length > 0 ? tag : image.tag?.value;
    if (typeof image.name !== 'string' || image.name.length === 0 || !tagToLookup) {
      return undefined;
    }

    const response = await axios<HubTagMetadataResponse>({
      method: 'GET',
      url: `https://hub.docker.com/v2/repositories/${image.name}/tags/${encodeURIComponent(
        tagToLookup,
      )}`,
      headers: {
        Accept: 'application/json',
      },
    });
    const publishedAt = response?.data?.last_updated;
    if (typeof publishedAt !== 'string') {
      return undefined;
    }
    return Number.isNaN(Date.parse(publishedAt)) ? undefined : publishedAt;
  }
}

export default Hub;
