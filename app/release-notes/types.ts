export type ReleaseNotesProvider = 'github' | 'gitlab' | 'gitea';

export interface ReleaseNotes {
  title: string;
  body: string;
  url: string;
  publishedAt: string;
  provider: ReleaseNotesProvider;
}

export interface FetchByTagOptions {
  /**
   * When false, the GHCR PAT fallback (getGhcrTokenFallback) is NOT attached to the
   * request. An explicitly-provided token (e.g. DD_RELEASE_NOTES_GITHUB_TOKEN) is
   * always forwarded regardless of this flag — the operator scoped it deliberately for
   * release-notes lookups, even for untrusted container-label source repos.
   * Set to false when the source repo originates from a per-deployment container label
   * (dd.source.repo) that may be attacker-controlled.
   */
  allowToken?: boolean;
}

export interface ReleaseNotesProviderClient {
  id: ReleaseNotesProvider;
  supports: (sourceRepo: string) => boolean;
  fetchByTag: (
    sourceRepo: string,
    tag: string,
    token?: string,
    options?: FetchByTagOptions,
  ) => Promise<ReleaseNotes | undefined>;
  fetchRange?: (
    sourceRepo: string,
    fromTag: string,
    toTag: string,
    token?: string,
    options?: FetchByTagOptions,
  ) => Promise<{ notes: ReleaseNotes[]; interrupted: boolean }>;
}
