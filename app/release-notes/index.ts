import axios from 'axios';
import { ddEnvVars } from '../configuration/index.js';
import logger from '../log/index.js';
import type { Container, ContainerReleaseNotes } from '../model/container.js';
import { getErrorMessage } from '../util/error.js';
import GithubProvider from './providers/GithubProvider.js';
import type { ReleaseNotes, ReleaseNotesProviderClient } from './types.js';

export type SourceRepoResolution = { sourceRepo: string; trusted: boolean } | undefined;

const log = logger.child({ component: 'release-notes' });

const DD_SOURCE_REPO_LABEL = 'dd.source.repo';
const OCI_SOURCE_REPO_LABEL = 'org.opencontainers.image.source';
const OCI_URL_REPO_LABEL = 'org.opencontainers.image.url';

const RELEASE_NOTES_CACHE_TTL_MS = 60 * 60 * 1000;
const RELEASE_NOTES_CACHE_NOT_FOUND_TTL_MS = 10 * 60 * 1000;
const SOURCE_REPO_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const SOURCE_REPO_CACHE_NOT_FOUND_TTL_MS = 30 * 60 * 1000;
const DEFAULT_MAX_INTERMEDIATE_RELEASE_NOTES = 20;

const CONTAINER_RELEASE_NOTES_BODY_MAX_LENGTH = 2000;

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

type CacheLookup<T> =
  | {
      found: false;
    }
  | {
      found: true;
      value: T;
    };

const releaseNotesCache = new Map<string, CacheEntry<ReleaseNotes | null>>();
const sourceRepoCache = new Map<string, CacheEntry<string | null>>();
const intermediateReleaseNotesCache = new Map<string, CacheEntry<ReleaseNotes[]>>();
const providers: ReleaseNotesProviderClient[] = [new GithubProvider()];

function pruneExpiredCache<T>(cache: Map<string, CacheEntry<T>>) {
  const now = Date.now();
  for (const [cacheKey, cacheEntry] of cache.entries()) {
    if (now >= cacheEntry.expiresAt) {
      cache.delete(cacheKey);
    }
  }
}

function getCacheValue<T>(cache: Map<string, CacheEntry<T>>, cacheKey: string): CacheLookup<T> {
  pruneExpiredCache(cache);
  const cacheEntry = cache.get(cacheKey);
  if (!cacheEntry) {
    return { found: false };
  }
  return {
    found: true,
    value: cacheEntry.value,
  };
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
    return registryUrl
      .replace(/^https?:\/\//i, '')
      .split('/')[0]
      .toLowerCase();
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
  } catch (error: unknown) {
    log.debug(`Unable to query Docker Hub tag metadata (${getErrorMessage(error, String(error))})`);
  }

  try {
    const repositoryResponse = await axios.get(
      `https://hub.docker.com/v2/repositories/${imageName}`,
      requestOptions,
    );
    return normalizeSourceRepo(getSourceRepoFromHubPayload(repositoryResponse?.data));
  } catch (error: unknown) {
    log.debug(
      `Unable to query Docker Hub repository metadata (${getErrorMessage(error, String(error))})`,
    );
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
}): SourceRepoResolution {
  // Container label is a per-deployment, operator-set value that an attacker who
  // controls the container can spoof — classify as UNTRUSTED.
  const containerLabelOverride = normalizeSourceRepo(
    options.containerLabels?.[DD_SOURCE_REPO_LABEL],
  );
  if (containerLabelOverride) {
    const trustedImageSource =
      normalizeSourceRepo(options.imageLabels?.[DD_SOURCE_REPO_LABEL]) ??
      normalizeSourceRepo(options.imageLabels?.[OCI_SOURCE_REPO_LABEL]) ??
      normalizeSourceRepo(options.imageLabels?.[OCI_URL_REPO_LABEL]);
    if (trustedImageSource) {
      log.warn(
        'dd.source.repo container label (%s) overrides a trusted image source label (%s); the source repo is treated as untrusted and the GHCR token fallback will not be sent. Remove the dd.source.repo container label to restore trusted resolution.',
        containerLabelOverride,
        trustedImageSource,
      );
    }
    return { sourceRepo: containerLabelOverride, trusted: false };
  }

  // OCI image label baked into the image at build time — classify as TRUSTED.
  const imageLabelOverride = normalizeSourceRepo(options.imageLabels?.[DD_SOURCE_REPO_LABEL]);
  if (imageLabelOverride) {
    return { sourceRepo: imageLabelOverride, trusted: true };
  }

  const sourceLabel = normalizeSourceRepo(options.imageLabels?.[OCI_SOURCE_REPO_LABEL]);
  if (sourceLabel) {
    return { sourceRepo: sourceLabel, trusted: true };
  }

  const urlLabel = normalizeSourceRepo(options.imageLabels?.[OCI_URL_REPO_LABEL]);
  if (urlLabel) {
    return { sourceRepo: urlLabel, trusted: true };
  }

  const ghcrDerived = deriveSourceRepoFromGhcrImage(options.imageRegistryDomain, options.imagePath);
  if (ghcrDerived) {
    return { sourceRepo: ghcrDerived, trusted: true };
  }

  return undefined;
}

export async function resolveSourceRepoForContainer(
  container: Container,
  imageLabels?: Record<string, string>,
): Promise<SourceRepoResolution> {
  // Always attempt to re-resolve from labels/image metadata so we get accurate provenance
  // (trusted vs. untrusted). container.sourceRepo may have been cached from a prior cycle
  // and could originate from an untrusted container label.
  const resolution = detectSourceRepoFromImageMetadata({
    containerLabels: container.labels,
    imageLabels,
    imageRegistryDomain: getImageRegistryHostname(container.image),
    imagePath: container.image?.name,
  });
  if (resolution) {
    return resolution;
  }

  // Fall back to a pre-resolved container.sourceRepo for non-Docker-Hub images where
  // the labels/image path above yielded nothing. This covers containers persisted before
  // labels were populated and test/programmatic callers that supply only sourceRepo.
  // Treat this as untrusted because sourceRepo does not persist provenance; it may have
  // originated from a container-level dd.source.repo label in an earlier enrichment cycle.
  if (!isDockerHubImage(container.image)) {
    const cached = normalizeSourceRepo(container.sourceRepo);
    if (cached) {
      return { sourceRepo: cached, trusted: false };
    }
    return undefined;
  }

  // For Docker Hub images, check if container.sourceRepo is already available (e.g.
  // pre-populated by orchestration from a prior Docker Hub metadata lookup) before
  // making a network request.
  const cachedSourceRepo = normalizeSourceRepo(container.sourceRepo);
  if (cachedSourceRepo) {
    return { sourceRepo: cachedSourceRepo, trusted: false };
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
  if (sourceRepoFromCache.found) {
    const cachedValue = sourceRepoFromCache.value;
    return cachedValue ? { sourceRepo: cachedValue, trusted: true } : undefined;
  }

  const sourceRepo = await lookupSourceRepoFromDockerHubTagMetadata(imageName, tag);
  setCacheValue(
    sourceRepoCache,
    cacheKey,
    sourceRepo || null,
    sourceRepo ? SOURCE_REPO_CACHE_TTL_MS : SOURCE_REPO_CACHE_NOT_FOUND_TTL_MS,
  );
  return sourceRepo ? { sourceRepo, trusted: true } : undefined;
}

function getGithubToken() {
  const githubToken = ddEnvVars.DD_RELEASE_NOTES_GITHUB_TOKEN;
  if (typeof githubToken !== 'string') {
    return undefined;
  }
  const tokenTrimmed = githubToken.trim();
  return tokenTrimmed !== '' ? tokenTrimmed : undefined;
}

function getReleaseNotesAuthTier(trusted: boolean): 'auth' | 'token' | 'anon' {
  if (trusted) {
    return 'auth';
  }
  return getGithubToken() !== undefined ? 'token' : 'anon';
}

function getMaxIntermediateReleaseNotes(): number {
  const raw = ddEnvVars.DD_RELEASE_NOTES_MAX_INTERMEDIATE;
  if (typeof raw !== 'string' || raw.trim() === '') {
    return DEFAULT_MAX_INTERMEDIATE_RELEASE_NOTES;
  }
  const parsed = Number(raw.trim());
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_MAX_INTERMEDIATE_RELEASE_NOTES;
}

function getReleaseNotesCacheKey(
  providerId: string,
  sourceRepo: string,
  tag: string,
  trusted: boolean,
) {
  return `${providerId}:${sourceRepo.toLowerCase()}@${tag.toLowerCase()}#${getReleaseNotesAuthTier(trusted)}`;
}

function getIntermediateReleaseNotesCacheKey(
  providerId: string,
  sourceRepo: string,
  fromTag: string,
  toTag: string,
  trusted: boolean,
) {
  return `intermediate:${providerId}:${sourceRepo.toLowerCase()}@${fromTag.toLowerCase()}..${toTag.toLowerCase()}#${getReleaseNotesAuthTier(trusted)}`;
}

async function getReleaseNotesForSourceRepo(sourceRepo: string, tag: string, trusted: boolean) {
  const provider = providers.find((releaseNotesProvider) =>
    releaseNotesProvider.supports(sourceRepo),
  );
  if (!provider) {
    return undefined;
  }

  const cacheKey = getReleaseNotesCacheKey(provider.id, sourceRepo, tag, trusted);
  const releaseNotesFromCache = getCacheValue(releaseNotesCache, cacheKey);
  if (releaseNotesFromCache.found) {
    return releaseNotesFromCache.value ?? undefined;
  }

  const releaseNotes = await provider.fetchByTag(sourceRepo, tag, getGithubToken(), {
    allowToken: trusted,
  });
  setCacheValue(
    releaseNotesCache,
    cacheKey,
    releaseNotes || null,
    releaseNotes ? RELEASE_NOTES_CACHE_TTL_MS : RELEASE_NOTES_CACHE_NOT_FOUND_TTL_MS,
  );
  return releaseNotes;
}

export async function getReleaseNotesForTag(
  container: Container,
  tag: string | undefined,
  imageLabels?: Record<string, string>,
) {
  if (typeof tag !== 'string' || tag.trim() === '') {
    return undefined;
  }

  const resolution = await resolveSourceRepoForContainer(container, imageLabels);
  if (!resolution) {
    return undefined;
  }
  return getReleaseNotesForSourceRepo(resolution.sourceRepo, tag, resolution.trusted);
}

export async function getFullReleaseNotesForContainer(container: Container) {
  return getReleaseNotesForTag(container, container.result?.tag);
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

export async function getIntermediateReleaseNotes(
  container: Container,
  fromTag: string,
  toTag: string,
  imageLabels?: Record<string, string>,
): Promise<{ releaseNotes: ContainerReleaseNotes[]; hiddenCount: number }> {
  const empty = { releaseNotes: [] as ContainerReleaseNotes[], hiddenCount: 0 };
  if (
    typeof fromTag !== 'string' ||
    fromTag.trim() === '' ||
    typeof toTag !== 'string' ||
    toTag.trim() === '' ||
    fromTag.trim() === toTag.trim()
  ) {
    return empty;
  }

  const max = getMaxIntermediateReleaseNotes();
  if (max === 0) {
    return empty;
  }

  const resolution = await resolveSourceRepoForContainer(container, imageLabels);
  if (!resolution) {
    return empty;
  }

  const provider = providers.find((releaseNotesProvider) =>
    releaseNotesProvider.supports(resolution.sourceRepo),
  );
  if (!provider || !provider.fetchRange) {
    return empty;
  }

  const cacheKey = getIntermediateReleaseNotesCacheKey(
    provider.id,
    resolution.sourceRepo,
    fromTag,
    toTag,
    resolution.trusted,
  );
  const cached = getCacheValue(intermediateReleaseNotesCache, cacheKey);

  let allNotes: ReleaseNotes[];
  if (cached.found) {
    allNotes = cached.value;
  } else {
    const result = await provider.fetchRange(resolution.sourceRepo, fromTag, toTag, getGithubToken(), {
      allowToken: resolution.trusted,
    });
    allNotes = result.notes;
    // Only cache complete results. A partial (interrupted) fetch must be retried next time.
    if (!result.interrupted) {
      setCacheValue(intermediateReleaseNotesCache, cacheKey, allNotes, RELEASE_NOTES_CACHE_TTL_MS);
    }
  }

  // Cap is applied at READ time so changing DD_RELEASE_NOTES_MAX_INTERMEDIATE takes
  // effect without invalidating the cache, and hiddenCount is never silently dropped.
  const capped = allNotes.slice(0, max);
  return {
    releaseNotes: capped.map((note) => toContainerReleaseNotes(note)),
    hiddenCount: Math.max(0, allNotes.length - max),
  };
}

export function _resetReleaseNotesCacheForTests() {
  releaseNotesCache.clear();
  sourceRepoCache.clear();
  intermediateReleaseNotesCache.clear();
}
