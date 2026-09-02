import axios from 'axios';
import { toPositiveInteger } from '../../../util/parse.js';
import BaseRegistry, { type BaseRegistryConfiguration } from '../../BaseRegistry.js';
import { getRegistryRequestTimeoutMs } from '../../configuration.js';

interface GhcrRegistryConfiguration extends BaseRegistryConfiguration {
  username?: string;
  token?: string;
}

// 500 pages @ 100/page = 50,000 versions. A deliberate safety backstop against a
// pathological/huge repo or a misbehaving mirror, not a removal of the cap — real
// repos essentially never hit it now that pagination follows the `Link` header's
// literal rel="next" URL instead of guessing from page-length, so only a truly
// enormous or adversarial version list reaches this ceiling.
const DEFAULT_GHCR_VERSIONS_MAX_PAGES = 500;
export const GHCR_VERSIONS_MAX_PAGES = toPositiveInteger(
  process.env.DD_GHCR_VERSIONS_MAX_PAGES,
  DEFAULT_GHCR_VERSIONS_MAX_PAGES,
);

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
    return this.matchRegistryHost(image, 'ghcr.io');
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

  /**
   * Parse the RFC 5988 `Link` response header GitHub's REST API returns on every
   * paginated response and pull out the literal `rel="next"` URL, if present.
   * Authoritative over `versions.length < perPage` — that heuristic is wrong
   * exactly on the boundary case where the true count is a multiple of perPage.
   */
  private parseNextLink(linkHeader: string | undefined): string | undefined {
    if (!linkHeader) {
      return undefined;
    }
    for (const part of linkHeader.split(',')) {
      const match = part.match(/<([^>]+)>\s*;\s*rel="next"/);
      if (match) {
        return match[1];
      }
    }
    return undefined;
  }

  /**
   * Whether candidateUrl shares expectedOrigin. A hostile or compromised Link
   * response header must never be able to redirect our Authorization-bearing
   * follow-up request to another host — that would exfiltrate the GHCR token
   * to whatever origin the header names. A malformed candidate URL is treated
   * as cross-origin (fails closed).
   */
  private isSameOrigin(candidateUrl: string, expectedOrigin: string): boolean {
    try {
      return new URL(candidateUrl).origin === expectedOrigin;
    } catch {
      return false;
    }
  }

  private async fetchVersionsPagedForOwner(
    baseUrl: string,
    tagToLookup: string,
  ): Promise<string | undefined> {
    const headers = this.getGithubApiHeaders();
    const expectedOrigin = new URL(baseUrl).origin;
    let url: string | undefined = `${baseUrl}?per_page=100`;
    let pagesFetched = 0;

    while (url && pagesFetched < GHCR_VERSIONS_MAX_PAGES) {
      const response = await axios({
        method: 'GET',
        url,
        headers,
        timeout: getRegistryRequestTimeoutMs(),
      });
      pagesFetched += 1;

      const result = this.getVersionUpdatedAt(response?.data, tagToLookup);
      if (result !== undefined) {
        return result;
      }

      const nextUrl = this.parseNextLink(response?.headers?.link);
      url = nextUrl && this.isSameOrigin(nextUrl, expectedOrigin) ? nextUrl : undefined;
      if (nextUrl !== undefined && url === undefined) {
        // A next page was advertised but pointed off-origin — never follow it with
        // the Authorization header attached. Treat exactly like truncation: warn,
        // stop, and let the caller's existing "no trusted publishedAt" fallback
        // handle it (fail-closed, same as the safety-cap case below).
        this.log.warn(
          `GHCR versions pagination for ${baseUrl} received a Link: rel="next" URL ` +
            `outside the expected origin (${expectedOrigin}); refusing to follow it. ` +
            'publishedAt left untrusted for this candidate',
        );
      }
    }

    if (url !== undefined) {
      // Safety cap hit while a next page still existed — the scan is INCOMPLETE, not
      // "confirmed absent". Never treat a truncated list as complete: log so the
      // degraded case is operationally visible, then return undefined exactly like
      // the "genuinely not found" path — the caller already treats undefined as "no
      // trusted publishedAt available" (fail-closed), so the return contract is
      // unchanged; only the diagnosability of this specific case improves.
      this.log.warn(
        `GHCR versions pagination for ${baseUrl} exceeded ${GHCR_VERSIONS_MAX_PAGES} pages ` +
          `(${GHCR_VERSIONS_MAX_PAGES * 100}+ versions) before finding tag '${tagToLookup}'; ` +
          'publishedAt left untrusted for this candidate',
      );
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
