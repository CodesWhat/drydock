import { validate } from '../../../model/container.js';
import { createContainerFixture } from '../../../test/helpers.js';
import {
  MAX_PENDING_RELEASE_NOTES_LOOKUPS,
  RELEASE_NOTES_ENRICHMENT_BUDGET_MS,
  watchContainer,
} from './container-processing.js';
import { enrichContainerWithReleaseNotes } from './release-notes-enrichment.js';

const storeMocks = vi.hoisted(() => ({
  getContainer: vi.fn(),
  updateContainerFields: vi.fn(),
  getPendingFreshStateAfterManualUpdateAt: vi.fn(),
  clearPendingFreshStateAfterManualUpdate: vi.fn(),
}));

vi.mock('../../../store/container.js', () => storeMocks);
vi.mock('../../../event/index.js', () => ({
  emitContainerReport: vi.fn().mockResolvedValue(undefined),
  emitContainerReports: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../maturity/gate-watch.js', () => ({
  maybeEmitMaturityGateCleared: vi.fn().mockResolvedValue(false),
}));
vi.mock('./release-notes-enrichment.js', () => ({
  enrichContainerWithReleaseNotes: vi.fn(),
}));

const notes = { title: 'v1.4.0', body: 'notes', url: 'https://x', publishedAt: '2026-01-01' };

function deps(isScanStale?: () => boolean) {
  const logger = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
  return {
    logger,
    ensureLogger: vi.fn(),
    log: { child: vi.fn(() => logger) },
    findNewVersion: vi.fn().mockResolvedValue({ tag: '1.4.0' }),
    mapContainerToContainerReport: vi.fn((container) => ({ container, changed: false })),
    isScanStale,
  };
}

function makeContainer() {
  return validate(createContainerFixture({ result: { tag: '1.3.0' } }));
}

// Every lookup still pending at the end of a test is settled so the module-level
// reservation count starts at zero for the next one.
const outstanding: Array<() => void> = [];

function trackedHangingEnrichment() {
  vi.mocked(enrichContainerWithReleaseNotes).mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        outstanding.push(resolve);
      }),
  );
}

function pendingEnrichment() {
  let finish!: (apply?: (draft: any) => void) => void;
  let fail!: (error: Error) => void;
  vi.mocked(enrichContainerWithReleaseNotes).mockImplementationOnce(
    (draft: any) =>
      new Promise<void>((resolve, reject) => {
        finish = (apply) => {
          apply?.(draft);
          resolve();
        };
        outstanding.push(resolve);
        fail = reject;
      }),
  );
  return { finish: (apply?: (draft: any) => void) => finish(apply), fail: (e: Error) => fail(e) };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(async () => {
  outstanding.splice(0).forEach((resolve) => resolve());
  await vi.advanceTimersByTimeAsync(0);
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.mocked(enrichContainerWithReleaseNotes).mockReset();
});

describe('watchContainer release-notes budget', () => {
  test('persists the result without notes once the budget elapses, then attaches notes on recovery', async () => {
    const pending = pendingEnrichment();
    const container = makeContainer();
    const dependencies = deps();
    const watching = watchContainer(container, dependencies);

    await vi.advanceTimersByTimeAsync(RELEASE_NOTES_ENRICHMENT_BUDGET_MS - 1);
    expect(dependencies.mapContainerToContainerReport).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    const report = await watching;

    expect(dependencies.mapContainerToContainerReport).toHaveBeenCalledTimes(1);
    expect(report.container.result?.tag).toBe('1.4.0');
    expect(report.container.result?.releaseNotes).toBeUndefined();

    storeMocks.getContainer.mockReturnValue({
      id: container.id,
      image: container.image,
      result: { tag: '1.4.0' },
    });
    pending.finish((draft) => {
      draft.sourceRepo = 'github.com/o/r';
      draft.currentReleaseNotes = notes;
      draft.result.releaseNotes = notes;
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(storeMocks.updateContainerFields).toHaveBeenCalledWith(container.id, {
      sourceRepo: 'github.com/o/r',
      currentReleaseNotes: notes,
      result: { tag: '1.4.0', releaseNotes: notes },
    });
    expect(report.container.result?.releaseNotes).toBeUndefined();
  });

  test('applies notes in place when enrichment finishes inside the budget', async () => {
    vi.mocked(enrichContainerWithReleaseNotes).mockImplementationOnce(async (draft: any) => {
      draft.sourceRepo = 'github.com/o/r';
      draft.currentReleaseNotes = notes;
      draft.result.releaseNotes = notes;
    });
    const container = makeContainer();
    const report = await watchContainer(container, deps());

    expect(report.container.sourceRepo).toBe('github.com/o/r');
    expect(report.container.currentReleaseNotes).toEqual(notes);
    expect(report.container.result?.releaseNotes).toEqual(notes);
    expect(vi.getTimerCount()).toBe(0);
    expect(storeMocks.updateContainerFields).not.toHaveBeenCalled();
  });

  test('leaves the container untouched when enrichment finds nothing in budget', async () => {
    vi.mocked(enrichContainerWithReleaseNotes).mockResolvedValueOnce(undefined);
    const report = await watchContainer(makeContainer(), deps());
    expect(report.container.sourceRepo).toBeUndefined();
    expect(report.container.currentReleaseNotes).toBeUndefined();
    expect(report.container.result?.releaseNotes).toBeUndefined();
  });

  test('does not hammer the provider: one lookup per watch even when it overruns', async () => {
    pendingEnrichment();
    const watching = watchContainer(makeContainer(), deps());
    await vi.advanceTimersByTimeAsync(RELEASE_NOTES_ENRICHMENT_BUDGET_MS * 20);
    await watching;
    expect(enrichContainerWithReleaseNotes).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['the stored result tag moved on', { result: { tag: '1.5.0' } }],
    ['the container left the store', undefined],
  ])('drops late notes when %s', async (_name, stored) => {
    const pending = pendingEnrichment();
    const container = makeContainer();
    const watching = watchContainer(container, deps());
    await vi.advanceTimersByTimeAsync(RELEASE_NOTES_ENRICHMENT_BUDGET_MS);
    await watching;
    storeMocks.getContainer.mockReturnValue(
      stored && { id: container.id, image: container.image, ...stored },
    );
    pending.finish((draft) => {
      draft.result.releaseNotes = notes;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(storeMocks.updateContainerFields).not.toHaveBeenCalled();
  });

  test('drops late notes when the scan went stale', async () => {
    const pending = pendingEnrichment();
    let stale = false;
    const watching = watchContainer(
      makeContainer(),
      deps(() => stale),
    );
    await vi.advanceTimersByTimeAsync(RELEASE_NOTES_ENRICHMENT_BUDGET_MS);
    await watching;
    stale = true;
    pending.finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(storeMocks.getContainer).not.toHaveBeenCalled();
  });

  test('skips the store write when the late lookup found nothing', async () => {
    const pending = pendingEnrichment();
    const container = makeContainer();
    const watching = watchContainer(container, deps());
    await vi.advanceTimersByTimeAsync(RELEASE_NOTES_ENRICHMENT_BUDGET_MS);
    await watching;
    storeMocks.getContainer.mockReturnValue({
      id: container.id,
      image: container.image,
      result: { tag: '1.4.0' },
    });
    pending.finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(storeMocks.updateContainerFields).not.toHaveBeenCalled();
  });

  test('patches only currentReleaseNotes when there is no result to attach to', async () => {
    const pending = pendingEnrichment();
    const container = makeContainer();
    const watching = watchContainer(container, deps());
    await vi.advanceTimersByTimeAsync(RELEASE_NOTES_ENRICHMENT_BUDGET_MS);
    await watching;
    storeMocks.getContainer.mockReturnValue({
      id: container.id,
      image: container.image,
      result: { tag: '1.4.0' },
    });
    pending.finish((draft) => {
      draft.currentReleaseNotes = notes;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(storeMocks.updateContainerFields).toHaveBeenCalledWith(container.id, {
      currentReleaseNotes: notes,
    });
  });

  test('logs and swallows a late rejection or store failure', async () => {
    const pending = pendingEnrichment();
    const dependencies = deps();
    const watching = watchContainer(makeContainer(), dependencies);
    await vi.advanceTimersByTimeAsync(RELEASE_NOTES_ENRICHMENT_BUDGET_MS);
    await watching;
    pending.fail(new Error('HTTP 403'));
    await vi.advanceTimersByTimeAsync(0);
    expect(dependencies.logger.debug).toHaveBeenCalledWith(
      'Unable to fetch release notes (HTTP 403)',
    );
  });

  test('handles a container with no result', async () => {
    const pending = pendingEnrichment();
    const dependencies = deps();
    dependencies.findNewVersion.mockResolvedValue(undefined);
    const watching = watchContainer(makeContainer(), dependencies);
    await vi.advanceTimersByTimeAsync(RELEASE_NOTES_ENRICHMENT_BUDGET_MS);
    await watching;
    pending.finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(storeMocks.updateContainerFields).not.toHaveBeenCalled();
  });

  test('patches the store through updateContainerFields so the change emits once', async () => {
    const pending = pendingEnrichment();
    const container = makeContainer();
    const watching = watchContainer(container, deps());
    await vi.advanceTimersByTimeAsync(RELEASE_NOTES_ENRICHMENT_BUDGET_MS);
    await watching;
    storeMocks.getContainer.mockReturnValue({
      id: container.id,
      image: container.image,
      result: { tag: '1.4.0' },
    });
    pending.finish((draft) => {
      draft.result.releaseNotes = notes;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(storeMocks.updateContainerFields).toHaveBeenCalledTimes(1);
  });

  test('drops late notes from an older watch once a newer watch of the same container ran', async () => {
    const older = pendingEnrichment();
    const container = makeContainer();
    const watchingOlder = watchContainer(container, deps());
    await vi.advanceTimersByTimeAsync(RELEASE_NOTES_ENRICHMENT_BUDGET_MS);
    await watchingOlder;

    vi.mocked(enrichContainerWithReleaseNotes).mockImplementationOnce(async (draft: any) => {
      draft.result.releaseNotes = { ...notes, body: 'newer' };
    });
    const newer = await watchContainer(container, deps());
    expect(newer.container.result?.releaseNotes?.body).toBe('newer');

    storeMocks.getContainer.mockReturnValue({
      id: container.id,
      image: container.image,
      result: { tag: '1.4.0' },
    });
    older.finish((draft) => {
      draft.result.releaseNotes = { ...notes, body: 'older' };
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(storeMocks.updateContainerFields).not.toHaveBeenCalled();
  });

  test('caps overrun lookups across batches and releases the cap as lookups settle', async () => {
    const settlers: Array<{ finish: () => void; fail: (e: Error) => void }> = [];
    const runBatch = async (size: number) => {
      const batch = Array.from({ length: size }, () => {
        const pending = pendingEnrichment();
        settlers.push(pending);
        return watchContainer(
          validate(
            createContainerFixture({ id: `c-${settlers.length}`, result: { tag: '1.3.0' } }),
          ),
          deps(),
        );
      });
      await vi.advanceTimersByTimeAsync(RELEASE_NOTES_ENRICHMENT_BUDGET_MS);
      await Promise.all(batch);
    };

    await runBatch(10);
    // mockImplementationOnce entries queued by later batches are never consumed while capped.
    vi.mocked(enrichContainerWithReleaseNotes).mockReset();
    vi.mocked(enrichContainerWithReleaseNotes).mockImplementation(() => new Promise(() => {}));
    const second = Array.from({ length: 10 }, (_, index) =>
      watchContainer(validate(createContainerFixture({ id: `d-${index}` })), deps()),
    );
    const third = Array.from({ length: 10 }, (_, index) =>
      watchContainer(validate(createContainerFixture({ id: `e-${index}` })), deps()),
    );
    await vi.advanceTimersByTimeAsync(RELEASE_NOTES_ENRICHMENT_BUDGET_MS);
    await Promise.all([...second, ...third]);
    expect(MAX_PENDING_RELEASE_NOTES_LOOKUPS).toBe(10);
    expect(enrichContainerWithReleaseNotes).not.toHaveBeenCalled();

    // Settle half by success and half by failure: the cap frees up again.
    settlers.slice(0, 5).forEach((s) => s.finish());
    settlers.slice(5).forEach((s) => s.fail(new Error('HTTP 403')));
    await vi.advanceTimersByTimeAsync(0);
    vi.mocked(enrichContainerWithReleaseNotes).mockResolvedValue(undefined);
    await watchContainer(validate(createContainerFixture({ id: 'after' })), deps());
    expect(enrichContainerWithReleaseNotes).toHaveBeenCalledTimes(1);
  });

  test('reserves capacity at admission so concurrent watches cannot overshoot the cap', async () => {
    const settlers: Array<{ finish: () => void; fail: (e: Error) => void }> = [];
    const watchAll = (prefix: string, size: number) =>
      Array.from({ length: size }, (_, index) =>
        watchContainer(validate(createContainerFixture({ id: `${prefix}-${index}` })), deps()),
      );

    // Reserve 9 detached slots.
    const first = Array.from({ length: 9 }, (_, index) => {
      settlers.push(pendingEnrichment());
      return watchContainer(validate(createContainerFixture({ id: `r-${index}` })), deps());
    });
    await vi.advanceTimersByTimeAsync(RELEASE_NOTES_ENRICHMENT_BUDGET_MS);
    await Promise.all(first);

    // Ten watches start in the same tick: only one slot is left.
    vi.mocked(enrichContainerWithReleaseNotes).mockReset();
    trackedHangingEnrichment();
    const burst = watchAll('b', 10);
    await vi.advanceTimersByTimeAsync(RELEASE_NOTES_ENRICHMENT_BUDGET_MS);
    const reports = await Promise.all(burst);
    expect(reports).toHaveLength(10);
    expect(enrichContainerWithReleaseNotes).toHaveBeenCalledTimes(1);

    // Settle everything: 9 by success/failure, the burst's detached lookup never settles,
    // so exactly one slot stays held and 9 of the next 10 are admitted.
    settlers.slice(0, 5).forEach((s) => s.finish());
    settlers.slice(5).forEach((s) => s.fail(new Error('HTTP 403')));
    await vi.advanceTimersByTimeAsync(0);
    vi.mocked(enrichContainerWithReleaseNotes).mockReset();
    vi.mocked(enrichContainerWithReleaseNotes).mockResolvedValue(undefined);
    await Promise.all(watchAll('after', 10));
    expect(enrichContainerWithReleaseNotes).toHaveBeenCalledTimes(9);
  });

  test('in-budget completions and failures release their slot', async () => {
    vi.mocked(enrichContainerWithReleaseNotes).mockResolvedValue(undefined);
    for (let round = 0; round < 3; round += 1) {
      await Promise.all(
        Array.from({ length: 10 }, (_, index) =>
          watchContainer(validate(createContainerFixture({ id: `ok-${round}-${index}` })), deps()),
        ),
      );
    }
    expect(enrichContainerWithReleaseNotes).toHaveBeenCalledTimes(30);

    vi.mocked(enrichContainerWithReleaseNotes).mockRejectedValue(new Error('boom'));
    for (let round = 0; round < 3; round += 1) {
      await Promise.all(
        Array.from({ length: 10 }, (_, index) =>
          watchContainer(validate(createContainerFixture({ id: `bad-${round}-${index}` })), deps()),
        ),
      );
    }
    expect(enrichContainerWithReleaseNotes).toHaveBeenCalledTimes(60);
  });
});
