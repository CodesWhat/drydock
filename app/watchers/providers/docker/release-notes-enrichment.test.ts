import type { Container } from '../../../model/container.js';
import { enrichContainerWithReleaseNotes } from './release-notes-enrichment.js';

const mockResolveSourceRepoForContainer = vi.hoisted(() => vi.fn());
const mockGetFullReleaseNotesForContainer = vi.hoisted(() => vi.fn());
const mockToContainerReleaseNotes = vi.hoisted(() => vi.fn((notes) => notes));

vi.mock('../../../release-notes/index.js', () => ({
  resolveSourceRepoForContainer: (...args: unknown[]) =>
    mockResolveSourceRepoForContainer(...args),
  getFullReleaseNotesForContainer: (...args: unknown[]) =>
    mockGetFullReleaseNotesForContainer(...args),
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

describe('release-notes-enrichment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('sets source repo and returns early when result is missing', async () => {
    mockResolveSourceRepoForContainer.mockResolvedValue('github.com/drydock/example');
    const container = createContainer({ result: undefined });
    const logContainer = { debug: vi.fn() };

    await enrichContainerWithReleaseNotes(container, logContainer);

    expect(container.sourceRepo).toBe('github.com/drydock/example');
    expect(mockGetFullReleaseNotesForContainer).not.toHaveBeenCalled();
    expect(mockToContainerReleaseNotes).not.toHaveBeenCalled();
  });

  test('returns early when update is not available', async () => {
    mockResolveSourceRepoForContainer.mockResolvedValue(undefined);
    const container = createContainer({
      result: { tag: '1.2.3' },
      updateAvailable: false,
    });
    const logContainer = { debug: vi.fn() };

    await enrichContainerWithReleaseNotes(container, logContainer);

    expect(mockGetFullReleaseNotesForContainer).not.toHaveBeenCalled();
    expect(mockToContainerReleaseNotes).not.toHaveBeenCalled();
  });

  test('returns when release notes are not available', async () => {
    mockResolveSourceRepoForContainer.mockResolvedValue(undefined);
    mockGetFullReleaseNotesForContainer.mockResolvedValue(undefined);
    const container = createContainer({
      result: { tag: '1.2.3' },
      updateAvailable: true,
    });
    const logContainer = { debug: vi.fn() };

    await enrichContainerWithReleaseNotes(container, logContainer);

    expect(mockGetFullReleaseNotesForContainer).toHaveBeenCalledWith(container);
    expect(mockToContainerReleaseNotes).not.toHaveBeenCalled();
  });

  test('attaches mapped release notes when available', async () => {
    const fullReleaseNotes = {
      title: 'v1.2.3',
      body: 'Full body',
      url: 'https://github.com/drydock/example/releases/tag/v1.2.3',
      publishedAt: new Date().toISOString(),
      provider: 'github',
    } as const;
    const mappedReleaseNotes = {
      ...fullReleaseNotes,
      body: 'Truncated body',
    };

    mockResolveSourceRepoForContainer.mockResolvedValue(undefined);
    mockGetFullReleaseNotesForContainer.mockResolvedValue(fullReleaseNotes);
    mockToContainerReleaseNotes.mockReturnValue(mappedReleaseNotes);

    const container = createContainer({
      result: { tag: '1.2.3' },
      updateAvailable: true,
    });
    const logContainer = { debug: vi.fn() };

    await enrichContainerWithReleaseNotes(container, logContainer);

    expect(mockToContainerReleaseNotes).toHaveBeenCalledWith(fullReleaseNotes);
    expect(container.result?.releaseNotes).toEqual(mappedReleaseNotes);
  });

  test('logs debug when enrichment throws', async () => {
    mockResolveSourceRepoForContainer.mockRejectedValue(new Error('boom'));
    const container = createContainer();
    const logContainer = { debug: vi.fn() };

    await enrichContainerWithReleaseNotes(container, logContainer);

    expect(logContainer.debug).toHaveBeenCalledWith(
      expect.stringContaining('Unable to fetch release notes (boom)'),
    );
  });
});
