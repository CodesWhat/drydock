import axios from 'axios';
import { ddEnvVars } from '../configuration/index.js';
import logger from '../log/index.js';
import type { Container } from '../model/container.js';
import GithubProvider from './providers/GithubProvider.js';
import type { ReleaseNotes, ReleaseNotesProviderClient } from './types.js';

const log = logger.child({ component: 'release-notes' });

const DD_SOURCE_REPO_LABEL = 'dd.source.repo';
const OCI_SOURCE_REPO_LABEL = 'org.opencontainers.image.source';
const OCI_URL_REPO_LABEL = 'org.opencontainers.image.url';

const RELEASE_NOTES_CACHE_TTL_MS = 60 * 60 * 1000;
const RELEASE_NOTES_CACHE_NOT_FOUND_TTL_MS = 10 * 60 * 1000;
const SOURCE_REPO_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const SOURCE_REPO_CACHE_NOT_FOUND_TTL_MS = 30 * 60 * 1000;

const CONTAINER_RELEASE_NOTES_BODY_MAX_LENGTH = 2000;

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

const releaseNotesCache = new Map<string, CacheEntry<ReleaseNotes | null>>();
const sourceRepoCache = new Map<string, CacheEntry<string | null>>();
const providers: ReleaseNotesProviderClient[] = [new GithubProvider()];

function pruneExpiredCache<T>(cache: Map<string, CacheEntry<T>>) {
  const now = Date.now();
  for (const [cacheKey, cacheEntry] of cache.entries()) {
    if (now >= cacheEntry.expiresAt) {
      cache.delete(cacheKey);
    }
  }
}

function getCacheValue<T>(cache: Map<string, CacheEntry<T>>, cacheKey: string) {
  pruneExpiredCache(cache);
  const cacheEntry = cache.get(cacheKey);
  if (!cacheEntry) {
    return undefined;
  }
  return cacheEntry.value;
}

function setCacheValue<T>(
  cache: Map<string, CacheEntry<T>>,
  cacheKey: string,
  value: T,
  ttlMs: number,
) {
  cache.set(cacheKey, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
}

function getImageRegistryHostname(image: Container['image'] | undefined) {
  const registryUrl = image?.registry?.url;
  if (typeof registryUrl !== 'string' || registryUrl.trim() === '') {
    return undefined;
  }
  const withProtocol = /^https?:\/\//i.test(registryUrl) ? registryUrl : `https://${registryUrl}`;
  try {
    return new URL(withProtocol).hostname.toLowerCase();
  } catch {
    return registryUrl.replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();
  }
}

function normalizeSourceRepo(sourceRepoRaw?: string) {
  if (typeof sourceRepoRaw !== 'string') {
    return undefined;
  }
  const sourceRepoTrimmed = sourceRepoRaw.trim();
  if (sourceRepoTrimmed === '') {
    return undefined;
  }

  if (sourceRepoTrimmed.startsWith('git@') && sourceRepoTrimmed.includes(':')) {
    const [sshPrefix, sshPath] = sourceRepoTrimmed.split(':');
    const sshHost = sshPrefix.substring('git@'.length);
    if (sshHost !== '' && sshPath !== '') {
      return normalizeSourceRepo(`${sshHost}/${sshPath}`);
    }
  }

  const withProtocol = /^https?:\/\//i.test(sourceRepoTrimmed)
    ? sourceRepoTrimmed
    : `https://${sourceRepoTrimmed}`;
  try {
    const sourceRepoUrl = new URL(withProtocol);
    const sourceRepoPath = sourceRepoUrl.pathname
      .replace(/^\/+/, '')
      .replace(/\/+$/, '')
      .replace(/\.git$/i, '');
    if (sourceRepoPath === '') {
      return undefined;
    }

    const [owner, repo] = sourceRepoPath.split('/');
    if (!owner || !repo) {
      return undefined;
    }
    return `${sourceRepoUrl.hostname.toLowerCase()}/${owner}/${repo}`;
  } catch {
    return undefined;
  }
}

function deriveSourceRepoFromGhcrImage(imageRegistryDomain?: string, imagePath?: string) {
  if (
    typeof imageRegistryDomain !== 'string' ||
    imageRegistryDomain.toLowerCase() !== 'ghcr.io' ||
    typeof imagePath !== 'string'
  ) {
    return undefined;
  }

  const [owner, repo] = imagePath
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment !== '');
  if (!owner || !repo) {
    return undefined;
  }
  return normalizeSourceRepo(`github.com/${owner}/${repo}`);
}

function isDockerHubImage(image: Container['image'] | undefined) {
  const registryHost = getImageRegistryHostname(image);
  return (
    !registryHost ||
    registryHost === 'docker.io' ||
    registryHost === 'registry-1.docker.io' ||
    registryHost.endsWith('.docker.io')
  );
}

function getSourceRepoFromHubPayload(payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }
  const payloadRecord = payload as Record<string, unknown>;
  if (typeof payloadRecord.source === 'string') {
    return payloadRecord.source;
  }
  const repository = payloadRecord.repository as Record<string, unknown> | undefined;
  if (repository && typeof repository.source === 'string') {
    return repository.source;
  }
  return undefined;
}

async function lookupSourceRepoFromDockerHubTagMetadata(imageName: string, tag: string) {
  const tagMetadataUrl = `https://hub.docker.com/v2/repositories/${imageName}/tags/${encodeURIComponent(
    tag,
  )}`;
  const requestOptions = {
    headers: {
      Accept: 'application/json',
    },
    timeout: 10_000,
  };

  try {
    const tagResponse = await axios.get(tagMetadataUrl, requestOptions);
    const sourceRepoCandidate = normalizeSourceRepo(getSourceRepoFromHubPayload(tagResponse?.data));
    if (sourceRepoCandidate) {
      return sourceRepoCandidate;
    }
  } catch (error: any) {
    log.debug(`Unable to query Docker Hub tag metadata (${error?.message || error})`);
  }

  try {
    const repositoryResponse = await axios.get(
      `https://hub.docker.com/v2/repositories/${imageName}`,
      requestOptions,
    );
    return normalizeSourceRepo(getSourceRepoFromHubPayload(repositoryResponse?.data));
  } catch (error: any) {
    log.debug(`Unable to query Docker Hub repository metadata (${error?.message || error})`);
  }

  return undefined;
}

function getSourceRepoCacheKey(imageName: string, tag: string) {
  return `${imageName.toLowerCase()}@${tag.toLowerCase()}`;
}

export function detectSourceRepoFromImageMetadata(options: {
  containerLabels?: Record<string, string>;
  imageLabels?: Record<string, string>;
  imageRegistryDomain?: string;
  imagePath?: string;
}) {
  const manualOverride =
    normalizeSourceRepo(options.containerLabels?.[DD_SOURCE_REPO_LABEL]) ||
    normalizeSourceRepo(options.imageLabels?.[DD_SOURCE_REPO_LABEL]);
  if (manualOverride) {
    return manualOverride;
  }

  const sourceLabel = normalizeSourceRepo(options.imageLabels?.[OCI_SOURCE_REPO_LABEL]);
  if (sourceLabel) {
    return sourceLabel;
  }

  const urlLabel = normalizeSourceRepo(options.imageLabels?.[OCI_URL_REPO_LABEL]);
  if (urlLabel) {
    return urlLabel;
  }

  return deriveSourceRepoFromGhcrImage(options.imageRegistryDomain, options.imagePath);
}

export async function resolveSourceRepoForContainer(container: Container) {
  const sourceRepoFromContainer = normalizeSourceRepo(container.sourceRepo);
  if (sourceRepoFromContainer) {
    return sourceRepoFromContainer;
  }

  const sourceRepoFromLabelsOrGhcr = detectSourceRepoFromImageMetadata({
    containerLabels: container.labels,
    imageRegistryDomain: getImageRegistryHostname(container.image),
    imagePath: container.image?.name,
  });
  if (sourceRepoFromLabelsOrGhcr) {
    return sourceRepoFromLabelsOrGhcr;
  }

  if (!isDockerHubImage(container.image)) {
    return undefined;
  }

  const imageName = container.image?.name;
  const tag = container.result?.tag || container.image?.tag?.value;
  if (
    typeof imageName !== 'string' ||
    imageName.trim() === '' ||
    typeof tag !== 'string' ||
    tag.trim() === ''
  ) {
    return undefined;
  }

  const cacheKey = getSourceRepoCacheKey(imageName, tag);
  const sourceRepoFromCache = getCacheValue(sourceRepoCache, cacheKey);
  if (sourceRepoFromCache !== undefined) {
    return sourceRepoFromCache || undefined;
  }

  const sourceRepo = await lookupSourceRepoFromDockerHubTagMetadata(imageName, tag);
  setCacheValue(
    sourceRepoCache,
    cacheKey,
    sourceRepo || null,
    sourceRepo ? SOURCE_REPO_CACHE_TTL_MS : SOURCE_REPO_CACHE_NOT_FOUND_TTL_MS,
  );
  return sourceRepo;
}

function getGithubToken() {
  const githubToken = ddEnvVars.DD_RELEASE_NOTES_GITHUB_TOKEN;
  if (typeof githubToken !== 'string') {
    return undefined;
  }
  const tokenTrimmed = githubToken.trim();
  return tokenTrimmed !== '' ? tokenTrimmed : undefined;
}

function getReleaseNotesCacheKey(providerId: string, sourceRepo: string, tag: string) {
  return `${providerId}:${sourceRepo.toLowerCase()}@${tag.toLowerCase()}`;
}

async function getReleaseNotesForSourceRepo(sourceRepo: string, tag: string) {
  const provider = providers.find((releaseNotesProvider) => releaseNotesProvider.supports(sourceRepo));
  if (!provider) {
    return undefined;
  }

  const cacheKey = getReleaseNotesCacheKey(provider.id, sourceRepo, tag);
  const releaseNotesFromCache = getCacheValue(releaseNotesCache, cacheKey);
  if (releaseNotesFromCache !== undefined) {
    return releaseNotesFromCache || undefined;
  }

  const releaseNotes = await provider.fetchByTag(sourceRepo, tag, getGithubToken());
  setCacheValue(
    releaseNotesCache,
    cacheKey,
    releaseNotes || null,
    releaseNotes ? RELEASE_NOTES_CACHE_TTL_MS : RELEASE_NOTES_CACHE_NOT_FOUND_TTL_MS,
  );
  return releaseNotes;
}

export async function getFullReleaseNotesForContainer(container: Container) {
  const tag = container.result?.tag;
  if (typeof tag !== 'string' || tag.trim() === '') {
    return undefined;
  }

  const sourceRepo = await resolveSourceRepoForContainer(container);
  if (!sourceRepo) {
    return undefined;
  }
  return getReleaseNotesForSourceRepo(sourceRepo, tag);
}

export function truncateReleaseNotesBody(body: string, maxLength: number) {
  const bodyString = typeof body === 'string' ? body : '';
  if (maxLength <= 0) {
    return '';
  }
  if (bodyString.length <= maxLength) {
    return bodyString;
  }
  if (maxLength <= 3) {
    return bodyString.substring(0, maxLength);
  }
  return `${bodyString.substring(0, maxLength - 3)}...`;
}

export function toContainerReleaseNotes(
  releaseNotes: ReleaseNotes,
  bodyMaxLength = CONTAINER_RELEASE_NOTES_BODY_MAX_LENGTH,
) {
  return {
    ...releaseNotes,
    body: truncateReleaseNotesBody(releaseNotes.body, bodyMaxLength),
  };
}

export function _resetReleaseNotesCacheForTests() {
  releaseNotesCache.clear();
  sourceRepoCache.clear();
}
