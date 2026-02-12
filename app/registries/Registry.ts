import axios, { type AxiosRequestConfig, type AxiosResponse, type Method } from 'axios';
import log from '../log/index.js';
import type { ContainerImage } from '../model/container.js';
import { getSummaryTags } from '../prometheus/registry.js';
import Component from '../registry/Component.js';

export interface RegistryImage extends ContainerImage {
  // Add any registry specific properties if needed
}

export interface RegistryManifest {
  digest?: string;
  version?: number;
  created?: string;
}

export interface RegistryTagsList {
  name: string;
  tags: string[];
}

export interface ManifestEntry {
  digest: string;
  mediaType: string;
  platform: {
    architecture: string;
    os: string;
    variant?: string;
  };
}

export interface RegistryManifestResponse {
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
      const result = { digest: manifestDigest, version: 1 };
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
    const result = {
      digest: responseManifest.headers['docker-content-digest'],
      version: 2,
    };
    log.debug(`Manifest found with [digest=${result.digest}, version=${result.version}]`);
    return result;
  }

  async callRegistry<T = any>(options: {
    image: ContainerImage;
    url: string;
    method?: Method;
    headers?: any;
    resolveWithFullResponse: true;
  }): Promise<AxiosResponse<T>>;

  async callRegistry<T = any>(options: {
    image: ContainerImage;
    url: string;
    method?: Method;
    headers?: any;
    resolveWithFullResponse?: false;
  }): Promise<T>;

  async callRegistry<T = any>({
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
    headers?: any;
    resolveWithFullResponse?: boolean;
  }): Promise<T | AxiosResponse<T>> {
    const start = Date.now();

    // Request options
    const axiosOptions: AxiosRequestConfig = {
      url,
      method,
      headers,
      responseType: 'json',
    };

    const axiosOptionsWithAuth = await this.authenticate(image, axiosOptions);

    try {
      const response = await axios<T>(axiosOptionsWithAuth);
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
