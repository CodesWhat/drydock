import axios from 'axios';
import logger from '../../log/index.js';
import { getGhcrTokenFallback } from '../../registries/ghcr-token-fallback.js';
import { withRetry } from '../../registries/http-retry.js';
import type { ReleaseNotes, ReleaseNotesProviderClient } from '../types.js';

const log = logger.child({ component: 'release-notes.provider.github' });

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

function getErrorStatusCode(error: unknown) {
  if (!isRecord(error) || !isRecord(error.response)) {
    return undefined;
  }
  return error.response.status;
}

function getErrorHeader(error: unknown, headerName: string) {
  if (!isRecord(error) || !isRecord(error.response) || !isRecord(error.response.headers)) {
    return undefined;
  }
  return error.response.headers[headerName];
}

function getDebugErrorMessage(error: unknown) {
  if (isRecord(error) && error.message) {
    return String(error.message);
  }
  return String(error);
}

function normalizeGithubRepo(sourceRepo: string) {
  const normalized = sourceRepo
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/g, '');
  const withoutGitSuffix = normalized.replace(/\.git$/i, '');
  if (!withoutGitSuffix.toLowerCase().startsWith('github.com/')) {
    return undefined;
  }

  const path = withoutGitSuffix.substring('github.com/'.length);
  const [owner, repo] = path.split('/');
  if (!owner || !repo) {
    return undefined;
  }
  return {
    owner,
    repo,
  };
}

function buildTagVariants(tag: string) {
  const tagNormalized = tag.trim();
  if (tagNormalized === '') {
    return [];
  }
  if (tagNormalized.startsWith('v')) {
    return [tagNormalized, tagNormalized.substring(1)].filter(
      (tagCandidate) => tagCandidate !== '',
    );
  }
  return [`v${tagNormalized}`, tagNormalized];
}

class GithubProvider implements ReleaseNotesProviderClient {
  id = 'github' as const;

  supports(sourceRepo: string) {
    return sourceRepo
      .trim()
      .replace(/^https?:\/\//i, '')
      .toLowerCase()
      .startsWith('github.com/');
  }

  async fetchByTag(
    sourceRepo: string,
    tag: string,
    token?: string,
  ): Promise<ReleaseNotes | undefined> {
    const repo = normalizeGithubRepo(sourceRepo);
    if (!repo) {
      return undefined;
    }

    const tagVariants = buildTagVariants(tag);
    if (tagVariants.length === 0) {
      return undefined;
    }

    // Use explicitly provided token, then fall back to any configured GHCR PAT
    // (GitHub PATs work for both ghcr.io and api.github.com).
    const effectiveToken = token ?? getGhcrTokenFallback();

    for (const tagVariant of tagVariants) {
      const endpoint = `https://api.github.com/repos/${repo.owner}/${repo.repo}/releases/tags/${encodeURIComponent(
        tagVariant,
      )}`;
      try {
        const envelope = await withRetry<UnknownRecord>(
          () =>
            axios
              .get(endpoint, {
                headers: {
                  Accept: 'application/vnd.github+json',
                  ...(effectiveToken ? { Authorization: `Bearer ${effectiveToken}` } : {}),
                },
                timeout: 10_000,
              })
              .then((r) => ({
                status: r.status,
                headers: r.headers as Record<string, string | undefined>,
                data: r.data,
              })),
          {
            logger: log,
            requestLabel: `github-release-notes GET ${endpoint}`,
            retryableStatuses: [429, 503],
          },
        );
        const data = envelope.data;

        const body = typeof data?.body === 'string' ? data.body : '';
        const title =
          typeof data?.name === 'string' && data.name.trim() !== '' ? data.name : tagVariant;
        const url =
          typeof data?.html_url === 'string' && data.html_url.trim() !== ''
            ? data.html_url
            : `https://github.com/${repo.owner}/${repo.repo}/releases/tag/${encodeURIComponent(tagVariant)}`;
        const publishedAt =
          typeof data?.published_at === 'string' && !Number.isNaN(Date.parse(data.published_at))
            ? data.published_at
            : new Date(0).toISOString();

        return {
          title,
          body,
          url,
          publishedAt,
          provider: 'github',
        };
      } catch (error: unknown) {
        const statusCode = getErrorStatusCode(error);
        if (statusCode === 404) {
          continue;
        }
        if (
          statusCode === 403 &&
          `${getErrorHeader(error, 'x-ratelimit-remaining') ?? ''}` === '0'
        ) {
          log.warn('GitHub release notes lookup is rate-limited');
          return undefined;
        }
        if (statusCode === 401 || statusCode === 403) {
          if (token === undefined && effectiveToken !== undefined) {
            log.warn('GHCR token fallback was rejected by GitHub API — check token scopes');
          } else if (token !== undefined) {
            log.warn('Configured GITHUB_TOKEN rejected by GitHub API — check token scopes');
          }
          return undefined;
        }
        log.debug(`Unable to fetch GitHub release notes (${getDebugErrorMessage(error)})`);
        return undefined;
      }
    }

    return undefined;
  }
}

export default GithubProvider;
