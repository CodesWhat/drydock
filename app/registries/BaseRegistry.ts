import fs from 'node:fs';
import https from 'node:https';
import axios, { type AxiosRequestConfig } from 'axios';
import { RE2JS } from 're2js';
import { sanitizeLogParam } from '../log/sanitize.js';
import type { ContainerImage } from '../model/container.js';
import * as registryPrometheus from '../prometheus/registry.js';
import { resolveConfiguredPath } from '../runtime/paths.js';
import { failClosedAuth, requireAuthString, withAuthorizationHeader } from '../security/auth.js';
import { getErrorMessage } from '../util/error.js';
import { REGISTRY_BEARER_TOKEN_CACHE_TTL_MS } from './configuration.js';
import { withRetry } from './http-retry.js';
import Registry, { type RegistryLookupOptions } from './Registry.js';
import { acquireToken, getBucketForUrl } from './token-bucket.js';
import { parseBearerChallenge } from './www-authenticate.js';

export interface BaseRegistryConfiguration {
  url?: string;
  insecure?: boolean;
  cafile?: string;
  clientcert?: string;
  clientkey?: string;
  auth?: string;
  login?: string;
  password?: string;
  token?: string;
  username?: string;
}

type RegistryRequestOptions = AxiosRequestConfig;
type RegistryManifestLookupResult = Awaited<ReturnType<Registry['getImageManifestDigest']>>;
type DigestCacheEntry = {
  digest: string;
  created?: string;
  version?: number;
  fetchedAt: number;
};
type BearerChallengeAuthOptions = {
  credentials?: string;
  tokenExtractor?: (response: { data?: Record<string, unknown> }) => unknown;
  tokenFailureMessage?: string;
};

class RegistryCredentialRejectedError extends Error {}

/**
 * Pre-compiled RE2 pattern for `getRejectedCredentialStatus`.
 * The status codes are substituted at call time via string interpolation;
 * only the outer pattern is constant and compiled once at module load.
 * When the set of candidate statuses changes we rebuild, but the common
 * case (default [401, 403]) is captured by a dedicated module-level constant.
 */
const REJECTED_CREDENTIAL_DEFAULT_PATTERN = RE2JS.compile(
  'token request failed \\(Request failed with status code (401|403)\\)',
);

/**
 * Base Registry with common patterns
 */
class BaseRegistry<
  TConfiguration extends BaseRegistryConfiguration = BaseRegistryConfiguration,
> extends Registry<TConfiguration> {
  readonly publishedAtIsPushDate: boolean = false;

  private httpsAgent?: https.Agent;
  private bearerTokenCache = new Map<string, { token: string; expiresAt: number }>();
  private digestManifestCache = new Map<string, DigestCacheEntry>();
  private digestManifestCacheInFlight = new Map<string, Promise<RegistryManifestLookupResult>>();
  private tagListCache = new Map<string, string[]>();
  private tagListCacheInFlight = new Map<string, Promise<string[]>>();
  private digestCachePollCycleActive = false;
  private digestCacheHits = 0;
  private digestCacheMisses = 0;

  private getBearerTokenCacheKey(authUrl: string, credentials?: string) {
    return `${authUrl}|${credentials || ''}`;
  }

  private pruneExpiredBearerTokenCache(now: number) {
    for (const [key, cachedToken] of this.bearerTokenCache.entries()) {
      if (now >= cachedToken.expiresAt) {
        this.bearerTokenCache.delete(key);
      }
    }
  }

  private getCanonicalRegistryHost(registryUrl: string | undefined): string {
    if (!registryUrl || registryUrl.trim().length === 0) {
      return 'docker.io';
    }

    const host = this.getRegistryHostname(registryUrl);
    if (host === 'registry-1.docker.io' || host === 'index.docker.io') {
      return 'docker.io';
    }
    return host;
  }

  private getDigestCacheImageLabel(image: ContainerImage, digest?: string): string {
    const registryUrl =
      typeof image?.registry?.url === 'string' && image.registry.url.length > 0
        ? image.registry.url
        : 'unknown-registry';
    const imageName =
      typeof image?.name === 'string' && image.name.length > 0 ? image.name : 'unknown-image';
    const tagOrDigest =
      typeof digest === 'string' && digest.length > 0
        ? digest
        : image?.tag?.value || image?.digest?.value || 'latest';

    return `${registryUrl}/${imageName}:${tagOrDigest}`;
  }

  private buildDigestCacheKey(image: ContainerImage, digest?: string): string {
    let normalizedImage: ContainerImage;
    try {
      normalizedImage = this.normalizeImage(structuredClone(image));
    } catch (error) {
      this.log.warn(
        `Unable to normalize image metadata for digest cache key generation: ${sanitizeLogParam(this.getDigestCacheImageLabel(image, digest))} (${sanitizeLogParam(getErrorMessage(error))})`,
      );
      normalizedImage = image;
    }

    const registryHost = this.getCanonicalRegistryHost(normalizedImage?.registry?.url);
    const imageName = normalizedImage?.name || '';
    const repository =
      registryHost === 'docker.io' && imageName.length > 0 && !imageName.includes('/')
        ? `library/${imageName}`
        : imageName;
    const tagOrDigest =
      (typeof digest === 'string' && digest.length > 0 ? digest : normalizedImage?.tag?.value) ||
      'latest';
    const architecture = normalizedImage?.architecture || 'unknown';
    const os = normalizedImage?.os || 'unknown';
    const variant = normalizedImage?.variant ? `/${normalizedImage.variant}` : '';

    return `${registryHost}/${repository}:${tagOrDigest}|${os}/${architecture}${variant}`;
  }

  private buildTagListCacheKey(image: ContainerImage): string {
    let normalizedImage: ContainerImage;
    try {
      normalizedImage = this.normalizeImage(structuredClone(image));
    } catch (error) {
      this.log.warn(
        `Unable to normalize image metadata for tag-list cache key generation: ${sanitizeLogParam(this.getDigestCacheImageLabel(image))} (${sanitizeLogParam(getErrorMessage(error))})`,
      );
      normalizedImage = image;
    }

    const registryHost = this.getCanonicalRegistryHost(normalizedImage?.registry?.url);
    const imageName = normalizedImage?.name || '';
    const repository =
      registryHost === 'docker.io' && imageName.length > 0 && !imageName.includes('/')
        ? `library/${imageName}`
        : imageName;
    return `${registryHost}/${repository}`;
  }

  private recordDigestCacheHit() {
    this.digestCacheHits += 1;
    const counter = registryPrometheus.getDigestCacheHitsCounter?.();
    if (counter) {
      counter.inc();
    }
  }

  private recordDigestCacheMiss() {
    this.digestCacheMisses += 1;
    const counter = registryPrometheus.getDigestCacheMissesCounter?.();
    if (counter) {
      counter.inc();
    }
  }

  public startDigestCachePollCycle() {
    this.digestCachePollCycleActive = true;
    this.digestManifestCache.clear();
    this.digestManifestCacheInFlight.clear();
    this.tagListCache.clear();
    this.tagListCacheInFlight.clear();
    this.digestCacheHits = 0;
    this.digestCacheMisses = 0;
  }

  override async getTags(
    image: ContainerImage,
    options?: RegistryLookupOptions,
  ): Promise<string[]> {
    if (!this.digestCachePollCycleActive || options?.usePollCycleCache === false) {
      return options ? super.getTags(image, options) : super.getTags(image);
    }

    const cacheKey = this.buildTagListCacheKey(image);
    const cachedTags = this.tagListCache.get(cacheKey);
    if (cachedTags) {
      return [...cachedTags];
    }

    const inFlightLookup = this.tagListCacheInFlight.get(cacheKey);
    if (inFlightLookup) {
      return [...(await inFlightLookup)];
    }

    const tagLookup = super.getTags(image).then((tags) => {
      const cachedCopy = [...tags];
      this.tagListCache.set(cacheKey, cachedCopy);
      return cachedCopy;
    });
    this.tagListCacheInFlight.set(cacheKey, tagLookup);
    try {
      return [...(await tagLookup)];
    } finally {
      this.tagListCacheInFlight.delete(cacheKey);
    }
  }

  public endDigestCachePollCycle() {
    const totalRequests = this.digestCacheHits + this.digestCacheMisses;
    const hitRate = totalRequests === 0 ? 0 : (this.digestCacheHits / totalRequests) * 100;
    if (this.log && typeof this.log.debug === 'function') {
      this.log.debug(
        `${this.getId()} digest cache hit rate ${hitRate.toFixed(2)}% (${this.digestCacheHits} hits, ${this.digestCacheMisses} misses)`,
      );
    }
    this.digestCachePollCycleActive = false;
    this.digestManifestCache.clear();
    this.digestManifestCacheInFlight.clear();
    this.tagListCache.clear();
    this.tagListCacheInFlight.clear();
    return {
      hits: this.digestCacheHits,
      misses: this.digestCacheMisses,
      hitRate,
    };
  }

  /**
   * Additional hosts the provider considers legitimate auth endpoints.
   * Override in subclasses that delegate auth to a different host
   * (e.g. lscr.io authenticates against ghcr.io).
   */
  protected getTrustedAuthHosts(): string[] {
    return [];
  }

  protected getBearerChallengeAuthOptions(
    _image: ContainerImage,
    _authUrl: string,
  ): BearerChallengeAuthOptions {
    return {
      credentials: this.getAuthCredentials(),
    };
  }

  private getRegistryAuthHost(value: string): string {
    const normalizedValue = value.trim();
    const withProtocol = /^https?:\/\//i.test(normalizedValue)
      ? normalizedValue
      : `https://${normalizedValue}`;
    try {
      return new URL(withProtocol).host.toLowerCase();
    } catch {
      /* v8 ignore next 4 -- malformed auth hosts are normalized defensively for direct config input. */
      return normalizedValue
        .replace(/^https?:\/\//i, '')
        .split('/')[0]
        .toLowerCase();
    }
  }

  private getTrustedRegistryHosts(requestOptions: RegistryRequestOptions): string[] {
    const hosts = new Set<string>();
    const requestHostSource = requestOptions?.url;
    if (typeof requestHostSource === 'string' && requestHostSource.trim().length > 0) {
      hosts.add(this.getRegistryAuthHost(requestHostSource));
    }

    const configuredHostSource = this.configuration?.url;
    if (typeof configuredHostSource === 'string' && configuredHostSource.trim().length > 0) {
      hosts.add(this.getRegistryAuthHost(configuredHostSource));
    }

    for (const host of this.getTrustedAuthHosts()) {
      if (typeof host === 'string' && host.trim().length > 0) {
        hosts.add(this.getRegistryAuthHost(host));
      }
    }

    return Array.from(hosts);
  }

  private validateAuthUrlHost(authUrl: string, requestOptions: RegistryRequestOptions): void {
    let requestScheme: string;
    try {
      requestScheme = new URL(requestOptions?.url ?? '').protocol;
    } catch {
      requestScheme = 'https:';
    }

    let authScheme: string;
    try {
      authScheme = new URL(authUrl).protocol;
    } catch {
      authScheme = '';
    }

    if (requestScheme === 'https:' && authScheme !== 'https:') {
      failClosedAuth(
        `Unable to authenticate registry ${this.getId()}: token endpoint ${authUrl} uses plaintext HTTP while the registry is served over HTTPS; refusing to send credentials over an unencrypted connection`,
      );
      return;
    }

    const authHost = this.getRegistryAuthHost(authUrl);
    const trustedHosts = this.getTrustedRegistryHosts(requestOptions);

    if (trustedHosts.length === 0) {
      failClosedAuth(
        `Unable to authenticate registry ${this.getId()}: token endpoint host ${authHost} cannot be validated because registry host is unavailable`,
      );
      return;
    }

    if (!trustedHosts.includes(authHost)) {
      failClosedAuth(
        `Unable to authenticate registry ${this.getId()}: token endpoint host ${authHost} is not trusted`,
      );
    }
  }

  private getHttpsAgent() {
    const shouldDisableTlsVerification = this.configuration?.insecure === true;
    const hasCaFile = Boolean(this.configuration?.cafile);
    const hasMutualTls = Boolean(this.configuration?.clientcert);
    if (!shouldDisableTlsVerification && !hasCaFile && !hasMutualTls) {
      return undefined;
    }

    if (this.httpsAgent) {
      return this.httpsAgent;
    }

    let ca;
    if (hasCaFile) {
      const caPath = resolveConfiguredPath(this.configuration.cafile, {
        label: `registry ${this.getId()} CA file path`,
      });
      ca = fs.readFileSync(caPath);
    }

    let cert;
    let key;
    if (hasMutualTls) {
      const certPath = resolveConfiguredPath(this.configuration.clientcert, {
        label: `registry ${this.getId()} client certificate file path`,
      });
      cert = fs.readFileSync(certPath);
      const keyPath = resolveConfiguredPath(this.configuration.clientkey, {
        label: `registry ${this.getId()} client key file path`,
      });
      key = fs.readFileSync(keyPath);
    }

    // Intentional opt-in for self-hosted registries with private/self-signed cert chains.
    // lgtm[js/disabling-certificate-validation]
    this.httpsAgent = new https.Agent({
      ca,
      cert,
      key,
      rejectUnauthorized: !shouldDisableTlsVerification,
    });
    return this.httpsAgent;
  }

  protected withTlsRequestOptions(requestOptions: RegistryRequestOptions): RegistryRequestOptions {
    const httpsAgent = requestOptions.httpsAgent || this.getHttpsAgent();
    if (!httpsAgent) {
      return requestOptions;
    }
    if (this.configuration?.insecure === true) {
      this.log.warn(
        `Registry ${this.getId()} request is using insecure TLS verification because insecure=true; certificate validation is disabled.`,
      );
    }
    return {
      ...requestOptions,
      httpsAgent,
    };
  }

  /**
   * Common URL normalization for registries that need https:// prefix and /v2 suffix
   */
  normalizeImageUrl(image: ContainerImage, registryUrl: string | null = null): ContainerImage {
    const imageNormalized = {
      ...image,
      registry: { ...image.registry },
    };
    const url = registryUrl || image.registry.url;

    if (!url.startsWith('https://')) {
      imageNormalized.registry.url = `https://${url}/v2`;
    }
    return imageNormalized;
  }

  /**
   * Common Basic Auth implementation
   */
  async authenticateBasic(
    requestOptions: RegistryRequestOptions,
    credentials?: string,
  ): Promise<RegistryRequestOptions> {
    const requestOptionsWithAuth = this.withTlsRequestOptions({ ...requestOptions });
    if (credentials) {
      const headers = (requestOptionsWithAuth.headers || {}) as Record<string, unknown>;
      headers.Authorization = `Basic ${credentials}`;
      requestOptionsWithAuth.headers = headers as AxiosRequestConfig['headers'];
    }
    return requestOptionsWithAuth;
  }

  /**
   * Common Bearer token authentication
   */
  async authenticateBearer(
    requestOptions: RegistryRequestOptions,
    token?: string,
  ): Promise<RegistryRequestOptions> {
    const requestOptionsWithAuth = this.withTlsRequestOptions({ ...requestOptions });
    if (token) {
      const headers = (requestOptionsWithAuth.headers || {}) as Record<string, unknown>;
      headers.Authorization = `Bearer ${token}`;
      requestOptionsWithAuth.headers = headers as AxiosRequestConfig['headers'];
    }
    return requestOptionsWithAuth;
  }

  async getImageManifestDigest(
    image: ContainerImage,
    digest?: string,
    options?: RegistryLookupOptions,
  ): Promise<RegistryManifestLookupResult> {
    if (!this.digestCachePollCycleActive || options?.usePollCycleCache === false) {
      return options
        ? super.getImageManifestDigest(image, digest, options)
        : super.getImageManifestDigest(image, digest);
    }

    const cacheKey = this.buildDigestCacheKey(image, digest);
    const cachedEntry = this.digestManifestCache.get(cacheKey);
    if (cachedEntry) {
      this.recordDigestCacheHit();
      return {
        digest: cachedEntry.digest,
        created: cachedEntry.created,
        version: cachedEntry.version,
      };
    }

    const inFlightLookup = this.digestManifestCacheInFlight.get(cacheKey);
    if (inFlightLookup) {
      this.recordDigestCacheHit();
      return inFlightLookup;
    }

    this.recordDigestCacheMiss();
    const manifestLookup = (async () => {
      const manifest = await super.getImageManifestDigest(image, digest);
      if (typeof manifest?.digest === 'string' && manifest.digest.length > 0) {
        this.digestManifestCache.set(cacheKey, {
          digest: manifest.digest,
          created: manifest.created,
          version: manifest.version,
          fetchedAt: Date.now(),
        });
      }
      return manifest;
    })();

    this.digestManifestCacheInFlight.set(cacheKey, manifestLookup);
    try {
      return await manifestLookup;
    } finally {
      this.digestManifestCacheInFlight.delete(cacheKey);
    }
  }

  /**
   * Common Bearer token authentication via auth URL.
   * Fetches a token from an auth endpoint using optional Basic credentials,
   * then sets the Bearer token on the request options.
   * @param requestOptions - the request options to augment with auth
   * @param authUrl - the URL to fetch the bearer token from
   * @param credentials - optional Base64 credentials for Basic auth on the token request
   * @param tokenExtractor - function to extract the token from the axios response (default: response.data.token || response.data.access_token)
   * @returns the request options with Authorization header set
   */
  async authenticateBearerFromAuthUrl(
    requestOptions: RegistryRequestOptions,
    authUrl: string,
    credentials?: string,
    tokenExtractor: (response: { data?: Record<string, unknown> }) => unknown = (response) =>
      response.data?.token || response.data?.access_token,
    tokenFailureMessage = `Unable to authenticate registry ${this.getId()}: token endpoint response does not contain token`,
  ) {
    this.validateAuthUrlHost(authUrl, requestOptions);

    const requestOptionsWithAuth = this.withTlsRequestOptions({
      ...requestOptions,
    });
    const cacheKey = this.getBearerTokenCacheKey(authUrl, credentials);
    const now = Date.now();
    this.pruneExpiredBearerTokenCache(now);
    const cachedToken = this.bearerTokenCache.get(cacheKey);
    if (cachedToken && now < cachedToken.expiresAt) {
      return withAuthorizationHeader(
        requestOptionsWithAuth,
        'Bearer',
        cachedToken.token,
        tokenFailureMessage,
      );
    }
    this.bearerTokenCache.delete(cacheKey);

    const request = this.withTlsRequestOptions({
      method: 'GET',
      url: authUrl,
      maxRedirects: 0,
      headers: {
        Accept: 'application/json',
      },
    });

    if (credentials) {
      const headers = (request.headers || {}) as Record<string, unknown>;
      headers.Authorization = `Basic ${credentials}`;
      request.headers = headers as AxiosRequestConfig['headers'];
    }

    let response: { data?: Record<string, unknown> } | undefined;
    try {
      await acquireToken(getBucketForUrl(authUrl));
      const envelope = await withRetry<Record<string, unknown>>(
        async () => {
          const r = await axios<Record<string, unknown>>(request);
          return {
            status: r.status,
            headers: r.headers as Record<string, string | undefined>,
            data: r.data,
          };
        },
        { logger: this.log, requestLabel: `${this.getId()} auth ${authUrl}` },
      );
      response = { data: envelope.data };
    } catch (e: unknown) {
      failClosedAuth(
        `Unable to authenticate registry ${this.getId()}: token request failed (${getErrorMessage(e)})`,
      );
    }

    const token = requireAuthString(tokenExtractor(response), tokenFailureMessage);
    this.bearerTokenCache.set(cacheKey, {
      token,
      expiresAt: Date.now() + REGISTRY_BEARER_TOKEN_CACHE_TTL_MS,
    });

    return withAuthorizationHeader(requestOptionsWithAuth, 'Bearer', token, tokenFailureMessage);
  }

  private getRejectedCredentialStatus(
    error: unknown,
    rejectedCredentialStatuses: readonly number[] = [401, 403],
  ): string | undefined {
    if (!(error instanceof Error) || rejectedCredentialStatuses.length === 0) {
      return undefined;
    }

    const defaultStatuses = [401, 403];
    const isDefault =
      rejectedCredentialStatuses.length === defaultStatuses.length &&
      rejectedCredentialStatuses.every((s, i) => s === defaultStatuses[i]);

    const pattern = isDefault
      ? REJECTED_CREDENTIAL_DEFAULT_PATTERN
      : RE2JS.compile(
          `token request failed \\(Request failed with status code (${rejectedCredentialStatuses.join('|')})\\)`,
        );

    const match = pattern.matcher(error.message);
    return match.find() ? match.group(1) : undefined;
  }

  /**
   * Bearer-token auth via the registry's token endpoint.
   *
   * - When `credentials` is undefined (the instance is registered as
   *   anonymous), this is a single unauthenticated token request.
   * - When `credentials` is supplied (the instance is registered as
   *   credentialed) and the token endpoint rejects them with one of
   *   `rejectedCredentialStatuses`, this throws an actionable error instead
   *   of silently falling back to anonymous. Silent anonymous fallback for
   *   credentialed instances was the root cause of authenticated users still
   *   hitting per-IP anonymous rate limits (issue #342).
   *
   * The historical `WithPublicFallback` suffix in the name is retained for
   * caller stability; the semantic it referred to (silent retry without
   * credentials on rejection) is intentionally removed.
   */
  protected async authenticateBearerFromAuthUrlWithPublicFallback(
    requestOptions: RegistryRequestOptions,
    authUrl: string,
    credentials?: string,
    options: {
      tokenExtractor?: (response: { data?: Record<string, unknown> }) => unknown;
      tokenFailureMessage?: string;
      providerLabel?: string;
      rejectedCredentialStatuses?: readonly number[];
    } = {},
  ) {
    try {
      return await this.authenticateBearerFromAuthUrl(
        requestOptions,
        authUrl,
        credentials,
        options.tokenExtractor,
        options.tokenFailureMessage,
      );
    } catch (error) {
      const rejectedStatus = credentials
        ? this.getRejectedCredentialStatus(error, options.rejectedCredentialStatuses)
        : undefined;
      if (!credentials || !rejectedStatus) {
        throw error;
      }

      // Credentials were supplied but rejected — throw a clear, actionable
      // error instead of silently falling back to anonymous. The anonymous
      // tier would cause 429s that are harder to diagnose than a clean failure.
      const providerLabel = options.providerLabel || this.getId();
      throw new RegistryCredentialRejectedError(
        `Authentication failed for registry ${this.getId()} (HTTP ${rejectedStatus}): ${providerLabel} credentials were rejected. Check the configured token/login/password and their scopes.`,
      );
    }
  }

  /**
   * On a 401 response carrying a `WWW-Authenticate: Bearer` challenge,
   * parse the challenge, validate the realm host against the trusted registry
   * hosts, fetch a token (anonymously or with configured credentials), and
   * return augmented request options for the retry.
   *
   * Returns `undefined` if the challenge is not parseable, the realm host is
   * untrusted, or an anonymous token fetch fails — so callRegistry rethrows the
   * original 401 unchanged. Credential rejection from a trusted token endpoint
   * is rethrown with the actionable credential error.
   */
  protected override async resolveBearerChallengeOptions(
    requestOptions: RegistryRequestOptions,
    wwwAuthenticate: string | undefined,
    image: ContainerImage,
  ): Promise<RegistryRequestOptions | undefined> {
    try {
      const challenge = parseBearerChallenge(
        typeof wwwAuthenticate === 'string' ? wwwAuthenticate : undefined,
      );
      if (!challenge) {
        return undefined;
      }

      // Build the auth URL from realm + optional service/scope query params.
      let authUrl: string;
      try {
        const u = new URL(challenge.realm);
        if (challenge.service) {
          u.searchParams.set('service', challenge.service);
        }
        if (challenge.scope) {
          u.searchParams.set('scope', challenge.scope);
        }
        authUrl = u.toString();
      } catch {
        this.log.debug(
          `Bearer challenge for ${this.getId()}: realm URL is malformed ("${sanitizeLogParam(challenge.realm)}"), falling back to original error`,
        );
        return undefined;
      }

      const authOptions = this.getBearerChallengeAuthOptions(image, authUrl);
      return await this.authenticateBearerFromAuthUrlWithPublicFallback(
        requestOptions,
        authUrl,
        authOptions.credentials,
        {
          tokenExtractor: authOptions.tokenExtractor,
          tokenFailureMessage: authOptions.tokenFailureMessage,
        },
      );
    } catch (err: unknown) {
      if (err instanceof RegistryCredentialRejectedError) {
        throw err;
      }
      this.log.debug(
        `Bearer challenge token exchange for ${this.getId()} failed (${getErrorMessage(err)}), falling back to original error`,
      );
      return undefined;
    }
  }

  /**
   * Common credentials helper for login/password or auth field
   */
  getAuthCredentials() {
    if (this.configuration.auth) {
      return this.configuration.auth;
    }
    if (this.configuration.login && this.configuration.password) {
      return BaseRegistry.base64Encode(this.configuration.login, this.configuration.password);
    }
    return undefined;
  }

  /**
   * Common auth pull credentials
   */
  async getAuthPull() {
    if (this.configuration.login && this.configuration.password) {
      return {
        username: this.configuration.login,
        password: this.configuration.password,
      };
    }
    if (this.configuration.username && this.configuration.token) {
      return {
        username: this.configuration.username,
        password: this.configuration.token,
      };
    }
    return undefined;
  }

  /**
   * Common URL pattern matching
   */
  matchUrlPattern(image: Pick<ContainerImage, 'registry'>, pattern: RegExp): boolean {
    return pattern.test(image.registry.url);
  }

  /**
   * Resolve the remote image publish date from manifest metadata.
   * Provider-specific implementations can override this when richer APIs exist.
   */
  async getImagePublishedAt(
    image,
    tag?: string,
    options?: RegistryLookupOptions,
  ): Promise<string | undefined> {
    const imageToInspect = structuredClone(image);
    const tagToLookup = typeof tag === 'string' && tag.length > 0 ? tag : imageToInspect.tag?.value;
    if (typeof tagToLookup === 'string' && tagToLookup.length > 0) {
      imageToInspect.tag = {
        ...(imageToInspect.tag || {}),
        value: tagToLookup,
      };
    }

    const manifest = options
      ? await this.getImageManifestDigest(imageToInspect, undefined, options)
      : await this.getImageManifestDigest(imageToInspect);
    if (typeof manifest?.created !== 'string') {
      return undefined;
    }

    return Number.isNaN(Date.parse(manifest.created)) ? undefined : manifest.created;
  }

  /**
   * Normalize a registry URL-like value into a lowercase hostname.
   */
  getRegistryHostname(value: string): string {
    const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    try {
      return new URL(withProtocol).hostname.toLowerCase();
    } catch {
      return value
        .replace(/^https?:\/\//i, '')
        .split('/')[0]
        .toLowerCase();
    }
  }

  /**
   * Common mask configuration for sensitive fields
   */
  maskSensitiveFields(fields: string[]): Partial<TConfiguration> {
    const masked = { ...this.configuration } as Record<string, unknown>;
    fields.forEach((field) => {
      if (masked[field]) {
        masked[field] = BaseRegistry.mask(String(masked[field]));
      }
    });
    return masked as Partial<TConfiguration>;
  }
}

export default BaseRegistry;
