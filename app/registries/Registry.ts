import http from 'node:http';
import https from 'node:https';
import axios, { type AxiosRequestConfig, type AxiosResponse, type Method } from 'axios';
import log from '../log/index.js';
import type { ContainerImage } from '../model/container.js';
import { getSummaryTags } from '../prometheus/registry.js';
import Component from '../registry/Component.js';
import { getErrorMessage } from '../util/error.js';
import { getRegistryRequestTimeoutMs } from './configuration.js';

interface RegistryImage extends ContainerImage {
  // Add registry-specific properties if needed
}

interface RegistryManifest {
  digest?: string;
  version?: number;
  created?: string;
}

export interface RegistryTagsList {
  name: string;
  tags: string[];
}

interface ManifestEntry {
  digest: string;
  mediaType: string;
  platform: {
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
    (m) => m.platform.architecture === architecture && m.platform.os === os,
  );

  if (matches.length === 0) {
    return undefined;
  }

  // Start with first match (better than nothing)
  let best = matches[0];

  // Refine using variant when multiple matches exist
  if (matches.length > 1 && variant !== undefined) {
    const variantMatch = matches.find((m) => m.platform.variant === variant);
    if (variantMatch) {
      best = variantMatch;
    }
  }

  return best;
}

/** Handle schemaVersion 1 manifests (legacy). */
function handleSchemaV1(response: RegistryManifestResponse): RegistryManifest {
  const v1Compat = JSON.parse(response.history?.[0].v1Compatibility);
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
class Registry extends Component {
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
   * Get Tags.
   * @param image
   * @returns {*}
   */
  async getTags(image: ContainerImage): Promise<string[]> {
    this.log.debug(`Get ${image.name} tags`);
    const tags: string[] = [];
    let page: AxiosResponse<RegistryTagsList> | undefined = undefined;
    let hasNext = true;
    let link: string | undefined = undefined;
    while (hasNext) {
      const lastItem = page?.data?.tags?.slice(-1)?.[0];

      page = await this.getTagsPage(image, lastItem, link);
      const pageTags = page?.data?.tags ?? [];
      link = page?.headers?.link;
      hasNext = page?.headers?.link !== undefined;
      tags.push(...pageTags);
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
    _link: string | undefined = undefined,
  ) {
    // Default items per page (not honoured by all registries)
    const itemsPerPage = 1000;
    const last = lastItem ? `&last=${lastItem}` : '';
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
  async getImageManifestDigest(image: ContainerImage, digest?: string): Promise<RegistryManifest> {
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
      log.debug(`Found manifests [${JSON.stringify(responseManifests)}]`);
      if (responseManifests.schemaVersion === 1) {
        log.debug('Manifests found with schemaVersion = 1');
        const result = handleSchemaV1(responseManifests);
        log.debug(
          `Manifest found with [digest=${result.digest}, created=${result.created}, version=${result.version}]`,
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
  async getImagePublishedAt(image: ContainerImage, tag?: string): Promise<string | undefined> {
    const imageToInspect = structuredClone(image);
    const tagToLookup = typeof tag === 'string' && tag.length > 0 ? tag : imageToInspect.tag?.value;
    if (tagToLookup && imageToInspect.tag) {
      imageToInspect.tag.value = tagToLookup;
    }
    const manifest = await this.getImageManifestDigest(imageToInspect);
    if (typeof manifest?.created !== 'string') {
      return undefined;
    }
    return Number.isNaN(Date.parse(manifest.created)) ? undefined : manifest.created;
  }

  /**
   * Handle schemaVersion 2 manifests (multi-platform list or single manifest).
   */
  private async handleSchemaV2(
    image: ContainerImage,
    response: RegistryManifestResponse,
    tagOrDigest: string,
  ): Promise<RegistryManifest> {
    log.debug('Manifests found with schemaVersion = 2');
    log.debug(`Manifests media type detected [${response.mediaType}]`);

    let manifestDigest: string | undefined;
    let manifestMediaType: string | undefined;

    if (isManifestList(response.mediaType)) {
      log.debug(
        `Filter manifest for [arch=${image.architecture}, os=${image.os}, variant=${image.variant}]`,
      );
      const manifests = response.manifests ?? [];
      const matched = filterManifestByPlatform(
        manifests,
        image.architecture,
        image.os,
        image.variant,
      );
      if (matched) {
        log.debug(`Manifest found with [digest=${matched.digest}, mediaType=${matched.mediaType}]`);
        manifestDigest = matched.digest;
        manifestMediaType = matched.mediaType;
      }
    } else if (isSingleManifest(response.mediaType)) {
      const manifestReference = tagOrDigest;
      log.debug(
        `Manifest found with [reference=${manifestReference}, mediaType=${response.mediaType}]`,
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
        /* v8 ignore start -- legacy manifest created timestamps are optional */
        ...(created ? { created } : {}),
        /* v8 ignore stop */
      };
      log.debug(`Manifest found with [digest=${result.digest}, version=${result.version}]`);
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
    log.debug('Calling registry to get docker-content-digest header');
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
      /* v8 ignore start -- some registries omit docker-content-digest on HEAD responses */
      responseManifest.headers['docker-content-digest'] || manifestDigest;
    /* v8 ignore stop */
    const created = await this.fetchImageCreatedFromManifestConfig(
      image,
      resolvedManifestDigest,
      mediaType,
    );
    const result = {
      digest: responseManifest.headers['docker-content-digest'],
      version: 2,
      ...(created ? { created } : {}),
    };
    log.debug(`Manifest found with [digest=${result.digest}, version=${result.version}]`);
    return result;
  }

  private async fetchImageCreatedFromManifestConfig(
    image: ContainerImage,
    manifestDigest: string,
    mediaType: string,
  ): Promise<string | undefined> {
    try {
      const manifestResponse = await this.callRegistry<RegistryManifestResponse>({
        image,
        method: 'get',
        url: `${image.registry.url}/${image.name}/manifests/${manifestDigest}`,
        headers: {
          Accept: mediaType,
        },
      });
      const configDigest = manifestResponse?.config?.digest;
      if (!configDigest) {
        return undefined;
      }
      return this.fetchImageCreatedFromBlob(image, configDigest);
    } catch (error: unknown) {
      log.debug(
        `Unable to fetch manifest config created date for ${this.getImageFullName(
          image,
          manifestDigest,
        )} (${getErrorMessage(error)})`,
      );
      return undefined;
    }
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
      log.debug(
        `Unable to fetch image config blob created date for ${this.getImageFullName(
          image,
          digest,
        )} (${getErrorMessage(error)})`,
      );
      return undefined;
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
    };

    const axiosOptionsWithAuth = await this.authenticate(image, axiosOptions);
    const axiosOptionsWithConnectionReuse: AxiosRequestConfig = {
      ...axiosOptionsWithAuth,
      httpAgent: axiosOptionsWithAuth.httpAgent ?? DEFAULT_HTTP_KEEP_ALIVE_AGENT,
      httpsAgent: axiosOptionsWithAuth.httpsAgent ?? DEFAULT_HTTPS_KEEP_ALIVE_AGENT,
    };

    try {
      const response = await axios<T>(axiosOptionsWithConnectionReuse);
      const end = Date.now();
      getSummaryTags()?.observe({ type: this.type, name: this.name }, (end - start) / 1000);
      return resolveWithFullResponse ? response : response.data;
    } catch (error) {
      const end = Date.now();
      getSummaryTags()?.observe({ type: this.type, name: this.name }, (end - start) / 1000);
      throw error;
    }
  }

  getImageFullName(image: ContainerImage, tagOrDigest: string) {
    // digests are separated with @ whereas tags are separated with :
    const tagOrDigestWithSeparator = tagOrDigest.includes(':')
      ? `@${tagOrDigest}`
      : `:${tagOrDigest}`;
    let fullName = `${image.registry.url}/${image.name}${tagOrDigestWithSeparator}`;

    fullName = fullName.replace(/https?:\/\//, '');
    fullName = fullName.replace(/\/v2/, '');
    return fullName;
  }

  /**
   * Return {username, pass } or undefined.
   * @returns {}
   */

  async getAuthPull(): Promise<{ username?: string; password?: string } | undefined> {
    return undefined;
  }
}

export default Registry;
