const mocks = vi.hoisted(() => ({
  getContainersRaw: vi.fn(),
  getContainerRaw: vi.fn(),
  updateContainer: vi.fn(),
  cloneContainer: vi.fn((c: unknown) => c),
  scanImageWithDedup: vi.fn(),
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
  scanImageWithDedup: mocks.scanImageWithDedup,
  scanImageForVulnerabilities: mocks.scanImageForVulnerabilities,
}));

import {
  resetFastLaneCandidateAttempts,
  scanFastLaneCandidates,
  selectFastLaneCandidates,
} from './fast-lane-candidates.js';

const passedScan = { status: 'passed', image: 'repo/app:2.0.0', vulnerabilities: [] };

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    labels: { 'dd.security.fastlane': 'true' },
    image: { tag: { value: '1.0.0' }, digest: { watch: false } },
    result: { tag: '2.0.0', digest: 'sha256:new' },
    security: { scan: { status: 'blocked', vulnerabilities: [] } },
    ...overrides,
  } as never;
}

const options = () => ({
  signal: new AbortController().signal,
  scanConcurrency: 2,
  scanIntervalMs: 1000,
  trivyDbUpdatedAt: 'db',
});

describe('fast lane candidate scanning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetFastLaneCandidateAttempts();
    mocks.scanImageWithDedup.mockResolvedValue({ scanResult: passedScan, fromCache: false });
    mocks.scanImageForVulnerabilities.mockResolvedValue(passedScan);
    mocks.getContainerRaw.mockImplementation(() => candidate());
  });

  describe('selectFastLaneCandidates', () => {
    test('keeps an opted-in container with an unscanned pending candidate', () => {
      expect(selectFastLaneCandidates([candidate()])).toHaveLength(1);
    });

    test('skips containers that are not opted in, have no pending update or no baseline', () => {
      expect(selectFastLaneCandidates([candidate({ labels: {} })])).toHaveLength(0);
      expect(selectFastLaneCandidates([candidate({ result: undefined })])).toHaveLength(0);
      expect(
        selectFastLaneCandidates([candidate({ result: { digest: 'sha256:new' } })]),
      ).toHaveLength(0);
      expect(selectFastLaneCandidates([candidate({ security: undefined })])).toHaveLength(0);
      expect(
        selectFastLaneCandidates([candidate({ security: { scan: { status: 'error' } } })]),
      ).toHaveLength(0);
    });

    test('skips a candidate that already has a matching scan but not a stale one', () => {
      const matching = candidate({
        security: {
          scan: { status: 'blocked' },
          updateScan: { image: 'repo/app:2.0.0', imageDigest: 'sha256:new', status: 'passed' },
        },
      });
      expect(selectFastLaneCandidates([matching])).toHaveLength(0);
      const stale = candidate({
        security: {
          scan: { status: 'blocked' },
          updateScan: { image: 'repo/app:1.5.0', imageDigest: 'sha256:old', status: 'passed' },
        },
      });
      expect(selectFastLaneCandidates([stale])).toHaveLength(1);
    });
  });

  describe('scanFastLaneCandidates', () => {
    test('returns without scanning when nothing qualifies', async () => {
      mocks.getContainersRaw.mockReturnValue([candidate({ labels: {} })]);
      expect(await scanFastLaneCandidates(options())).toBe(0);
      expect(mocks.scanImageWithDedup).not.toHaveBeenCalled();
    });

    test('scans a digest candidate through the shared digest cache and stamps the digest', async () => {
      mocks.getContainersRaw.mockReturnValue([candidate()]);
      expect(await scanFastLaneCandidates(options())).toBe(1);
      expect(mocks.resolveImage).toHaveBeenCalledWith(expect.anything(), {}, '2.0.0');
      expect(mocks.scanImageWithDedup).toHaveBeenCalledWith(
        expect.objectContaining({
          image: 'repo/app:2.0.0',
          digest: 'sha256:new',
          trivyDbUpdatedAt: 'db',
        }),
        1000,
      );
      expect(mocks.updateContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          security: expect.objectContaining({
            updateScan: { ...passedScan, imageDigest: 'sha256:new' },
          }),
        }),
      );
    });

    test('scans a tag-only candidate directly and keeps the existing security state', async () => {
      mocks.getState.mockReturnValueOnce({});
      const tagOnly = candidate({ result: { tag: '2.0.0' }, security: undefined });
      tagOnly.security = { scan: { status: 'blocked', vulnerabilities: [] } };
      mocks.getContainersRaw.mockReturnValue([tagOnly]);
      mocks.getContainerRaw.mockReturnValue(tagOnly);
      expect(await scanFastLaneCandidates(options())).toBe(1);
      expect(mocks.scanImageWithDedup).not.toHaveBeenCalled();
      const stored = mocks.updateContainer.mock.calls[0][0];
      expect(stored.security.updateScan).toStrictEqual(passedScan);
      expect(stored.security.scan).toStrictEqual({ status: 'blocked', vulnerabilities: [] });
    });

    test('writes the result onto a record that carries no security state yet', async () => {
      mocks.getContainersRaw.mockReturnValue([candidate()]);
      mocks.getContainerRaw.mockReturnValue(candidate({ security: undefined }));
      expect(await scanFastLaneCandidates(options())).toBe(1);
      expect(mocks.updateContainer.mock.calls[0][0].security).toStrictEqual({
        updateScan: { ...passedScan, imageDigest: 'sha256:new' },
      });
    });

    test('attempts each candidate once, even after a failure', async () => {
      mocks.getContainersRaw.mockReturnValue([candidate()]);
      mocks.scanImageWithDedup.mockRejectedValueOnce(new Error('registry down'));
      expect(await scanFastLaneCandidates(options())).toBe(0);
      expect(mocks.warn).toHaveBeenCalledWith(expect.stringContaining('registry down'));
      expect(await scanFastLaneCandidates(options())).toBe(0);
      expect(mocks.scanImageWithDedup).toHaveBeenCalledTimes(1);
    });

    test('an errored scan is not stored', async () => {
      mocks.getContainersRaw.mockReturnValue([candidate()]);
      mocks.scanImageWithDedup.mockResolvedValue({
        scanResult: { ...passedScan, status: 'error' },
        fromCache: false,
      });
      expect(await scanFastLaneCandidates(options())).toBe(0);
      expect(mocks.updateContainer).not.toHaveBeenCalled();
    });

    test('drops the result when the container vanished or the candidate moved mid-scan', async () => {
      mocks.getContainersRaw.mockReturnValue([candidate()]);
      mocks.getContainerRaw.mockReturnValueOnce(undefined);
      expect(await scanFastLaneCandidates(options())).toBe(0);
      resetFastLaneCandidateAttempts();
      mocks.getContainerRaw.mockReturnValueOnce(candidate({ result: { tag: '3.0.0' } }));
      expect(await scanFastLaneCandidates(options())).toBe(0);
      expect(mocks.updateContainer).not.toHaveBeenCalled();
    });

    test('works through the queue with a bounded number of workers', async () => {
      mocks.getContainersRaw.mockReturnValue([
        candidate({ id: 'a' }),
        candidate({ id: 'b' }),
        candidate({ id: 'c' }),
      ]);
      expect(await scanFastLaneCandidates({ ...options(), scanConcurrency: 1 })).toBe(3);
      expect(mocks.scanImageWithDedup).toHaveBeenCalledTimes(3);
    });

    test('stops taking work once aborted', async () => {
      const controller = new AbortController();
      controller.abort();
      mocks.getContainersRaw.mockReturnValue([candidate()]);
      expect(await scanFastLaneCandidates({ ...options(), signal: controller.signal })).toBe(0);
      expect(mocks.scanImageWithDedup).not.toHaveBeenCalled();
    });
  });
});
