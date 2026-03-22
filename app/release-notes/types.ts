export type ReleaseNotesProvider = 'github' | 'gitlab' | 'gitea';

export interface ReleaseNotes {
  title: string;
  body: string;
  url: string;
  publishedAt: string;
  provider: ReleaseNotesProvider;
}

export interface ReleaseNotesProviderClient {
  id: ReleaseNotesProvider;
  supports: (sourceRepo: string) => boolean;
  fetchByTag: (
    sourceRepo: string,
    tag: string,
    token?: string,
  ) => Promise<ReleaseNotes | undefined>;
}
