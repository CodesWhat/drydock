import axios from 'axios';
import { withAuthorizationHeader } from '../../../security/auth.js';
import Custom from '../custom/Custom.js';
import { getTokenAuthConfigurationSchema } from '../shared/tokenAuthConfigurationSchema.js';

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

  match(image) {
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
  normalizeImage(image) {
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
  async authenticate(image, requestOptions) {
    const scope = encodeURIComponent(`repository:${image.name}:pull`);
    const axiosConfig = {
      method: 'GET',
      url: `https://auth.docker.io/token?service=registry.docker.io&scope=${scope}&grant_type=password`,
      headers: {
        Accept: 'application/json',
      } as Record<string, string>,
    };

    // Add Authorization if any
    const credentials = this.getAuthCredentials();
    if (credentials) {
      axiosConfig.headers.Authorization = `Basic ${credentials}`;
    }

    const response = await axios(axiosConfig);
    return withAuthorizationHeader(
      requestOptions,
      'Bearer',
      response.data.token,
      `Unable to authenticate registry ${this.getId()}: Docker Hub token endpoint response does not contain token`,
    );
  }

  getImageFullName(image, tagOrDigest) {
    let fullName = super.getImageFullName(image, tagOrDigest);
    fullName = fullName.replaceAll('registry-1.docker.io/', '');
    fullName = fullName.replaceAll('library/', '');
    return fullName;
  }

  async getImagePublishedAt(image, tag?: string): Promise<string | undefined> {
    const tagToLookup = typeof tag === 'string' && tag.length > 0 ? tag : image.tag?.value;
    if (typeof image.name !== 'string' || image.name.length === 0 || !tagToLookup) {
      return undefined;
    }

    const response = await axios({
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
