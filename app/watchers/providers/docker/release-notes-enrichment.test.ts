import type { Container } from '../../../model/container.js';
import { enrichContainerWithReleaseNotes } from './release-notes-enrichment.js';

const mockResolveSourceRepoForContainer = vi.hoisted(() => vi.fn());
const mockGetReleaseNotesForTag = vi.hoisted(() => vi.fn());
const mockToContainerReleaseNotes = vi.hoisted(() => vi.fn((notes) => notes));

vi.mock('../../../release-notes/index.js', () => ({
  resolveSourceRepoForContainer: (...args: unknown[]) => mockResolveSourceRepoForContainer(...args),
  getReleaseNotesForTag: (...args: unknown[]) => mockGetReleaseNotesForTag(...args),
  toContainerReleaseNotes: (...args: unknown[]) => mockToContainerReleaseNotes(...args),
}));

function createContainer(overrides: Partial<Container> = {}): Container {
  return {
    id: 'container-id',
    name: 'container-name',
    displayName: 'container-name',
    displayIcon: 'mdi:docker',
    status: 'running',
    watcher: 'docker',
    image: {
      id: 'image-id',
      registry: {
        name: 'dockerhub',
        url: 'docker.io',
      },
      name: 'library/nginx',
      tag: {
        value: '1.0.0',
        semver: true,
      },
      digest: {
        watch: false,
      },
      architecture: 'amd64',
      os: 'linux',
    },
    updateAvailable: false,
    updateKind: {
      kind: 'unknown',
    },
    ...overrides,
  };
}

function makeNotes(tag: string) {
  return {
    title: `Release ${tag}`,
    body: `Notes for ${tag}`,
    url: `https://github.com/acme/service/releases/tag/${tag}`,
    publishedAt: '2026-01-01T00:00:00.000Z',
    provider: 'github' as const,
  };
}

describe('release-notes-enrichment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('populates currentReleaseNotes when notes exist for current tag even when updateAvailable is false', async () => {
    const currentNotes = makeNotes('1.0.0');
    mockResolveSourceRepoForContainer.mockResolvedValue(undefined);
    mockGetReleaseNotesForTag.mockResolvedValue(currentNotes);

    const container = createContainer({ updateAvailable: false });
    const logContainer = { debug: vi.fn() };

    await enrichContainerWithReleaseNotes(container, logContainer);

    expect(container.currentReleaseNotes).toEqual(currentNotes);
  });

  test('does not populate currentReleaseNotes when getReleaseNotesForTag returns undefined for current tag', async () => {
    mockResolveSourceRepoForContainer.mockResolvedValue(undefined);
    mockGetReleaseNotesForTag.mockResolvedValue(undefined);

    const container = createContainer({ updateAvailable: false });
    const logContainer = { debug: vi.fn() };

    await enrichContainerWithReleaseNotes(container, logContainer);

    expect(container.currentReleaseNotes).toBeUndefined();
  });

  test('sets sourceRepo from resolveSourceRepoForContainer regardless of update availability', async () => {
    mockResolveSourceRepoForContainer.mockResolvedValue('github.com/acme/service');
    mockGetReleaseNotesForTag.mockResolvedValue(undefined);

    const container = createContainer({ updateAvailable: false });
    const logContainer = { debug: vi.fn() };

    await enrichContainerWithReleaseNotes(container, logContainer);

    expect(container.sourceRepo).toBe('github.com/acme/service');
  });

  test('forwards imageLabels to both resolveSourceRepoForContainer and getReleaseNotesForTag', async () => {
    mockResolveSourceRepoForContainer.mockResolvedValue(undefined);
    mockGetReleaseNotesForTag.mockResolvedValue(undefined);

    const imageLabels = { 'org.opencontainers.image.source': 'https://github.com/acme/service' };
    const container = createContainer({ updateAvailable: false });
    const logContainer = { debug: vi.fn() };

    await enrichContainerWithReleaseNotes(container, logContainer, imageLabels);

    expect(mockResolveSourceRepoForContainer).toHaveBeenCalledWith(container, imageLabels);
    expect(mockGetReleaseNotesForTag).toHaveBeenCalledWith(container, '1.0.0', imageLabels);
  });

  test('sets currentReleaseNotes then returns early when result is missing', async () => {
    const currentNotes = makeNotes('1.0.0');
    mockResolveSourceRepoForContainer.mockResolvedValue('github.com/acme/service');
    mockGetReleaseNotesForTag.mockResolvedValue(currentNotes);

    const container = createContainer({ result: undefined });
    const logContainer = { debug: vi.fn() };

    await enrichContainerWithReleaseNotes(container, logContainer);

    expect(container.sourceRepo).toBe('github.com/acme/service');
    expect(container.currentReleaseNotes).toEqual(currentNotes);
    // No result — so result.releaseNotes cannot be set and second call does not happen
    expect(mockGetReleaseNotesForTag).toHaveBeenCalledTimes(1);
  });

  test('returns after current notes when updateAvailable is false and result is present', async () => {
    const currentNotes = makeNotes('1.0.0');
    mockResolveSourceRepoForContainer.mockResolvedValue(undefined);
    mockGetReleaseNotesForTag.mockResolvedValue(currentNotes);

    const container = createContainer({
      result: { tag: '2.0.0' },
      updateAvailable: false,
    });
    const logContainer = { debug: vi.fn() };

    await enrichContainerWithReleaseNotes(container, logContainer);

    expect(container.currentReleaseNotes).toEqual(currentNotes);
    expect(container.result?.releaseNotes).toBeUndefined();
    // Only one call — for currentTag; no second call for newTag
    expect(mockGetReleaseNotesForTag).toHaveBeenCalledTimes(1);
  });

  test('reuses currentNotes for result.releaseNotes when newTag === currentTag without a second getReleaseNotesForTag call', async () => {
    const currentNotes = makeNotes('1.0.0');
    mockResolveSourceRepoForContainer.mockResolvedValue(undefined);
    mockGetReleaseNotesForTag.mockResolvedValue(currentNotes);

    const container = createContainer({
      result: { tag: '1.0.0' },
      updateAvailable: true,
    });
    const logContainer = { debug: vi.fn() };

    await enrichContainerWithReleaseNotes(container, logContainer);

    expect(container.currentReleaseNotes).toEqual(currentNotes);
    expect(container.result?.releaseNotes).toEqual(currentNotes);
    expect(mockGetReleaseNotesForTag).toHaveBeenCalledTimes(1);
  });

  test('makes a second getReleaseNotesForTag call for new tag when updateAvailable and newTag !== currentTag', async () => {
    const currentNotes = makeNotes('1.0.0');
    const newNotes = makeNotes('2.0.0');
    mockResolveSourceRepoForContainer.mockResolvedValue(undefined);
    mockGetReleaseNotesForTag.mockResolvedValueOnce(currentNotes).mockResolvedValueOnce(newNotes);

    const container = createContainer({
      result: { tag: '2.0.0' },
      updateAvailable: true,
    });
    const logContainer = { debug: vi.fn() };

    await enrichContainerWithReleaseNotes(container, logContainer);

    expect(mockGetReleaseNotesForTag).toHaveBeenCalledTimes(2);
    expect(mockGetReleaseNotesForTag).toHaveBeenNthCalledWith(2, container, '2.0.0', undefined);
    expect(container.result?.releaseNotes).toEqual(newNotes);
  });

  test('leaves result.releaseNotes undefined when updateAvailable but new tag returns no notes', async () => {
    mockResolveSourceRepoForContainer.mockResolvedValue(undefined);
    mockGetReleaseNotesForTag.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined);

    const container = createContainer({
      result: { tag: '2.0.0' },
      updateAvailable: true,
    });
    const logContainer = { debug: vi.fn() };

    await enrichContainerWithReleaseNotes(container, logContainer);

    expect(container.result?.releaseNotes).toBeUndefined();
  });

  test('sets both currentReleaseNotes and result.releaseNotes independently when tags differ and both have notes', async () => {
    const currentNotes = makeNotes('1.0.0');
    const newNotes = makeNotes('2.0.0');
    mockResolveSourceRepoForContainer.mockResolvedValue(undefined);
    mockGetReleaseNotesForTag.mockResolvedValueOnce(currentNotes).mockResolvedValueOnce(newNotes);

    const container = createContainer({
      result: { tag: '2.0.0' },
      updateAvailable: true,
    });
    const logContainer = { debug: vi.fn() };

    await enrichContainerWithReleaseNotes(container, logContainer);

    expect(container.currentReleaseNotes).toEqual(currentNotes);
    expect(container.result?.releaseNotes).toEqual(newNotes);
  });

  test('calls logContainer.debug with the error message when any mocked function throws', async () => {
    mockResolveSourceRepoForContainer.mockRejectedValue(new Error('boom'));

    const container = createContainer();
    const logContainer = { debug: vi.fn() };

    await enrichContainerWithReleaseNotes(container, logContainer);

    expect(logContainer.debug).toHaveBeenCalledWith(
      expect.stringContaining('Unable to fetch release notes (boom)'),
    );
  });

  test('when newTag === currentTag but currentNotes is undefined, no copy happens and returns early', async () => {
    mockResolveSourceRepoForContainer.mockResolvedValue(undefined);
    mockGetReleaseNotesForTag.mockResolvedValue(undefined);

    const container = createContainer({
      result: { tag: '1.0.0' },
      updateAvailable: true,
    });
    const logContainer = { debug: vi.fn() };

    await enrichContainerWithReleaseNotes(container, logContainer);

    expect(container.result?.releaseNotes).toBeUndefined();
    // No second call — same-tag path returns early
    expect(mockGetReleaseNotesForTag).toHaveBeenCalledTimes(1);
  });
});
