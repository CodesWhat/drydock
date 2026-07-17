import { createContainerFixture } from '../../../test/helpers.js';
import { watchContainer } from './container-processing.js';

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
    const container = createContainerFixture({
      result: originalResult,
      updateAvailable: true,
      updateKind: originalUpdateKind,
      currentReleaseNotes: originalCurrentReleaseNotes,
    });
    const dependencies = createDependencies(vi.fn().mockRejectedValue(new Error('ETIMEDOUT')));

    const report = await watchContainer(container as any, dependencies);

    expect(report.container.error?.message).toBe('ETIMEDOUT');
    expect(report.container.result).toEqual(originalResult);
    expect(report.container.updateAvailable).toBe(true);
    expect(report.container.updateKind).toEqual(originalUpdateKind);
    expect(report.container.currentReleaseNotes).toEqual(originalCurrentReleaseNotes);
  });

  // Behavior pin: a successful cycle replaces stale data and clears the old error.
  test('clears a stale error and replaces the result after a successful watch', async () => {
    const container = createContainerFixture({
      error: { message: 'old error' },
      result: { tag: 'old-good-tag' },
      updateAvailable: true,
      updateKind: { kind: 'tag' },
    });
    const dependencies = createDependencies(vi.fn().mockResolvedValue({ tag: 'new-tag' }));

    const report = await watchContainer(container as any, dependencies);

    expect(report.container.error).toBeUndefined();
    expect(report.container.result?.tag).toBe('new-tag');
  });

  // Behavior pin: the fix must only restore a result when a previous result existed.
  test('handles a first failing cycle without creating a result', async () => {
    const originalUpdateKind = { kind: 'unknown' as const };
    const container = createContainerFixture({
      result: undefined,
      updateAvailable: false,
      updateKind: originalUpdateKind,
    });
    const dependencies = createDependencies(vi.fn().mockRejectedValue(new Error('ETIMEDOUT')));

    const report = await watchContainer(container as any, dependencies);

    expect(report.container.result).toBeUndefined();
    expect(report.container.updateAvailable).toBe(false);
    expect(report.container.updateKind).toEqual(originalUpdateKind);
    expect(report.container.error?.message).toBe('ETIMEDOUT');
  });
});
