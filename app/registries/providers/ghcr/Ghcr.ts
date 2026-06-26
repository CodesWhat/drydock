import axios from 'axios';
import BaseRegistry, { type BaseRegistryConfiguration } from '../../BaseRegistry.js';

interface GhcrRegistryConfiguration extends BaseRegistryConfiguration {
  username?: string;
  token?: string;
}

interface GhcrTokenResponse {
  access_token?: unknown;
  token?: unknown;
}

/**
 * Github Container Registry integration.
 */
class Ghcr extends BaseRegistry<GhcrRegistryConfiguration> {
  override readonly publishedAtIsPushDate = true;

  protected getTrustedAuthHosts(): string[] {
    return ['ghcr.io'];
  }

  private getTokenRequestCredentials(): string | undefined {
    return this.configuration.username && this.configuration.token
      ? Ghcr.base64Encode(this.configuration.username, this.configuration.token)
      : undefined;
  }

  private extractToken(response: { data?: GhcrTokenResponse }): unknown {
    return response.data?.token || response.data?.access_token;
  }

  protected override getBearerChallengeAuthOptions() {
    return {
      credentials: this.getTokenRequestCredentials(),
      tokenExtractor: (response: { data?: GhcrTokenResponse }) => this.extractToken(response),
    };
  }

  private isNotFoundError(error) {
    return axios.isAxiosError(error) && error.response?.status === 404;
  }

  private getGithubApiHeaders() {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
    };
    if (typeof this.configuration?.token === 'string' && this.configuration.token.length > 0) {
      headers.Authorization = `Bearer ${this.configuration.token}`;
    }
    return headers;
  }

  private getVersionUpdatedAt(versions, tagToLookup: string): string | undefined {
    if (!Array.isArray(versions)) {
      return undefined;
    }

    const matchingVersion = versions.find((version) => {
      const tags = version?.metadata?.container?.tags;
      return Array.isArray(tags) && tags.includes(tagToLookup);
    });
    const updatedAt = matchingVersion?.updated_at;
    if (typeof updatedAt !== 'string') {
      return undefined;
    }
    return Number.isNaN(Date.parse(updatedAt)) ? undefined : updatedAt;
  }

  getConfigurationSchema() {
    return this.joi.alternatives([
      this.joi.string().allow(''),
      this.joi.object().keys({
        username: this.joi.string().required(),
        token: this.joi.string().required(),
      }),
    ]);
  }

  maskConfiguration() {
    return this.maskSensitiveFields(['token']);
  }

  match(image) {
    return this.matchUrlPattern(image, /^.*\.?ghcr.io$/);
  }

  normalizeImage(image) {
    return this.normalizeImageUrl(image);
  }

  async authenticate(image, requestOptions) {
    const credentials = this.getTokenRequestCredentials();
    const scope = encodeURIComponent(`repository:${image.name}:pull`);
    const authUrl = `https://ghcr.io/token?service=ghcr.io&scope=${scope}`;
    return this.authenticateBearerFromAuthUrlWithPublicFallback(
      requestOptions,
      authUrl,
      credentials,
      {
        tokenExtractor: (response: { data?: GhcrTokenResponse }) => this.extractToken(response),
        providerLabel: 'GHCR',
      },
    );
  }

  private async fetchVersionsPagedForOwner(
    baseUrl: string,
    tagToLookup: string,
  ): Promise<string | undefined> {
    const perPage = 100;
    const maxPages = 10;
    const headers = this.getGithubApiHeaders();

    for (let page = 1; page <= maxPages; page++) {
      const response = await axios({
        method: 'GET',
        url: `${baseUrl}?per_page=${perPage}&page=${page}`,
        headers,
      });

      const versions = response?.data;
      const result = this.getVersionUpdatedAt(versions, tagToLookup);
      if (result !== undefined) {
        return result;
      }

      if (!Array.isArray(versions) || versions.length < perPage) {
        break;
      }
    }

    return undefined;
  }

  async getImagePublishedAt(image, tag?: string): Promise<string | undefined> {
    const tagToLookup = typeof tag === 'string' && tag.length > 0 ? tag : image.tag?.value;
    if (!tagToLookup || typeof image.name !== 'string' || image.name.length === 0) {
      return undefined;
    }

    const [owner, ...packageNameParts] = image.name.split('/');
    if (!owner || packageNameParts.length === 0) {
      return undefined;
    }
    const packageName = packageNameParts.join('/');
    const ownerPath = encodeURIComponent(owner);
    const packagePath = encodeURIComponent(packageName);
    const orgBaseUrl = `https://api.github.com/orgs/${ownerPath}/packages/container/${packagePath}/versions`;
    const userBaseUrl = `https://api.github.com/users/${ownerPath}/packages/container/${packagePath}/versions`;

    try {
      return await this.fetchVersionsPagedForOwner(orgBaseUrl, tagToLookup);
    } catch (error) {
      if (!this.isNotFoundError(error)) {
        throw error;
      }
    }

    try {
      return await this.fetchVersionsPagedForOwner(userBaseUrl, tagToLookup);
    } catch (error) {
      if (this.isNotFoundError(error)) {
        return undefined;
      }
      throw error;
    }
  }
}

export default Ghcr;
