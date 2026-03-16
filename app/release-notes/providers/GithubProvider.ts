import axios from 'axios';
import logger from '../../log/index.js';
import type { ReleaseNotes, ReleaseNotesProviderClient } from '../types.js';

const log = logger.child({ component: 'release-notes.provider.github' });

function normalizeGithubRepo(sourceRepo: string) {
  const normalized = sourceRepo.trim().replace(/^https?:\/\//i, '').replace(/\/+$/g, '');
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
    return [tagNormalized, tagNormalized.substring(1)].filter((tagCandidate) => tagCandidate !== '');
  }
  return [`v${tagNormalized}`, tagNormalized];
}

class GithubProvider implements ReleaseNotesProviderClient {
  id = 'github' as const;

  supports(sourceRepo: string) {
    return sourceRepo.trim().replace(/^https?:\/\//i, '').toLowerCase().startsWith('github.com/');
  }

  async fetchByTag(sourceRepo: string, tag: string, token?: string): Promise<ReleaseNotes | undefined> {
    const repo = normalizeGithubRepo(sourceRepo);
    if (!repo) {
      return undefined;
    }

    const tagVariants = buildTagVariants(tag);
    if (tagVariants.length === 0) {
      return undefined;
    }

    for (const tagVariant of tagVariants) {
      const endpoint = `https://api.github.com/repos/${repo.owner}/${repo.repo}/releases/tags/${encodeURIComponent(
        tagVariant,
      )}`;
      try {
        const response = await axios.get(endpoint, {
          headers: {
            Accept: 'application/vnd.github+json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          timeout: 10_000,
        });

        const body = typeof response?.data?.body === 'string' ? response.data.body : '';
        const title =
          typeof response?.data?.name === 'string' && response.data.name.trim() !== ''
            ? response.data.name
            : tagVariant;
        const url =
          typeof response?.data?.html_url === 'string' && response.data.html_url.trim() !== ''
            ? response.data.html_url
            : `https://github.com/${repo.owner}/${repo.repo}/releases/tag/${encodeURIComponent(tagVariant)}`;
        const publishedAt =
          typeof response?.data?.published_at === 'string' &&
          !Number.isNaN(Date.parse(response.data.published_at))
            ? response.data.published_at
            : new Date(0).toISOString();

        return {
          title,
          body,
          url,
          publishedAt,
          provider: 'github',
        };
      } catch (error: any) {
        const statusCode = error?.response?.status;
        if (statusCode === 404) {
          continue;
        }
        if (
          statusCode === 403 &&
          `${error?.response?.headers?.['x-ratelimit-remaining'] ?? ''}` === '0'
        ) {
          log.warn('GitHub release notes lookup is rate-limited');
          return undefined;
        }
        log.debug(`Unable to fetch GitHub release notes (${error?.message || error})`);
        return undefined;
      }
    }

    return undefined;
  }
}

export default GithubProvider;
