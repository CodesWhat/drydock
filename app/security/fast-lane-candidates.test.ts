const mocks = vi.hoisted(() => ({
  getContainersRaw: vi.fn(),
  getContainerRaw: vi.fn(),
  updateContainer: vi.fn(),
  cloneContainer: vi.fn((c: unknown) => c),
  scanImageForVulnerabilities: vi.fn(),
  resolveImage: vi.fn(() => 'repo/app:2.0.0'),
  resolveAuth: vi.fn(async () => ({ auth: true })),
  getState: vi.fn(() => ({ registry: {} })),
  warn: vi.fn(),
}));

vi.mock('../log/index.js', () => ({
  default: { child: () => ({ info: vi.fn(), warn: mocks.warn, debug: vi.fn(), error: vi.fn() }) },
}));
vi.mock('../store/container.js', () => ({
  getContainersRaw: mocks.getContainersRaw,
  getContainerRaw: mocks.getContainerRaw,
  updateContainer: mocks.updateContainer,
  cloneContainer: mocks.cloneContainer,
}));
vi.mock('../registry/index.js', () => ({ getState: mocks.getState }));
vi.mock('../api/container/shared.js', () => ({
  resolveContainerImageFullName: mocks.resolveImage,
  resolveContainerRegistryAuth: mocks.resolveAuth,
}));
vi.mock('./scan.js', () => ({
  scanImageForVulnerabilities: mocks.scanImageForVulnerabilities,
}));

import {
  resetFastLaneCandidateAttempts,
  scanFastLaneCandidates,
  selectFastLaneCandidates,
} from './fast-lane-candidates.js';

const RUN = `sha256:${'a'.repeat(64)}`;
const NEW = `sha256:${'b'.repeat(64)}`;
const OLD = `sha256:${'c'.repeat(64)}`;
const OTHER = `sha256:${'d'.repeat(64)}`;

const passedScan = {
  scanner: 'trivy',
  status: 'passed',
  image: `repo/app@${NEW}`,
  scannedAt: '2026-01-02T00:00:00.000Z',
  vulnerabilities: [],
  severityIds: { critical: [], high: [] },
};

const runningScan = {
  scanner: 'trivy',
  status: 'blocked',
  image: `repo/app@${RUN}`,
  imageDigest: RUN,
  scannedAt: '2026-01-01T00:00:00.000Z',
  vulnerabilities: [],
  severityIds: { critical: ['CVE-1'], high: [] },
};

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    labels: { 'dd.security.fastlane': 'true' },
    image: { tag: { value: '1.0.0' }, digest: { watch: false, value: RUN } },
    result: { tag: '2.0.0', digest: NEW },
    security: { scan: runningScan },
    ...overrides,
  } as never;
}

const options = () => ({ signal: new AbortController().signal, scanConcurrency: 2 });

describe('fast lane candidate scanning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetFastLaneCandidateAttempts();
    mocks.scanImageForVulnerabilities.mockResolvedValue(passedScan);
    mocks.getContainerRaw.mockImplementation(() => candidate());
  });

  describe('selectFastLaneCandidates', () => {
    test('keeps an opted-in container with an unscanned pending candidate digest', () => {
      expect(selectFastLaneCandidates([candidate()])).toHaveLength(1);
    });

    test('skips containers that are not opted in or have no pending update', () => {
      expect(selectFastLaneCandidates([candidate({ labels: {} })])).toHaveLength(0);
      expect(selectFastLaneCandidates([candidate({ result: undefined })])).toHaveLength(0);
    });

    test('skips a candidate without a digest, because only a digest can be scanned exactly', () => {
      expect(selectFastLaneCandidates([candidate({ result: { tag: '2.0.0' } })])).toHaveLength(0);
    });

    test('skips containers without trustworthy running evidence', () => {
      expect(selectFastLaneCandidates([candidate({ security: undefined })])).toHaveLength(0);
      expect(
        selectFastLaneCandidates([
          candidate({ security: { scan: { ...runningScan, status: 'error' } } }),
        ]),
      ).toHaveLength(0);
      expect(
        selectFastLaneCandidates([
          candidate({ security: { scan: { ...runningScan, imageDigest: OLD } } }),
        ]),
      ).toHaveLength(0);
    });

    test('skips a candidate whose scan is already comparable', () => {
      const scanned = candidate({
        security: { scan: runningScan, updateScan: { ...passedScan, imageDigest: NEW } },
      });
      expect(selectFastLaneCandidates([scanned])).toHaveLength(0);
    });

    test('rescans a candidate scan of another digest or older than the running scan', () => {
      const otherDigest = candidate({
        security: { scan: runningScan, updateScan: { ...passedScan, imageDigest: OLD } },
      });
      const olderThanRunning = candidate({
        security: {
          scan: { ...runningScan, scannedAt: '2026-01-03T00:00:00.000Z' },
          updateScan: { ...passedScan, imageDigest: NEW },
        },
      });
      expect(selectFastLaneCandidates([otherDigest, olderThanRunning])).toHaveLength(2);
    });
  });

  describe('scanFastLaneCandidates', () => {
    test('returns without scanning when nothing qualifies', async () => {
      mocks.getContainersRaw.mockReturnValue([candidate({ labels: {} })]);
      expect(await scanFastLaneCandidates(options())).toBe(0);
      expect(mocks.scanImageForVulnerabilities).not.toHaveBeenCalled();
    });

    test('scans the candidate pinned by digest, never by tag, and stamps that digest', async () => {
      mocks.getContainersRaw.mockReturnValue([candidate()]);
      expect(await scanFastLaneCandidates(options())).toBe(1);
      expect(mocks.resolveImage).toHaveBeenCalledWith(expect.anything(), {}, NEW);
      expect(mocks.scanImageForVulnerabilities).toHaveBeenCalledWith(
        expect.objectContaining({ image: 'repo/app:2.0.0' }),
      );
      expect(mocks.updateContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          security: expect.objectContaining({
            updateScan: { ...passedScan, imageDigest: NEW },
          }),
        }),
      );
    });

    test('falls back to an empty registry state and keeps the existing security state', async () => {
      mocks.getState.mockReturnValueOnce({});
      mocks.getContainersRaw.mockReturnValue([candidate()]);
      expect(await scanFastLaneCandidates(options())).toBe(1);
      const stored = mocks.updateContainer.mock.calls[0][0];
      expect(stored.security.scan).toStrictEqual(runningScan);
    });

    test('writes the result onto a record that carries no security state yet', async () => {
      mocks.getContainersRaw.mockReturnValue([candidate()]);
      mocks.getContainerRaw.mockReturnValue(candidate({ security: undefined }));
      expect(await scanFastLaneCandidates(options())).toBe(1);
      expect(mocks.updateContainer.mock.calls[0][0].security).toStrictEqual({
        updateScan: { ...passedScan, imageDigest: NEW },
      });
    });

    test('attempts each candidate once per running scan, even after a failure', async () => {
      mocks.getContainersRaw.mockReturnValue([candidate()]);
      mocks.scanImageForVulnerabilities.mockRejectedValueOnce(new Error('registry down'));
      expect(await scanFastLaneCandidates(options())).toBe(0);
      expect(mocks.warn).toHaveBeenCalledWith(expect.stringContaining('registry down'));
      expect(await scanFastLaneCandidates(options())).toBe(0);
      expect(mocks.scanImageForVulnerabilities).toHaveBeenCalledTimes(1);
    });

    test('retries once a newer running scan makes the candidate scan stale', async () => {
      mocks.getContainersRaw.mockReturnValue([candidate()]);
      expect(await scanFastLaneCandidates(options())).toBe(1);
      mocks.getContainersRaw.mockReturnValue([
        candidate({
          security: { scan: { ...runningScan, scannedAt: '2026-01-05T00:00:00.000Z' } },
        }),
      ]);
      mocks.scanImageForVulnerabilities.mockResolvedValue({
        ...passedScan,
        scannedAt: '2026-01-06T00:00:00.000Z',
      });
      expect(await scanFastLaneCandidates(options())).toBe(1);
      expect(mocks.scanImageForVulnerabilities).toHaveBeenCalledTimes(2);
    });

    test('containers pending the same candidate digest share one scan', async () => {
      mocks.getContainersRaw.mockReturnValue([
        candidate({ id: 'a' }),
        candidate({ id: 'b' }),
        candidate({ id: 'c' }),
      ]);
      expect(await scanFastLaneCandidates(options())).toBe(3);
      expect(mocks.scanImageForVulnerabilities).toHaveBeenCalledTimes(1);
      expect(mocks.updateContainer).toHaveBeenCalledTimes(3);
    });

    test('reuses a remembered scan in a later batch only for containers it is comparable with', async () => {
      mocks.getContainersRaw.mockReturnValue([candidate({ id: 'a' })]);
      await scanFastLaneCandidates(options());
      // A replica whose running scan is not newer takes the remembered scan without scanning.
      mocks.getContainersRaw.mockReturnValue([candidate({ id: 'b' })]);
      expect(await scanFastLaneCandidates(options())).toBe(1);
      expect(mocks.scanImageForVulnerabilities).toHaveBeenCalledTimes(1);
      // A container whose running scan is newer than the remembered one forces a fresh scan.
      mocks.getContainersRaw.mockReturnValue([
        candidate({
          id: 'c',
          security: { scan: { ...runningScan, scannedAt: '2026-02-01T00:00:00.000Z' } },
        }),
      ]);
      mocks.scanImageForVulnerabilities.mockResolvedValue({
        ...passedScan,
        scannedAt: '2026-02-02T00:00:00.000Z',
      });
      expect(await scanFastLaneCandidates(options())).toBe(1);
      expect(mocks.scanImageForVulnerabilities).toHaveBeenCalledTimes(2);
    });

    test('a failed shared scan is attempted once and stores nothing for any replica', async () => {
      mocks.getContainersRaw.mockReturnValue([candidate({ id: 'a' }), candidate({ id: 'b' })]);
      mocks.scanImageForVulnerabilities.mockRejectedValueOnce(new Error('registry down'));
      expect(await scanFastLaneCandidates(options())).toBe(0);
      expect(await scanFastLaneCandidates(options())).toBe(0);
      expect(mocks.scanImageForVulnerabilities).toHaveBeenCalledTimes(1);
    });

    test('a replica whose candidate moved is skipped while the others still get the scan', async () => {
      mocks.getContainersRaw.mockReturnValue([candidate({ id: 'a' }), candidate({ id: 'b' })]);
      mocks.getContainerRaw.mockImplementation((id: string) =>
        id === 'a'
          ? candidate({ id: 'a', result: { tag: '3', digest: OTHER } })
          : candidate({ id: 'b' }),
      );
      expect(await scanFastLaneCandidates(options())).toBe(1);
    });

    test('never scans a candidate whose digest is not an immutable sha256 digest', async () => {
      mocks.getContainersRaw.mockReturnValue([
        candidate({ result: { tag: '2.0.0', digest: '2.0.0' } }),
      ]);
      expect(await scanFastLaneCandidates(options())).toBe(0);
      expect(mocks.scanImageForVulnerabilities).not.toHaveBeenCalled();
    });

    test('an errored scan is not stored', async () => {
      mocks.getContainersRaw.mockReturnValue([candidate()]);
      mocks.scanImageForVulnerabilities.mockResolvedValue({ ...passedScan, status: 'error' });
      expect(await scanFastLaneCandidates(options())).toBe(0);
      expect(mocks.updateContainer).not.toHaveBeenCalled();
    });

    test('drops the result when the container vanished or the candidate moved mid-scan', async () => {
      mocks.getContainersRaw.mockReturnValue([candidate()]);
      mocks.getContainerRaw.mockReturnValueOnce(undefined);
      expect(await scanFastLaneCandidates(options())).toBe(0);
      resetFastLaneCandidateAttempts();
      mocks.getContainerRaw.mockReturnValueOnce(
        candidate({ result: { tag: '2.0.0', digest: OTHER } }),
      );
      expect(await scanFastLaneCandidates(options())).toBe(0);
      expect(mocks.updateContainer).not.toHaveBeenCalled();
    });

    test('works through the queue with a bounded number of workers', async () => {
      const digestOf = (c: string) => `sha256:${c.repeat(64)}`;
      mocks.getContainersRaw.mockReturnValue(
        ['1', '2', '3'].map((c) =>
          candidate({ id: `id-${c}`, result: { tag: '2.0.0', digest: digestOf(c) } }),
        ),
      );
      mocks.getContainerRaw.mockImplementation((id: string) =>
        candidate({ id, result: { tag: '2.0.0', digest: digestOf(id.slice(-1)) } }),
      );
      expect(await scanFastLaneCandidates({ ...options(), scanConcurrency: 1 })).toBe(3);
      expect(mocks.scanImageForVulnerabilities).toHaveBeenCalledTimes(3);
    });

    test('forgets the oldest remembered scan once the cache is full', async () => {
      const digestOf = (i: number) => `sha256:${i.toString(16).padStart(64, '0')}`;
      const total = 201;
      mocks.getContainersRaw.mockReturnValue(
        Array.from({ length: total }, (_, i) =>
          candidate({ id: `id-${i}`, result: { tag: '2.0.0', digest: digestOf(i) } }),
        ),
      );
      mocks.getContainerRaw.mockImplementation((id: string) =>
        candidate({ id, result: { tag: '2.0.0', digest: digestOf(Number(id.slice(3))) } }),
      );
      const storedCount = await scanFastLaneCandidates({ ...options(), scanConcurrency: 8 });
      expect(storedCount).toBe(total);

      // The first digest was evicted, so a new container pending it scans again; the last was kept.
      mocks.scanImageForVulnerabilities.mockClear();
      mocks.getContainersRaw.mockReturnValue([
        candidate({ id: 'fresh-0', result: { tag: '2.0.0', digest: digestOf(0) } }),
        candidate({ id: 'fresh-1', result: { tag: '2.0.0', digest: digestOf(total - 1) } }),
      ]);
      mocks.getContainerRaw.mockImplementation((id: string) =>
        candidate({
          id,
          result: { tag: '2.0.0', digest: digestOf(id === 'fresh-0' ? 0 : total - 1) },
        }),
      );
      await scanFastLaneCandidates({ ...options(), scanConcurrency: 8 });
      expect(mocks.scanImageForVulnerabilities).toHaveBeenCalledTimes(1);
    });

    test('stops taking work once aborted', async () => {
      const controller = new AbortController();
      controller.abort();
      mocks.getContainersRaw.mockReturnValue([candidate()]);
      expect(await scanFastLaneCandidates({ ...options(), signal: controller.signal })).toBe(0);
      expect(mocks.scanImageForVulnerabilities).not.toHaveBeenCalled();
    });
  });
});
