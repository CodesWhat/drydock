import { validate } from '../../../model/container.js';
import { createContainerFixture } from '../../../test/helpers.js';
import { watchContainer } from './container-processing.js';
import { enrichContainerWithReleaseNotes } from './release-notes-enrichment.js';

const eventMocks = vi.hoisted(() => ({
  emitContainerReport: vi.fn().mockResolvedValue(undefined),
  emitContainerReports: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../event/index.js', () => eventMocks);

vi.mock('./release-notes-enrichment.js', () => ({
  enrichContainerWithReleaseNotes: vi.fn().mockResolvedValue(undefined),
}));

function createDependencies(findNewVersion: ReturnType<typeof vi.fn>) {
  return {
    ensureLogger: vi.fn(),
    log: {
      child: vi.fn(() => ({
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      })),
    },
    findNewVersion,
    mapContainerToContainerReport: vi.fn((container) => ({
      container,
      changed: false,
    })),
  };
}

function createValidatedContainer(overrides: Record<string, unknown> = {}) {
  return validate(
    createContainerFixture({
      image: {
        id: 'image-123456789',
        registry: {
          name: 'registry',
          url: 'https://hub',
        },
        name: 'organization/image',
        tag: {
          value: '1.3.0',
          semver: true,
        },
        digest: {
          watch: false,
        },
        architecture: 'amd64',
        os: 'linux',
      },
      ...overrides,
    }),
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('watchContainer error result preservation', () => {
  test('preserves the previous result and detected update state across an error write', async () => {
    const originalResult = { tag: '1.4.0', digest: 'sha256:abc' };
    const originalUpdateKind = {
      kind: 'tag' as const,
      localValue: '1.3.0',
      remoteValue: '1.4.0',
      semverDiff: 'minor' as const,
    };
    const originalCurrentReleaseNotes = {
      title: 'Version 1.3.0',
      body: 'Previously fetched release notes',
      url: 'https://example.com/releases/1.3.0',
      publishedAt: '2026-01-01T00:00:00.000Z',
      provider: 'github' as const,
    };
    const container = createValidatedContainer({
      result: originalResult,
      currentReleaseNotes: originalCurrentReleaseNotes,
    });
    const dependencies = createDependencies(vi.fn().mockRejectedValue(new Error('ETIMEDOUT')));

    const report = await watchContainer(container, dependencies);

    expect(report.container.error?.message).toBe('ETIMEDOUT');
    expect(report.container.result).toEqual(originalResult);
    expect(report.container.updateAvailable).toBe(true);
    expect(report.container.updateKind).toEqual(originalUpdateKind);
    expect(report.container.currentReleaseNotes).toEqual(originalCurrentReleaseNotes);
    // The E2E symptom was the report never persisting (the TypeError escaped
    // before the emit) — pin that the persistence path actually ran.
    expect(eventMocks.emitContainerReport).toHaveBeenCalledTimes(1);
    expect(eventMocks.emitContainerReport).toHaveBeenCalledWith(report);
  });

  test('restores the previous result on a validated container without writing to getter-only properties', async () => {
    const previousResult = { tag: '1.4.0' };
    const previousCurrentReleaseNotes = {
      title: 'Version 1.2.0',
      body: 'Previously fetched release notes',
      url: 'https://example.com/releases/1.2.0',
      publishedAt: '2026-01-01T00:00:00.000Z',
      provider: 'github' as const,
    };
    const container = createValidatedContainer({
      image: {
        id: 'image-123456789',
        registry: {
          name: 'registry',
          url: 'https://hub',
        },
        name: 'organization/image',
        tag: {
          value: '1.2.0',
          semver: true,
        },
        digest: {
          watch: false,
        },
        architecture: 'amd64',
        os: 'linux',
      },
      result: previousResult,
      currentReleaseNotes: previousCurrentReleaseNotes,
    });
    const dependencies = createDependencies(
      vi.fn().mockRejectedValue(new Error('registry timeout')),
    );

    const report = await watchContainer(container, dependencies);

    expect(report.container.error?.message).toBe('registry timeout');
    expect(report.container.result).toEqual(previousResult);
    expect(report.container.currentReleaseNotes).toEqual(previousCurrentReleaseNotes);
    expect(report.container.updateAvailable).toBe(true);
  });

  // Behavior pin: a successful cycle replaces stale data and clears the old error.
  test('clears a stale error and replaces the result after a successful watch', async () => {
    const container = createValidatedContainer({
      error: { message: 'old error' },
      result: { tag: '1.3.0' },
    });
    const dependencies = createDependencies(vi.fn().mockResolvedValue({ tag: '1.4.0' }));

    const report = await watchContainer(container, dependencies);

    expect(report.container.error).toBeUndefined();
    expect(report.container.result?.tag).toBe('1.4.0');
  });

  // Behavior pin: the fix must only restore a result when a previous result existed.
  test('handles a first failing cycle without creating a result', async () => {
    const originalUpdateKind = {
      kind: 'unknown' as const,
      localValue: undefined,
      remoteValue: undefined,
      semverDiff: 'unknown' as const,
    };
    const container = createValidatedContainer({
      result: undefined,
    });
    const dependencies = createDependencies(vi.fn().mockRejectedValue(new Error('ETIMEDOUT')));

    const report = await watchContainer(container, dependencies);

    expect(report.container.result).toBeUndefined();
    expect(report.container.updateAvailable).toBe(false);
    expect(report.container.updateKind).toEqual(originalUpdateKind);
    expect(report.container.error?.message).toBe('ETIMEDOUT');
  });

  test('keeps a fresh comparison when only release-notes enrichment fails', async () => {
    const container = createValidatedContainer({
      result: { tag: '1.3.0' },
    });
    const dependencies = createDependencies(vi.fn().mockResolvedValue({ tag: '1.4.0' }));
    vi.mocked(enrichContainerWithReleaseNotes).mockRejectedValueOnce(
      new Error('notes fetch failed'),
    );

    const report = await watchContainer(container, dependencies);

    expect(report.container.result?.tag).toBe('1.4.0');
    expect(report.container.error?.message).toBe('notes fetch failed');
  });
});
