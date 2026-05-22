import axios from 'axios';
import logger from '../../log/index.js';
import { getGhcrTokenFallback } from '../../registries/ghcr-token-fallback.js';
import { withRetry } from '../../registries/http-retry.js';
import type { ReleaseNotes, ReleaseNotesProviderClient } from '../types.js';

const log = logger.child({ component: 'release-notes.provider.github' });

/**
 * Default cooldown when GitHub does not supply a retry hint.
 * 60 s is conservative but safe for bursts of ~25 containers.
 */
const DEFAULT_SECONDARY_RATE_LIMIT_COOLDOWN_MS = 60_000;

/**
 * Hard upper bound on any cooldown derived from GitHub response headers.
 * Prevents a garbage or far-future header value from making the cooldown
 * effectively permanent for the lifetime of the process.
 */
const MAX_SECONDARY_RATE_LIMIT_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour hard cap

/**
 * Module-level cooldown timestamp.  While Date.now() < rateLimitCooldownUntil,
 * all GitHub release-notes lookups are skipped to avoid hammering an already-
 * tripped secondary rate limit.  The timestamp becomes stale on its own; the
 * Date.now() < rateLimitCooldownUntil comparison transparently bypasses an
 * expired cooldown without any explicit reset.
 */
let rateLimitCooldownUntil = 0;

/** Exposed for tests only — reset module-level cooldown state. */
export function _resetGithubProviderCooldownForTests() {
  rateLimitCooldownUntil = 0;
}

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

/**
 * Returns true when an error is a GitHub secondary rate-limit 403.
 *
 * GitHub signals the secondary rate limit with a 403 that carries either:
 *   - a `retry-after` header (seconds to wait), or
 *   - `x-ratelimit-remaining: 0` (quota exhausted, often with `x-ratelimit-reset`).
 *
 * A plain 403 without those headers is a genuine auth failure and must NOT
 * be retried.
 */
function isSecondaryRateLimit403(error: unknown): boolean {
  if (getErrorStatusCode(error) !== 403) {
    return false;
  }
  const retryAfter = getErrorHeader(error, 'retry-after');
  if (typeof retryAfter === 'string' && retryAfter.trim() !== '') {
    return true;
  }
  return `${getErrorHeader(error, 'x-ratelimit-remaining') ?? ''}` === '0';
}

/**
 * Returns the delay hint from a secondary-rate-limit 403 in milliseconds.
 *
 * Priority:
 *   1. `retry-after` header (seconds integer)
 *   2. `x-ratelimit-reset` header (Unix epoch seconds)
 *   3. DEFAULT_SECONDARY_RATE_LIMIT_COOLDOWN_MS fallback
 *
 * The raw value is clamped to [0, MAX_SECONDARY_RATE_LIMIT_COOLDOWN_MS] so
 * that a garbage or far-future header value cannot produce an unbounded delay.
 */
function getSecondaryRateLimitDelayMs(error: unknown): number {
  let rawMs: number;

  const retryAfter = getErrorHeader(error, 'retry-after');
  if (typeof retryAfter === 'string' && /^\d+$/.test(retryAfter.trim())) {
    rawMs = Number.parseInt(retryAfter.trim(), 10) * 1000;
  } else {
    const resetEpoch = getErrorHeader(error, 'x-ratelimit-reset');
    if (typeof resetEpoch === 'string' && /^\d+$/.test(resetEpoch.trim())) {
      const delayMs = Number.parseInt(resetEpoch.trim(), 10) * 1000 - Date.now();
      rawMs = delayMs > 0 ? delayMs : DEFAULT_SECONDARY_RATE_LIMIT_COOLDOWN_MS;
    } else {
      rawMs = DEFAULT_SECONDARY_RATE_LIMIT_COOLDOWN_MS;
    }
  }

  return Math.min(Math.max(0, rawMs), MAX_SECONDARY_RATE_LIMIT_COOLDOWN_MS);
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
    // Burst cooldown — if a secondary rate-limit was tripped recently,
    // skip the API call entirely rather than hammering an already-tripped limit.
    if (Date.now() < rateLimitCooldownUntil) {
      log.debug('GitHub release notes skipped — secondary rate-limit cooldown active');
      return undefined;
    }

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
            // Also retry secondary-rate-limit 403s
            retryPredicate: isSecondaryRateLimit403,
            // Honor GitHub's own retry hint for the per-attempt delay
            retryDelayMs: (err) =>
              isSecondaryRateLimit403(err) ? getSecondaryRateLimitDelayMs(err) : undefined,
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
        // After retries are exhausted on a secondary rate-limit 403,
        // set the module-level cooldown to protect subsequent lookups in this window.
        if (isSecondaryRateLimit403(error)) {
          // Floor the burst cooldown at the default: a `retry-after: 0` hint yields a
          // 0 ms delay, which would set an already-expired cooldown and disable
          // burst protection for subsequent lookups.
          const cooldownMs =
            getSecondaryRateLimitDelayMs(error) || DEFAULT_SECONDARY_RATE_LIMIT_COOLDOWN_MS;
          rateLimitCooldownUntil = Date.now() + cooldownMs;
          log.warn(
            `GitHub release notes lookup is rate-limited (${effectiveToken !== undefined ? 'authenticated' : 'unauthenticated'}) — cooldown active for ${Math.ceil(cooldownMs / 1000)}s`,
          );
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
