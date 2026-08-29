import http from 'node:http';
import https from 'node:https';
import axios, { type AxiosRequestConfig, type AxiosResponse, type Method } from 'axios';
import type { ContainerImage } from '../model/container.js';
import { getSummaryTags } from '../prometheus/registry.js';
import Component, { type ComponentConfiguration } from '../registry/Component.js';
import { getErrorMessage } from '../util/error.js';
import { getRegistryRequestTimeoutMs } from './configuration.js';
import { withRetry } from './http-retry.js';
import { buildImageReference } from './image-reference.js';
import { acquireToken, getBucketForUrl } from './token-bucket.js';

type RegistryRequestOptions = AxiosRequestConfig;

interface RegistryManifest {
  digest?: string;
  version?: number;
  created?: string;
}

export interface RegistryLookupOptions {
  usePollCycleCache?: boolean;
}

export interface RegistryTagsList {
  name: string;
  tags: string[];
}

interface ManifestEntry {
  digest: string;
  mediaType: string;
  platform?: {
    architecture: string;
    os: string;
    variant?: string;
  };
}

interface RegistryManifestResponse {
  schemaVersion: number;
  mediaType?: string;
  manifests?: ManifestEntry[];
  config?: {
    digest: string;
    mediaType: string;
  };
  history?: {
    v1Compatibility: string;
  }[];
}

interface RegistryManifestConfigResponse {
  created?: string;
}

/** Media types representing a manifest list / OCI index (multi-platform). */
function isManifestList(mediaType: string | undefined): boolean {
  return (
    mediaType === 'application/vnd.docker.distribution.manifest.list.v2+json' ||
    mediaType === 'application/vnd.oci.image.index.v1+json'
  );
}

/** Media types representing a single-platform manifest. */
function isSingleManifest(mediaType: string | undefined): boolean {
  return (
    mediaType === 'application/vnd.docker.distribution.manifest.v2+json' ||
    mediaType === 'application/vnd.oci.image.manifest.v1+json'
  );
}

/** Media types representing a legacy / config-only image. */
function isLegacyImageConfig(mediaType: string | undefined): boolean {
  return (
    mediaType === 'application/vnd.docker.container.image.v1+json' ||
    mediaType === 'application/vnd.oci.image.config.v1+json'
  );
}

/**
 * Depth bound for following nested manifest indexes. Buildx with attestations
 * produces exactly one level of nesting; this leaves headroom without letting a
 * malformed or hostile registry response walk indefinitely.
 */
const MAX_MANIFEST_INDEX_DEPTH = 3;

/**
 * Page bound for tag listing. At the 1000-per-page default this allows 50k
 * tags, far past any real repository, and stops a registry that returns a
 * `Link` header on every response from looping forever and growing the tag
 * array without limit.
 */
const MAX_TAG_PAGES = 50;

/**
 * Extract the `rel="next"` URL from an RFC 5988 `Link` header.
 *
 * Pagination cursors are opaque under the OCI distribution spec: a client is
 * meant to follow this URL as given rather than rebuild it. Registries differ
 * in what they put in it, and AWS ECR Public enforces the distinction — a
 * hand-built `last=<tag-name>` is rejected with 405 and
 * `Invalid parameter at 'NextToken'`, so every repository past the first page
 * was unreadable there.
 */
function parseNextPageLink(link: string | undefined): string | undefined {
  if (link === undefined) {
    return undefined;
  }
  for (const entry of link.split(',')) {
    const match = /<([^>]+)>\s*;\s*(.+)/u.exec(entry);
    if (match === null) {
      continue;
    }
    if (/\brel\s*=\s*"?next"?/iu.test(match[2])) {
      return match[1].trim();
    }
  }
  return undefined;
}

/**
 * Resolve a `Link` header's next-page URL against the registry base.
 *
 * The base carries the API prefix (`https://host/v2`) and registries usually
 * answer with an absolute path that repeats it, which resolves correctly. The
 * trailing slash keeps a bare relative path resolving under the prefix rather
 * than replacing it.
 *
 * Returns undefined when the cursor points at a different origin. The request
 * carries registry credentials, so following one off-origin would hand them to
 * whatever host the registry named.
 */
function resolveNextPageUrl(registryUrl: string, link: string | undefined): string | undefined {
  const next = parseNextPageLink(link);
  if (next === undefined) {
    return undefined;
  }
  try {
    const base = new URL(registryUrl);
    const resolved = new URL(next, `${registryUrl}/`);
    return resolved.origin === base.origin ? resolved.toString() : undefined;
  } catch {
    return undefined;
  }
}

function isRedirectError(error: unknown): boolean {
  const status =
    error != null && typeof error === 'object'
      ? (error as { response?: { status?: unknown } }).response?.status
      : undefined;
  return (
    typeof status === 'number' &&
    ((status >= 301 && status <= 303) || status === 307 || status === 308)
  );
}

/**
 * Filter a manifest list to find the best match for the requested platform.
 * Returns the matched manifest entry or undefined.
 */
function filterManifestByPlatform(
  manifests: ManifestEntry[],
  architecture: string,
  os: string,
  variant?: string,
): ManifestEntry | undefined {
  const matches = manifests.filter(
    (m) => m.platform?.architecture === architecture && m.platform?.os === os,
  );

  if (matches.length === 0) {
    return undefined;
  }

  // Start with first match (better than nothing)
  let best = matches[0];

  // Refine using variant when multiple matches exist
  if (matches.length > 1 && variant !== undefined) {
    const variantMatch = matches.find((m) => m.platform?.variant === variant);
    if (variantMatch) {
      best = variantMatch;
    }
  }

  return best;
}

/** Handle schemaVersion 1 manifests (legacy). */
function handleSchemaV1(response: RegistryManifestResponse): RegistryManifest {
  let v1Compat: { config?: { Image?: string }; created?: string };
  try {
    v1Compat = JSON.parse(response.history?.[0]?.v1Compatibility);
  } catch {
    throw new Error('Failed to parse schemaVersion 1 manifest v1Compatibility');
  }
  return {
    digest: v1Compat.config ? v1Compat.config.Image : undefined,
    created: v1Compat.created,
    version: 1,
  };
}

// Shared keep-alive agents for default registry traffic.
const DEFAULT_HTTP_KEEP_ALIVE_AGENT = new http.Agent({ keepAlive: true });
const DEFAULT_HTTPS_KEEP_ALIVE_AGENT = new https.Agent({ keepAlive: true });

/**
 * Docker Registry Abstract class.
 */
class Registry<
  TConfiguration extends ComponentConfiguration = ComponentConfiguration,
> extends Component<TConfiguration> {
  /**
   * Encode Bse64(login:password)
   * @param login
   * @param token
   * @returns {string}
   */
  static base64Encode(login: string, token: string) {
    return Buffer.from(`${login}:${token}`, 'utf-8').toString('base64');
  }

  /**
   * If this registry is responsible for the image (to be overridden).
   * @param image the image
   * @returns {boolean}
   */
  match(_image: ContainerImage): boolean {
    return false;
  }

  /**
   * Normalize image according to Registry Custom characteristics (to be overridden).
   * @param image
   * @returns {*}
   */
  normalizeImage(image: ContainerImage): ContainerImage {
    return image;
  }

  /**
   * Authenticate and set authentication value to requestOptions.
   * @param image
   * @param requestOptions
   * @returns {*}
   */
  async authenticate(
    _image: ContainerImage,
    requestOptions: AxiosRequestConfig,
  ): Promise<AxiosRequestConfig> {
    return requestOptions;
  }

  /**
   * Hook called by callRegistry when a 401 response carries a
   * `WWW-Authenticate: Bearer` challenge.  The default implementation is a
   * no-op that returns `undefined`, meaning no retry is attempted and the
   * original 401 is rethrown.
   *
   * BaseRegistry overrides this to perform the spec-compliant token exchange.
   *
   * @param _requestOptions  The axios options used for the original request.
   * @param _wwwAuthenticate The raw `WWW-Authenticate` header value.
   * @param _image           The container image being looked up.
   * @returns Augmented request options to use for the retry, or `undefined`
   *   to skip the retry and rethrow the original error.
   */
  protected async resolveBearerChallengeOptions(
    _requestOptions: RegistryRequestOptions,
    _wwwAuthenticate: string | undefined,
    _image: ContainerImage,
  ): Promise<RegistryRequestOptions | undefined> {
    return undefined;
  }

  /**
   * Get Tags.
   * @param image
   * @returns {*}
   */
  async getTags(image: ContainerImage, _options?: RegistryLookupOptions): Promise<string[]> {
    this.log.debug(`Get ${image.name} tags`);
    const tags: string[] = [];
    let page: AxiosResponse<RegistryTagsList> | undefined = undefined;
    let hasNext = true;
    let link: string | undefined = undefined;
    let pageCount = 0;
    while (hasNext) {
      const lastItem = page?.data?.tags?.slice(-1)?.[0];

      page = await this.getTagsPage(image, lastItem, link);
      const pageTags = page?.data?.tags ?? [];
      link = page?.headers?.link;
      hasNext = page?.headers?.link !== undefined;
      tags.push(...pageTags);
      pageCount += 1;
      if (hasNext && pageCount >= MAX_TAG_PAGES) {
        this.log.warn(
          `Stopped listing ${image.name} tags after ${MAX_TAG_PAGES} pages; the registry is still reporting more`,
        );
        hasNext = false;
      }
    }

    // Sort tags alphabetically, highest first
    tags.sort((left, right) => right.localeCompare(left));
    return tags;
  }

  /**
   * Get tags page
   * @param image
   * @param lastItem
   * @returns {Promise<*>}
   */
  getTagsPage(
    image: ContainerImage,
    lastItem: string | undefined = undefined,
    link: string | undefined = undefined,
  ) {
    // Follow the registry's own cursor when it gave us one. Rebuilding it from
    // the previous page's last tag only works on registries that happen to
    // accept a literal tag name as `last`, and silently truncates the tag list
    // on the ones that don't.
    const nextPageUrl = resolveNextPageUrl(image.registry.url, link);
    if (nextPageUrl !== undefined) {
      return this.callRegistry<RegistryTagsList>({
        image,
        url: nextPageUrl,
        resolveWithFullResponse: true,
      });
    }

    // Default items per page (not honoured by all registries)
    const itemsPerPage = 1000;
    const last = lastItem ? `&last=${encodeURIComponent(lastItem)}` : '';
    return this.callRegistry<RegistryTagsList>({
      image,
      url: `${image.registry.url}/${image.name}/tags/list?n=${itemsPerPage}${last}`,
      resolveWithFullResponse: true,
    });
  }

  /**
   * Get image manifest for a remote tag.
   * @param image
   * @param digest (optional)
   * @returns {Promise<undefined|*>}
   */
  async getImageManifestDigest(
    image: ContainerImage,
    digest?: string,
    _options?: RegistryLookupOptions,
  ): Promise<RegistryManifest> {
    const tagOrDigest = digest || image.tag.value;
    this.log.debug(`${this.getId()} - Get ${image.name}:${tagOrDigest} manifest`);
    const responseManifests = await this.callRegistry<RegistryManifestResponse>({
      image,
      url: `${image.registry.url}/${image.name}/manifests/${tagOrDigest}`,
      headers: {
        Accept:
          'application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json',
      },
    });
    if (responseManifests) {
      this.log.debug(`${image.name} - Found manifests [${JSON.stringify(responseManifests)}]`);
      if (responseManifests.schemaVersion === 1) {
        this.log.debug(`${image.name} - Manifests found with schemaVersion = 1`);
        const result = handleSchemaV1(responseManifests);
        this.log.debug(
          `${image.name} - Manifest found with [digest=${result.digest}, created=${result.created}, version=${result.version}]`,
        );
        return result;
      }
      if (responseManifests.schemaVersion === 2) {
        return this.handleSchemaV2(image, responseManifests, tagOrDigest);
      }
    }
    // Empty result...
    throw new Error('Unexpected error; no manifest found');
  }

  /**
   * Resolve published date for an image tag.
   * Registries with richer metadata endpoints can override this.
   */
  async getImagePublishedAt(
    image: ContainerImage,
    tag?: string,
    options?: RegistryLookupOptions,
  ): Promise<string | undefined> {
    const imageToInspect = structuredClone(image);
    const tagToLookup = typeof tag === 'string' && tag.length > 0 ? tag : imageToInspect.tag?.value;
    if (tagToLookup && imageToInspect.tag) {
      imageToInspect.tag.value = tagToLookup;
    } else if (tagToLookup) {
      imageToInspect.tag = { value: tagToLookup, semver: false };
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
   * Handle schemaVersion 2 manifests (multi-platform list or single manifest).
   * @param depth How many nested manifest indexes have already been followed
   *   to reach `response`. Buildx with SBOM/provenance attestations emits a
   *   per-platform entry that is itself an index (real image manifest plus an
   *   attestation manifest), so a matched entry can require following one more
   *   level before a concrete manifest or legacy image config is reached.
   *   Bounded by `MAX_MANIFEST_INDEX_DEPTH` so a malformed or hostile registry
   *   response cannot recurse indefinitely.
   */
  private async handleSchemaV2(
    image: ContainerImage,
    response: RegistryManifestResponse,
    tagOrDigest: string,
    depth = 0,
  ): Promise<RegistryManifest> {
    this.log.debug(`${image.name} - Manifests found with schemaVersion = 2`);
    this.log.debug(`${image.name} - Manifests media type detected [${response.mediaType}]`);

    let manifestDigest: string | undefined;
    let manifestMediaType: string | undefined;

    if (isManifestList(response.mediaType)) {
      this.log.debug(
        `${image.name} - Filter manifest for [arch=${image.architecture}, os=${image.os}, variant=${image.variant}]`,
      );
      const manifests = response.manifests ?? [];
      const matched = filterManifestByPlatform(
        manifests,
        image.architecture,
        image.os,
        image.variant,
      );
      if (matched) {
        if (isManifestList(matched.mediaType)) {
          if (depth >= MAX_MANIFEST_INDEX_DEPTH) {
            throw new Error(
              `Unexpected error; manifest index nested past ${MAX_MANIFEST_INDEX_DEPTH} levels`,
            );
          }
          this.log.debug(
            `${image.name} - Matched entry [digest=${matched.digest}] is itself a manifest index, following [depth=${depth + 1}]`,
          );
          const nested = await this.callRegistry<RegistryManifestResponse>({
            image,
            url: `${image.registry.url}/${image.name}/manifests/${matched.digest}`,
            headers: {
              Accept:
                'application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json',
            },
          });
          return this.handleSchemaV2(image, nested, matched.digest, depth + 1);
        }
        this.log.debug(
          `${image.name} - Manifest found with [digest=${matched.digest}, mediaType=${matched.mediaType}]`,
        );
        manifestDigest = matched.digest;
        manifestMediaType = matched.mediaType;
      }
    } else if (isSingleManifest(response.mediaType)) {
      const manifestReference = tagOrDigest;
      this.log.debug(
        `${image.name} - Manifest found with [reference=${manifestReference}, mediaType=${response.mediaType}]`,
      );
      manifestDigest = manifestReference;
      manifestMediaType = response.mediaType;
    }

    if (manifestDigest && isSingleManifest(manifestMediaType)) {
      return this.fetchManifestDigestFromHead(image, manifestDigest, manifestMediaType);
    }
    if (manifestDigest && isLegacyImageConfig(manifestMediaType)) {
      const created = await this.fetchImageCreatedFromBlob(image, manifestDigest);
      const result = {
        digest: manifestDigest,
        version: 1,
        ...(created ? { created } : {}),
      };
      this.log.debug(
        `${image.name} - Manifest found with [digest=${result.digest}, version=${result.version}]`,
      );
      return result;
    }
    throw new Error('Unexpected error; no manifest found');
  }

  /**
   * Fetch the docker-content-digest via a HEAD request.
   */
  private async fetchManifestDigestFromHead(
    image: ContainerImage,
    manifestDigest: string,
    mediaType: string,
  ): Promise<RegistryManifest> {
    this.log.debug(`${image.name} - Calling registry to get docker-content-digest header`);
    const responseManifest = await this.callRegistry<RegistryManifestResponse>({
      image,
      method: 'head',
      url: `${image.registry.url}/${image.name}/manifests/${manifestDigest}`,
      headers: {
        Accept: mediaType,
      },
      resolveWithFullResponse: true,
    });
    const resolvedManifestDigest =
      responseManifest.headers['docker-content-digest'] || manifestDigest;
    const created = await this.fetchImageCreatedFromManifestConfig(
      image,
      resolvedManifestDigest,
      mediaType,
    );
    const result = {
      digest: resolvedManifestDigest,
      version: 2,
      ...(created ? { created } : {}),
    };
    this.log.debug(
      `${image.name} - Manifest found with [digest=${result.digest}, version=${result.version}]`,
    );
    return result;
  }

  private async fetchImageCreatedFromManifestConfig(
    image: ContainerImage,
    manifestDigest: string,
    mediaType: string,
  ): Promise<string | undefined> {
    let manifestResponse: RegistryManifestResponse;
    try {
      manifestResponse = await this.callRegistry<RegistryManifestResponse>({
        image,
        method: 'get',
        url: `${image.registry.url}/${image.name}/manifests/${manifestDigest}`,
        headers: {
          Accept: mediaType,
        },
      });
    } catch (error: unknown) {
      this.log.debug(
        `Unable to fetch manifest config created date for ${this.getImageFullName(
          image,
          manifestDigest,
        )} (${getErrorMessage(error)})`,
      );
      if (isRedirectError(error)) {
        return undefined;
      }
      throw error;
    }
    const configDigest = manifestResponse?.config?.digest;
    if (!configDigest) {
      return undefined;
    }
    return this.fetchImageCreatedFromBlob(image, configDigest);
  }

  private async fetchImageCreatedFromBlob(
    image: ContainerImage,
    digest: string,
  ): Promise<string | undefined> {
    try {
      const configResponse = await this.callRegistry<RegistryManifestConfigResponse>({
        image,
        method: 'get',
        url: `${image.registry.url}/${image.name}/blobs/${digest}`,
        headers: {
          Accept:
            'application/vnd.oci.image.config.v1+json, application/vnd.docker.container.image.v1+json, application/json',
        },
      });
      if (typeof configResponse?.created !== 'string') {
        return undefined;
      }
      return Number.isNaN(Date.parse(configResponse.created)) ? undefined : configResponse.created;
    } catch (error: unknown) {
      this.log.debug(
        `Unable to fetch image config blob created date for ${this.getImageFullName(
          image,
          digest,
        )} (${getErrorMessage(error)})`,
      );
      if (isRedirectError(error)) {
        return undefined;
      }
      throw error;
    }
  }

  async callRegistry<T = unknown>(options: {
    image: ContainerImage;
    url: string;
    method?: Method;
    headers?: AxiosRequestConfig['headers'];
    resolveWithFullResponse: true;
  }): Promise<AxiosResponse<T>>;

  async callRegistry<T = unknown>(options: {
    image: ContainerImage;
    url: string;
    method?: Method;
    headers?: AxiosRequestConfig['headers'];
    resolveWithFullResponse?: false;
  }): Promise<T>;

  async callRegistry<T = unknown>({
    image,
    url,
    method = 'get',
    headers = {
      Accept: 'application/json',
    },
    resolveWithFullResponse = false,
  }: {
    image: ContainerImage;
    url: string;
    method?: Method;
    headers?: AxiosRequestConfig['headers'];
    resolveWithFullResponse?: boolean;
  }): Promise<T | AxiosResponse<T>> {
    const start = Date.now();

    // Request options
    const axiosOptions: AxiosRequestConfig = {
      url,
      method,
      headers,
      responseType: 'json',
      timeout: getRegistryRequestTimeoutMs(),
      maxRedirects: 0,
    };

    const axiosOptionsWithAuth = await this.authenticate(image, axiosOptions);
    const axiosOptionsWithConnectionReuse: AxiosRequestConfig = {
      ...axiosOptionsWithAuth,
      httpAgent: axiosOptionsWithAuth.httpAgent ?? DEFAULT_HTTP_KEEP_ALIVE_AGENT,
      httpsAgent: axiosOptionsWithAuth.httpsAgent ?? DEFAULT_HTTPS_KEEP_ALIVE_AGENT,
    };

    /** Execute a single registry request and return the envelope. */
    const executeRequest = async (requestOptions: RegistryRequestOptions) => {
      await acquireToken(getBucketForUrl(url));
      const redirectSafeRequestOptions = {
        ...requestOptions,
        maxRedirects: 0,
      };
      return withRetry<T>(
        () =>
          axios<T>(redirectSafeRequestOptions).then((r) => ({
            status: r.status,
            headers: r.headers as Record<string, string | undefined>,
            data: r.data,
          })),
        {
          logger: this.log,
          requestLabel: this.buildRequestLabel(url, method),
        },
      );
    };

    try {
      const envelope = await executeRequest(axiosOptionsWithConnectionReuse);

      const end = Date.now();
      getSummaryTags()?.observe({ type: this.type, name: this.name }, (end - start) / 1000);
      return resolveWithFullResponse
        ? ({
            status: envelope.status,
            headers: envelope.headers,
            data: envelope.data,
          } as unknown as AxiosResponse<T>)
        : envelope.data;
    } catch (error) {
      // On a 401 with a Bearer challenge, attempt a token exchange and retry once.
      // The retry is structurally bounded: it runs inside this catch with no
      // enclosing loop, so a retry that also fails propagates without looping.
      if (
        error != null &&
        typeof error === 'object' &&
        (error as { response?: { status?: number } }).response?.status === 401
      ) {
        const wwwAuth: string | undefined = (
          error as { response?: { headers?: Record<string, string | undefined> } }
        ).response?.headers?.['www-authenticate'];

        const retryOptions = await this.resolveBearerChallengeOptions(
          axiosOptionsWithConnectionReuse,
          wwwAuth,
          image,
        );

        if (retryOptions !== undefined) {
          try {
            const retryEnvelope = await executeRequest(retryOptions);
            const end = Date.now();
            getSummaryTags()?.observe({ type: this.type, name: this.name }, (end - start) / 1000);
            return resolveWithFullResponse
              ? ({
                  status: retryEnvelope.status,
                  headers: retryEnvelope.headers,
                  data: retryEnvelope.data,
                } as unknown as AxiosResponse<T>)
              : retryEnvelope.data;
          } catch (retryError) {
            const end = Date.now();
            getSummaryTags()?.observe({ type: this.type, name: this.name }, (end - start) / 1000);
            throw retryError;
          }
        }
      }

      const end = Date.now();
      getSummaryTags()?.observe({ type: this.type, name: this.name }, (end - start) / 1000);
      throw error;
    }
  }

  getImageFullName(image: ContainerImage, tagOrDigest: string) {
    return buildImageReference(image.registry.url, image.name, tagOrDigest);
  }

  /**
   * Return {username, pass } or undefined.
   * @returns {}
   */

  async getAuthPull(): Promise<{ username?: string; password?: string } | undefined> {
    return undefined;
  }

  /**
   * Build a human-readable label for retry log messages.
   * Strips query parameters so secrets in query strings are not logged.
   */
  private buildRequestLabel(url: string, method: string): string {
    try {
      const parsed = new URL(url);
      return `${this.getId()} ${method} ${parsed.origin}${parsed.pathname}`;
    } catch {
      return `${this.getId()} ${method} ${url}`;
    }
  }
}

export default Registry;
