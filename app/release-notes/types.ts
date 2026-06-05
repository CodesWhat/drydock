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
   * When false, no token (explicit or GHCR fallback) is attached to the request.
   * Set to false when the source repo originates from a per-deployment container
   * label (dd.source.repo) that may be attacker-controlled.
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
}
