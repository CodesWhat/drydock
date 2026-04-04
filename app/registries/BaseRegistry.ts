import fs from 'node:fs';
import https from 'node:https';
import axios, { type AxiosRequestConfig } from 'axios';
import type { ContainerImage } from '../model/container.js';
import * as registryPrometheus from '../prometheus/registry.js';
import { resolveConfiguredPath } from '../runtime/paths.js';
import { failClosedAuth, requireAuthString, withAuthorizationHeader } from '../security/auth.js';
import { REGISTRY_BEARER_TOKEN_CACHE_TTL_MS } from './configuration.js';
import Registry from './Registry.js';

type RegistryRequestOptions = AxiosRequestConfig;
type RegistryManifestLookupResult = Awaited<ReturnType<Registry['getImageManifestDigest']>>;
type DigestCacheEntry = {
  digest: string;
  created?: string;
  version?: number;
  fetchedAt: number;
};

/**
 * Base Registry with common patterns
 */
class BaseRegistry extends Registry {
  private httpsAgent?: https.Agent;
  private bearerTokenCache = new Map<string, { token: string; expiresAt: number }>();
  private digestManifestCache = new Map<string, DigestCacheEntry>();
  private digestManifestCacheInFlight = new Map<string, Promise<RegistryManifestLookupResult>>();
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

  private buildDigestCacheKey(image: ContainerImage, digest?: string): string {
    let normalizedImage: ContainerImage;
    try {
      normalizedImage = this.normalizeImage(structuredClone(image));
    } catch {
      normalizedImage = image;
    }

    const registryHost = this.getCanonicalRegistryHost(normalizedImage?.registry?.url);
    /* v8 ignore next -- missing/empty image names are defensive-only in production call paths */
    const imageName = normalizedImage?.name || '';
    const repository =
      registryHost === 'docker.io' && imageName.length > 0 && !imageName.includes('/')
        ? `library/${imageName}`
        : imageName;
    /* v8 ignore next -- digest/tag fallback matrix is covered by integration paths */
    const tagOrDigest =
      (typeof digest === 'string' && digest.length > 0 ? digest : normalizedImage?.tag?.value) ||
      'latest';
    /* v8 ignore next -- architecture fallback is defensive for malformed image payloads */
    const architecture = normalizedImage?.architecture || 'unknown';
    /* v8 ignore next -- os fallback is defensive for malformed image payloads */
    const os = normalizedImage?.os || 'unknown';
    /* v8 ignore next -- variant is optional and omitted for most image descriptors */
    const variant = normalizedImage?.variant ? `/${normalizedImage.variant}` : '';

    return `${registryHost}/${repository}:${tagOrDigest}|${os}/${architecture}${variant}`;
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
    this.digestManifestCache.clear();
    this.digestManifestCacheInFlight.clear();
    this.digestCacheHits = 0;
    this.digestCacheMisses = 0;
  }

  public endDigestCachePollCycle() {
    const totalRequests = this.digestCacheHits + this.digestCacheMisses;
    /* v8 ignore next -- zero-request cycles are trivial defensive accounting */
    const hitRate = totalRequests === 0 ? 0 : (this.digestCacheHits / totalRequests) * 100;
    /* v8 ignore next -- debug logger may be absent depending on registry initialization mode */
    if (this.log && typeof this.log.debug === 'function') {
      this.log.debug(
        `${this.getId()} digest cache hit rate ${hitRate.toFixed(2)}% (${this.digestCacheHits} hits, ${this.digestCacheMisses} misses)`,
      );
    }
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

  private getTrustedRegistryHosts(requestOptions: RegistryRequestOptions): string[] {
    const hosts = new Set<string>();
    const requestHostSource = requestOptions?.url;
    if (typeof requestHostSource === 'string' && requestHostSource.trim().length > 0) {
      hosts.add(this.getRegistryHostname(requestHostSource));
    }

    const configuredHostSource = this.configuration?.url;
    if (typeof configuredHostSource === 'string' && configuredHostSource.trim().length > 0) {
      hosts.add(this.getRegistryHostname(configuredHostSource));
    }

    for (const host of this.getTrustedAuthHosts()) {
      if (typeof host === 'string' && host.trim().length > 0) {
        hosts.add(this.getRegistryHostname(host));
      }
    }

    return Array.from(hosts);
  }

  private validateAuthUrlHost(authUrl: string, requestOptions: RegistryRequestOptions): void {
    const authHost = this.getRegistryHostname(authUrl);
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

  private withTlsRequestOptions(requestOptions: RegistryRequestOptions): RegistryRequestOptions {
    const httpsAgent = requestOptions.httpsAgent || this.getHttpsAgent();
    if (!httpsAgent) {
      return requestOptions;
    }
    return {
      ...requestOptions,
      httpsAgent,
    };
  }

  /**
   * Common URL normalization for registries that need https:// prefix and /v2 suffix
   */
  normalizeImageUrl(image, registryUrl = null) {
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
  ): Promise<RegistryManifestLookupResult> {
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
      /* v8 ignore next -- empty digest responses are treated as non-cacheable defensive fallback */
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
   * @param tokenExtractor - function to extract the token from the axios response (default: response.data.token)
   * @returns the request options with Authorization header set
   */
  async authenticateBearerFromAuthUrl(
    requestOptions: RegistryRequestOptions,
    authUrl: string,
    credentials?: string,
    tokenExtractor: (response: { data?: Record<string, unknown> }) => unknown = (response) =>
      response.data?.token,
  ) {
    this.validateAuthUrlHost(authUrl, requestOptions);

    const requestOptionsWithAuth = this.withTlsRequestOptions({
      ...requestOptions,
    });
    const tokenFailureMessage = `Unable to authenticate registry ${this.getId()}: token endpoint response does not contain token`;
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
      response = await axios(request);
    } catch (e) {
      failClosedAuth(
        `Unable to authenticate registry ${this.getId()}: token request failed (${e.message})`,
      );
    }

    const token = requireAuthString(tokenExtractor(response), tokenFailureMessage);
    this.bearerTokenCache.set(cacheKey, {
      token,
      expiresAt: Date.now() + REGISTRY_BEARER_TOKEN_CACHE_TTL_MS,
    });

    return withAuthorizationHeader(requestOptionsWithAuth, 'Bearer', token, tokenFailureMessage);
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
  matchUrlPattern(image, pattern) {
    return pattern.test(image.registry.url);
  }

  /**
   * Resolve the remote image publish date from manifest metadata.
   * Provider-specific implementations can override this when richer APIs exist.
   */
  async getImagePublishedAt(image, tag?: string): Promise<string | undefined> {
    const imageToInspect = structuredClone(image);
    const tagToLookup = typeof tag === 'string' && tag.length > 0 ? tag : imageToInspect.tag?.value;
    if (typeof tagToLookup === 'string' && tagToLookup.length > 0) {
      imageToInspect.tag = {
        ...(imageToInspect.tag || {}),
        value: tagToLookup,
      };
    }

    const manifest = await this.getImageManifestDigest(imageToInspect);
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
  maskSensitiveFields(fields) {
    const masked = { ...this.configuration };
    fields.forEach((field) => {
      if (masked[field]) {
        masked[field] = BaseRegistry.mask(masked[field]);
      }
    });
    return masked;
  }
}

export default BaseRegistry;
