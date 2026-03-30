import axios from 'axios';
import type { ContainerImage } from '../../../model/container.js';
import { withAuthorizationHeader } from '../../../security/auth.js';
import Custom from '../custom/Custom.js';
import { getTokenAuthConfigurationSchema } from '../shared/tokenAuthConfigurationSchema.js';

type AuthRequestOptions = Parameters<typeof withAuthorizationHeader>[0];

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
  async authenticate(image: ContainerImage, requestOptions: AuthRequestOptions) {
    const scope = encodeURIComponent(`repository:${image.name}:pull`);
    const axiosConfig = {
      method: 'GET',
      url: `https://auth.docker.io/token?service=registry.docker.io&scope=${scope}&grant_type=password`,
      headers: {
        Accept: 'application/json',
      } as Record<string, string>,
    };

    // Add Authorization when credentials are available
    const credentials = this.getAuthCredentials();
    if (credentials) {
      axiosConfig.headers.Authorization = `Basic ${credentials}`;
    }

    const response = await axios<HubTokenResponse>(axiosConfig);
    return withAuthorizationHeader(
      requestOptions,
      'Bearer',
      response.data.token,
      `Unable to authenticate registry ${this.getId()}: Docker Hub token endpoint response does not contain token`,
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
