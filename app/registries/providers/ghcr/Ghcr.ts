import axios from 'axios';
import BaseRegistry from '../../BaseRegistry.js';

/**
 * Github Container Registry integration.
 */
class Ghcr extends BaseRegistry {
  protected getTrustedAuthHosts(): string[] {
    return ['ghcr.io'];
  }

  private getRejectedCredentialStatus(error) {
    if (!(error instanceof Error)) {
      return undefined;
    }
    const match = error.message.match(
      /token request failed \(Request failed with status code (401|403)\)/,
    );
    return match ? match[1] : undefined;
  }

  private isNotFoundError(error) {
    return error instanceof Error && error.message.includes('status code 404');
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
    const credentials =
      this.configuration.username && this.configuration.token
        ? Ghcr.base64Encode(this.configuration.username, this.configuration.token)
        : undefined;
    const scope = encodeURIComponent(`repository:${image.name}:pull`);
    const authUrl = `https://ghcr.io/token?service=ghcr.io&scope=${scope}`;
    const tokenExtractor = (response) => response.data.token || response.data.access_token;

    try {
      return await this.authenticateBearerFromAuthUrl(
        requestOptions,
        authUrl,
        credentials,
        tokenExtractor,
      );
    } catch (error) {
      const rejectedStatus = this.getRejectedCredentialStatus(error);
      if (!credentials || !rejectedStatus) {
        throw error;
      }

      this.log.warn(
        `GHCR credentials were rejected for registry ${this.getId()} (status ${rejectedStatus}); retrying token request without credentials for public image checks`,
      );

      return this.authenticateBearerFromAuthUrl(requestOptions, authUrl, undefined, tokenExtractor);
    }
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
    const headers = this.getGithubApiHeaders();
    const orgUrl = `https://api.github.com/orgs/${ownerPath}/packages/container/${packagePath}/versions?per_page=100`;
    const userUrl = `https://api.github.com/users/${ownerPath}/packages/container/${packagePath}/versions?per_page=100`;

    try {
      const orgResponse = await axios({
        method: 'GET',
        url: orgUrl,
        headers,
      });
      return this.getVersionUpdatedAt(orgResponse?.data, tagToLookup);
    } catch (error) {
      if (!this.isNotFoundError(error)) {
        throw error;
      }
    }

    try {
      const userResponse = await axios({
        method: 'GET',
        url: userUrl,
        headers,
      });
      return this.getVersionUpdatedAt(userResponse?.data, tagToLookup);
    } catch (error) {
      if (this.isNotFoundError(error)) {
        return undefined;
      }
      throw error;
    }
  }
}

export default Ghcr;
