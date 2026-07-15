import { ECRClient, GetAuthorizationTokenCommand } from '@aws-sdk/client-ecr';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { requireAuthString, withAuthorizationHeader } from '../../../security/auth.js';
import BaseRegistry, { type BaseRegistryConfiguration } from '../../BaseRegistry.js';

const ECR_PUBLIC_GALLERY_HOSTNAME = 'public.ecr.aws';
const PRIVATE_ECR_AUTH_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const ECR_AUTH_TOKEN_REFRESH_WINDOW_MS = 5 * 60 * 1000;

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
interface EcrRegistryConfiguration extends BaseRegistryConfiguration {
  accesskeyid?: string;
  secretaccesskey?: string;
  region?: string;
}

interface EcrAuthTokenCacheEntry {
  cacheKey: string;
  expiresAtMs: number;
  token: string;
}

interface EcrAuthTokenFetchEntry {
  cacheKey: string;
  promise: Promise<string | undefined>;
}

class Ecr extends BaseRegistry<EcrRegistryConfiguration> {
  private privateEcrAuthTokenCache?: EcrAuthTokenCacheEntry;

  private privateEcrAuthTokenFetch?: EcrAuthTokenFetchEntry;

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

  getPrivateEcrAuthTokenCacheKey() {
    return [
      this.configuration.accesskeyid,
      this.configuration.secretaccesskey,
      this.configuration.region,
    ].join('\0');
  }

  getCachedPrivateEcrAuthToken(cacheKey: string) {
    if (!this.privateEcrAuthTokenCache || this.privateEcrAuthTokenCache.cacheKey !== cacheKey) {
      return undefined;
    }
    if (
      Date.now() >=
      this.privateEcrAuthTokenCache.expiresAtMs - ECR_AUTH_TOKEN_REFRESH_WINDOW_MS
    ) {
      return undefined;
    }
    return this.privateEcrAuthTokenCache.token;
  }

  async requestPrivateEcrAuthToken(cacheKey = this.getPrivateEcrAuthTokenCacheKey()) {
    const { accesskeyid, region, secretaccesskey } = this.configuration;
    const httpsAgent = this.withTlsRequestOptions({}).httpsAgent;
    const requestHandler = httpsAgent ? new NodeHttpHandler({ httpsAgent }) : undefined;
    const ecr = new ECRClient({
      credentials: {
        accessKeyId: accesskeyid,
        secretAccessKey: secretaccesskey,
      },
      region,
      ...(requestHandler ? { requestHandler } : {}),
    });
    const command = new GetAuthorizationTokenCommand({});
    const authorizationToken = await ecr.send(command);
    const token = authorizationToken.authorizationData[0].authorizationToken;
    if (
      typeof token === 'string' &&
      token.trim().length > 0 &&
      cacheKey === this.getPrivateEcrAuthTokenCacheKey()
    ) {
      this.privateEcrAuthTokenCache = {
        cacheKey,
        expiresAtMs: Date.now() + PRIVATE_ECR_AUTH_TOKEN_TTL_MS,
        token,
      };
    }
    return token;
  }

  async fetchPrivateEcrAuthToken() {
    const cacheKey = this.getPrivateEcrAuthTokenCacheKey();
    const cachedToken = this.getCachedPrivateEcrAuthToken(cacheKey);
    if (cachedToken !== undefined) {
      return cachedToken;
    }
    if (this.privateEcrAuthTokenFetch?.cacheKey === cacheKey) {
      return this.privateEcrAuthTokenFetch.promise;
    }

    const fetchEntry = {
      cacheKey,
      promise: this.requestPrivateEcrAuthToken(cacheKey).finally(() => {
        if (this.privateEcrAuthTokenFetch === fetchEntry) {
          this.privateEcrAuthTokenFetch = undefined;
        }
      }),
    };
    this.privateEcrAuthTokenFetch = fetchEntry;
    return fetchEntry.promise;
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
        this.withTlsRequestOptions(requestOptionsWithAuth),
        'Basic',
        tokenValue,
        `Unable to authenticate registry ${this.getId()}: ECR authorization token is missing`,
      );

      // Public ECR gallery
    } else if (getRegistryHost(image?.registry?.url) === ECR_PUBLIC_GALLERY_HOSTNAME) {
      return this.authenticateBearerFromAuthUrl(
        requestOptionsWithAuth,
        'https://public.ecr.aws/token/',
        undefined,
        undefined,
        `Unable to authenticate registry ${this.getId()}: public ECR token endpoint response does not contain token`,
        'https://public.ecr.aws',
      );
    }
    return this.withTlsRequestOptions(requestOptionsWithAuth);
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
