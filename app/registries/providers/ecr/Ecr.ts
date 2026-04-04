import { ECRClient, GetAuthorizationTokenCommand } from '@aws-sdk/client-ecr';
import axios from 'axios';
import { requireAuthString, withAuthorizationHeader } from '../../../security/auth.js';
import Registry from '../../Registry.js';

const ECR_PUBLIC_GALLERY_HOSTNAME = 'public.ecr.aws';

function getRegistryHost(registryUrl: string | undefined): string {
  if (!registryUrl) {
    return '';
  }

  try {
    const withProtocol =
      registryUrl.startsWith('http://') || registryUrl.startsWith('https://')
        ? registryUrl
        : `https://${registryUrl}`;
    return new URL(withProtocol).hostname;
  } catch {
    return registryUrl.split('/')[0] || '';
  }
}

/**
 * Elastic Container Registry integration.
 */
class Ecr extends Registry {
  getConfigurationSchema() {
    return this.joi.alternatives([
      this.joi.string().allow(''),
      this.joi.object().keys({
        accesskeyid: this.joi.string().required(),
        secretaccesskey: this.joi.string().required(),
        region: this.joi.string().required(),
      }),
    ]);
  }

  /**
   * Sanitize sensitive data
   * @returns {*}
   */
  maskConfiguration() {
    return {
      ...this.configuration,
      accesskeyid: Ecr.mask(this.configuration.accesskeyid),
      secretaccesskey: Ecr.mask(this.configuration.secretaccesskey),
      region: this.configuration.region,
    };
  }

  /**
   * Return true if image has not registryUrl.
   * @param image the image
   * @returns {boolean}
   */

  match(image) {
    return (
      /^.*\.dkr\.ecr\..*\.amazonaws\.com$/.test(image.registry.url) ||
      getRegistryHost(image.registry.url) === ECR_PUBLIC_GALLERY_HOSTNAME
    );
  }

  /**
   * Normalize image according to AWS ECR characteristics.
   * @param image
   * @returns {*}
   */

  normalizeImage(image) {
    const imageNormalized = {
      ...image,
      registry: {
        ...image.registry,
      },
    };
    if (
      !imageNormalized.registry.url.startsWith('https://') &&
      !imageNormalized.registry.url.startsWith('http://')
    ) {
      imageNormalized.registry.url = `https://${imageNormalized.registry.url}/v2`;
    }
    return imageNormalized;
  }

  async fetchPrivateEcrAuthToken() {
    const ecr = new ECRClient({
      credentials: {
        accessKeyId: this.configuration.accesskeyid,
        secretAccessKey: this.configuration.secretaccesskey,
      },
      region: this.configuration.region,
    });
    const command = new GetAuthorizationTokenCommand({});
    const authorizationToken = await ecr.send(command);
    return authorizationToken.authorizationData[0].authorizationToken;
  }

  async authenticate(image, requestOptions) {
    const requestOptionsWithAuth = {
      ...requestOptions,
      headers: {
        ...(requestOptions?.headers || {}),
      },
    };
    // Private registry
    if (this.configuration.accesskeyid) {
      const tokenValue = await this.fetchPrivateEcrAuthToken();
      return withAuthorizationHeader(
        requestOptionsWithAuth,
        'Basic',
        tokenValue,
        `Unable to authenticate registry ${this.getId()}: ECR authorization token is missing`,
      );

      // Public ECR gallery
    } else if (getRegistryHost(image?.registry?.url) === ECR_PUBLIC_GALLERY_HOSTNAME) {
      const response = await axios({
        method: 'GET',
        url: 'https://public.ecr.aws/token/',
        headers: {
          Accept: 'application/json',
        },
      });
      return withAuthorizationHeader(
        requestOptionsWithAuth,
        'Bearer',
        response.data.token,
        `Unable to authenticate registry ${this.getId()}: public ECR token endpoint response does not contain token`,
      );
    }
    return requestOptionsWithAuth;
  }

  async getAuthPull() {
    if (this.configuration.accesskeyid) {
      const tokenValue = requireAuthString(
        await this.fetchPrivateEcrAuthToken(),
        `Unable to authenticate registry ${this.getId()}: ECR authorization token is missing`,
      );
      const decodedToken = Buffer.from(tokenValue, 'base64').toString();
      const auth = decodedToken.split(':');
      if (auth.length !== 2 || !auth[0] || !auth[1]) {
        throw new Error(
          `Unable to authenticate registry ${this.getId()}: ECR authorization token is malformed`,
        );
      }
      return {
        username: auth[0],
        password: auth[1],
      };
    }
    return undefined;
  }
}

export default Ecr;
