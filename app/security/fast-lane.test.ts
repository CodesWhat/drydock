import type { Container } from '../model/container.js';
import {
  evaluateSecurityFastLane,
  isSecurityFastLaneEnabled,
  needsFastLaneCandidateScan,
  SECURITY_FAST_LANE_ENV,
  SECURITY_FAST_LANE_ID_CAP,
  SECURITY_FAST_LANE_LABEL,
  updateScanMatchesCandidate,
} from './fast-lane.js';

const RUN = `sha256:${'a'.repeat(64)}`;
const NEW = `sha256:${'b'.repeat(64)}`;
const OLD = `sha256:${'c'.repeat(64)}`;
const OTHER = `sha256:${'d'.repeat(64)}`;

type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
type Scan = NonNullable<Container['security']>['scan'];

function ids(vulns: Array<[string, Severity]>, severity: Severity) {
  return [...new Set(vulns.filter(([, s]) => s === severity).map(([id]) => id))].sort();
}

function scan(vulns: Array<[string, Severity]>, overrides: Record<string, unknown> = {}): Scan {
  return {
    scanner: 'trivy',
    image: `repo/app@${RUN}`,
    scannedRef: `repo/app@${RUN}`,
    imageDigest: RUN,
    scannedAt: '2026-01-01T00:00:00.000Z',
    status: vulns.some(([, s]) => s === 'CRITICAL' || s === 'HIGH') ? 'blocked' : 'passed',
    blockSeverities: ['CRITICAL', 'HIGH'],
    blockingCount: 0,
    summary: { unknown: 0, low: 0, medium: 0, high: 0, critical: 0 },
    vulnerabilities: vulns.map(([id, severity]) => ({ id, severity })),
    severityIds: { critical: ids(vulns, 'CRITICAL'), high: ids(vulns, 'HIGH') },
    ...overrides,
  } as never;
}

const candidateScan = (vulns: Array<[string, Severity]>, overrides = {}) =>
  scan(vulns, {
    image: `repo/app@${NEW}`,
    scannedRef: `repo/app@${NEW}`,
    imageDigest: NEW,
    scannedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  });

function makeContainer(
  running: Scan,
  candidate: Scan | undefined,
  overrides: Partial<Container> = {},
): Container {
  return {
    id: 'c1',
    name: 'web',
    labels: { [SECURITY_FAST_LANE_LABEL]: 'true' },
    image: { digest: { value: RUN } },
    result: { tag: '2.0.0', digest: NEW },
    security: { scan: running, ...(candidate ? { updateScan: candidate } : {}) },
    ...overrides,
  } as unknown as Container;
}

describe('security fast lane evaluation', () => {
  afterEach(() => {
    delete process.env[SECURITY_FAST_LANE_ENV];
  });

  test('a candidate that fixes a critical qualifies', () => {
    const container = makeContainer(
      scan([
        ['CVE-1', 'CRITICAL'],
        ['CVE-2', 'MEDIUM'],
      ]),
      candidateScan([['CVE-2', 'MEDIUM']]),
    );
    expect(evaluateSecurityFastLane(container)).toStrictEqual({
      fixedIds: ['CVE-1'],
      fixedCount: 1,
      fixedCritical: 1,
      fixedHigh: 0,
    });
  });

  test('a candidate that fixes a high qualifies', () => {
    const container = makeContainer(scan([['GHSA-aaaa', 'HIGH']]), candidateScan([]));
    expect(evaluateSecurityFastLane(container)).toStrictEqual({
      fixedIds: ['GHSA-aaaa'],
      fixedCount: 1,
      fixedCritical: 0,
      fixedHigh: 1,
    });
  });

  test('fixing only medium and low findings does not qualify', () => {
    const container = makeContainer(
      scan([
        ['CVE-1', 'MEDIUM'],
        ['CVE-2', 'LOW'],
        ['CVE-3', 'UNKNOWN'],
      ]),
      candidateScan([]),
    );
    expect(evaluateSecurityFastLane(container)).toBeUndefined();
  });

  test('a candidate that still carries every critical and high finding does not qualify', () => {
    const container = makeContainer(
      scan([['CVE-1', 'CRITICAL']]),
      candidateScan([['CVE-1', 'CRITICAL']]),
    );
    expect(evaluateSecurityFastLane(container)).toBeUndefined();
  });

  test('a finding that only dropped to a lower severity in the candidate counts as fixed', () => {
    const container = makeContainer(
      scan([['CVE-1', 'CRITICAL']]),
      candidateScan([['CVE-1', 'HIGH']]),
    );
    expect(evaluateSecurityFastLane(container)).toBeUndefined();
    const lowered = makeContainer(scan([['CVE-1', 'HIGH']]), candidateScan([['CVE-1', 'LOW']]));
    expect(evaluateSecurityFastLane(lowered)?.fixedIds).toStrictEqual(['CVE-1']);
  });

  test('a candidate that introduces a new critical does not qualify even when it fixes one', () => {
    const container = makeContainer(
      scan([['CVE-1', 'CRITICAL']]),
      candidateScan([['CVE-9', 'CRITICAL']]),
    );
    expect(evaluateSecurityFastLane(container)).toBeUndefined();
  });

  test('a new high, or a critical the running image already had as high, is tolerated', () => {
    const container = makeContainer(
      scan([
        ['CVE-1', 'CRITICAL'],
        ['CVE-2', 'HIGH'],
      ]),
      candidateScan([
        ['CVE-2', 'CRITICAL'],
        ['CVE-7', 'HIGH'],
      ]),
    );
    expect(evaluateSecurityFastLane(container)?.fixedIds).toStrictEqual(['CVE-1']);
  });

  test('an unscanned candidate does not qualify', () => {
    expect(
      evaluateSecurityFastLane(makeContainer(scan([['CVE-1', 'CRITICAL']]), undefined)),
    ).toBeUndefined();
  });

  test('a container with no running scan does not qualify', () => {
    expect(
      evaluateSecurityFastLane(makeContainer(undefined as never, candidateScan([]))),
    ).toBeUndefined();
  });

  test('a scan carrying an error does not qualify whatever its status', () => {
    for (const status of ['error', 'blocked', 'passed']) {
      expect(
        evaluateSecurityFastLane(
          makeContainer(
            scan([['CVE-1', 'CRITICAL']], { status, error: 'Grype: timeout' }),
            candidateScan([]),
          ),
        ),
      ).toBeUndefined();
      expect(
        evaluateSecurityFastLane(
          makeContainer(
            scan([['CVE-1', 'CRITICAL']]),
            candidateScan([], { status, error: 'Trivy: db missing' }),
          ),
        ),
      ).toBeUndefined();
    }
  });

  test('a scan without its full critical/high ID sets (recorded before truncation) does not qualify', () => {
    const legacyRunning = scan([['CVE-1', 'CRITICAL']], { severityIds: undefined });
    expect(
      evaluateSecurityFastLane(makeContainer(legacyRunning, candidateScan([]))),
    ).toBeUndefined();
    const legacyCandidate = candidateScan([], { severityIds: undefined });
    expect(
      evaluateSecurityFastLane(makeContainer(scan([['CVE-1', 'CRITICAL']]), legacyCandidate)),
    ).toBeUndefined();
  });

  test('compares the full ID sets, not the truncated stored list', () => {
    // The stored list is cut off and no longer shows CVE-1, but the full set still does.
    const truncated = candidateScan([], { severityIds: { critical: ['CVE-1'], high: [] } });
    expect(
      evaluateSecurityFastLane(makeContainer(scan([['CVE-1', 'CRITICAL']]), truncated)),
    ).toBeUndefined();
    // A new critical that fell off the stored list still disqualifies.
    const hidden = candidateScan([], { severityIds: { critical: ['CVE-NEW'], high: [] } });
    expect(
      evaluateSecurityFastLane(makeContainer(scan([['CVE-1', 'CRITICAL']]), hidden)),
    ).toBeUndefined();
  });

  describe('digest binding', () => {
    const running = () => scan([['CVE-1', 'CRITICAL']]);

    test('a candidate scan of a different digest does not qualify', () => {
      const other = candidateScan([], { imageDigest: OTHER });
      expect(evaluateSecurityFastLane(makeContainer(running(), other))).toBeUndefined();
    });

    test('a candidate scan identified only by its image reference or tag does not qualify', () => {
      const tagOnly = candidateScan([], { imageDigest: undefined, image: 'repo/app:2.0.0' });
      expect(evaluateSecurityFastLane(makeContainer(running(), tagOnly))).toBeUndefined();
      const refOnly = candidateScan([], { imageDigest: undefined });
      expect(evaluateSecurityFastLane(makeContainer(running(), refOnly))).toBeUndefined();
    });

    test('a candidate without a digest never qualifies, even with a tag-matching scan', () => {
      const container = makeContainer(running(), candidateScan([]), {
        result: { tag: '2.0.0' } as never,
      });
      expect(evaluateSecurityFastLane(container)).toBeUndefined();
    });

    test('a running scan of a different digest does not qualify', () => {
      const stale = scan([['CVE-1', 'CRITICAL']], { imageDigest: OLD });
      expect(evaluateSecurityFastLane(makeContainer(stale, candidateScan([])))).toBeUndefined();
    });

    test('a tag the registry fell back to is not a digest, on either side', () => {
      const tagAsDigest = candidateScan([], { imageDigest: '2.0.0' });
      const candidateWithTag = makeContainer(running(), tagAsDigest, {
        result: { tag: '2.0.0', digest: '2.0.0' } as never,
      });
      expect(evaluateSecurityFastLane(candidateWithTag)).toBeUndefined();
      expect(needsFastLaneCandidateScan(candidateWithTag)).toBe(false);

      const runningTag = scan([['CVE-1', 'CRITICAL']], { imageDigest: 'latest' });
      const runningWithTag = makeContainer(runningTag, candidateScan([]), {
        image: { digest: { value: 'latest' } } as never,
      });
      expect(evaluateSecurityFastLane(runningWithTag)).toBeUndefined();
    });

    test('a running scan or running image without a digest does not qualify', () => {
      const unstamped = scan([['CVE-1', 'CRITICAL']], { imageDigest: undefined });
      expect(evaluateSecurityFastLane(makeContainer(unstamped, candidateScan([])))).toBeUndefined();
      const noRunningDigest = makeContainer(running(), candidateScan([]), {
        image: { digest: {} } as never,
      });
      expect(evaluateSecurityFastLane(noRunningDigest)).toBeUndefined();
    });
  });

  describe('scanned reference', () => {
    const running = () => scan([['CVE-1', 'CRITICAL']]);

    test.each([
      ['a tag scan stamped with the digest', 'repo/app:1.0.0'],
      ['no recorded reference', undefined],
      ['a reference pinned to another digest', `repo/app@${OTHER}`],
    ])('a running scan with %s is not evidence', (_label, scannedRef) => {
      const stamped = scan([['CVE-1', 'CRITICAL']], { scannedRef });
      expect(evaluateSecurityFastLane(makeContainer(stamped, candidateScan([])))).toBeUndefined();
    });

    test.each([
      ['a tag scan stamped with the digest', 'repo/app:2.0.0'],
      ['no recorded reference', undefined],
      ['a reference pinned to another digest', `repo/app@${OTHER}`],
    ])('a candidate scan with %s is not evidence', (_label, scannedRef) => {
      expect(
        evaluateSecurityFastLane(makeContainer(running(), candidateScan([], { scannedRef }))),
      ).toBeUndefined();
      expect(
        needsFastLaneCandidateScan(makeContainer(running(), candidateScan([], { scannedRef }))),
      ).toBe(true);
    });

    test('a tag-and-digest reference is accepted', () => {
      const both = candidateScan([], { scannedRef: `repo/app:2.0.0@${NEW}` });
      expect(evaluateSecurityFastLane(makeContainer(running(), both))).toBeDefined();
    });
  });

  describe('comparability', () => {
    test('a candidate scan older than the running scan does not qualify', () => {
      const stale = candidateScan([], { scannedAt: '2025-12-31T00:00:00.000Z' });
      expect(
        evaluateSecurityFastLane(makeContainer(scan([['CVE-1', 'CRITICAL']]), stale)),
      ).toBeUndefined();
    });

    test('a candidate scan taken at the same moment as the running scan qualifies', () => {
      const same = candidateScan([], { scannedAt: '2026-01-01T00:00:00.000Z' });
      expect(
        evaluateSecurityFastLane(makeContainer(scan([['CVE-1', 'CRITICAL']]), same)),
      ).toBeDefined();
    });

    test('scans from different scanners do not qualify', () => {
      const other = candidateScan([], { scanner: 'grype' });
      expect(
        evaluateSecurityFastLane(makeContainer(scan([['CVE-1', 'CRITICAL']]), other)),
      ).toBeUndefined();
    });
  });

  test('lists criticals before highs, sorted, capped at the ID limit with the full count kept', () => {
    const many: Array<[string, Severity]> = [];
    for (let i = 0; i < 8; i += 1) many.push([`CVE-H-${i}`, 'HIGH']);
    for (let i = 0; i < 8; i += 1) many.push([`CVE-C-${i}`, 'CRITICAL']);
    const result = evaluateSecurityFastLane(makeContainer(scan(many), candidateScan([])));
    expect(result?.fixedCount).toBe(16);
    expect(result?.fixedCritical).toBe(8);
    expect(result?.fixedHigh).toBe(8);
    expect(result?.fixedIds).toHaveLength(SECURITY_FAST_LANE_ID_CAP);
    expect(result?.fixedIds.slice(0, 3)).toStrictEqual(['CVE-C-0', 'CVE-C-1', 'CVE-C-2']);
    expect(result?.fixedIds[8]).toBe('CVE-H-0');
  });

  test('an ID listed at both severities counts once, as critical', () => {
    const running = scan([['CVE-1', 'CRITICAL']], {
      severityIds: { critical: ['CVE-1'], high: ['CVE-1'] },
    });
    expect(evaluateSecurityFastLane(makeContainer(running, candidateScan([])))).toMatchObject({
      fixedCount: 1,
      fixedCritical: 1,
      fixedHigh: 0,
    });
  });

  test('a container that did not opt in is never fast-laned', () => {
    const container = makeContainer(scan([['CVE-1', 'CRITICAL']]), candidateScan([]), {
      labels: {},
    });
    expect(evaluateSecurityFastLane(container)).toBeUndefined();
  });
});

describe('needsFastLaneCandidateScan', () => {
  const running = () => scan([['CVE-1', 'CRITICAL']]);

  test('is true for an unscanned candidate behind trustworthy running evidence', () => {
    expect(needsFastLaneCandidateScan(makeContainer(running(), undefined))).toBe(true);
  });

  test('is true for a candidate scan that is stale, of another digest, or from another scanner', () => {
    for (const override of [
      { scannedAt: '2025-12-31T00:00:00.000Z' },
      { imageDigest: OTHER },
      { scanner: 'grype' },
      { severityIds: undefined },
      { error: 'partial' },
    ]) {
      expect(
        needsFastLaneCandidateScan(makeContainer(running(), candidateScan([], override))),
      ).toBe(true);
    }
  });

  test('is false once the candidate scan is comparable', () => {
    expect(needsFastLaneCandidateScan(makeContainer(running(), candidateScan([])))).toBe(false);
  });

  test('is false without usable running evidence or a candidate digest', () => {
    expect(
      needsFastLaneCandidateScan(makeContainer(scan([], { imageDigest: OLD }), undefined)),
    ).toBe(false);
    expect(
      needsFastLaneCandidateScan(
        makeContainer(running(), undefined, { result: { tag: '2.0.0' } as never }),
      ),
    ).toBe(false);
  });
});

describe('security fast lane opt-in', () => {
  afterEach(() => {
    delete process.env[SECURITY_FAST_LANE_ENV];
  });

  test('is off by default', () => {
    expect(isSecurityFastLaneEnabled({})).toBe(false);
    expect(isSecurityFastLaneEnabled({ labels: {} })).toBe(false);
  });

  test('the label enables it', () => {
    expect(isSecurityFastLaneEnabled({ labels: { [SECURITY_FAST_LANE_LABEL]: ' TRUE ' } })).toBe(
      true,
    );
  });

  test('the global env enables it for unlabelled containers', () => {
    process.env[SECURITY_FAST_LANE_ENV] = 'true';
    expect(isSecurityFastLaneEnabled({ labels: {} })).toBe(true);
  });

  test('a false label opts one container out of the global default', () => {
    process.env[SECURITY_FAST_LANE_ENV] = 'true';
    expect(isSecurityFastLaneEnabled({ labels: { [SECURITY_FAST_LANE_LABEL]: 'false' } })).toBe(
      false,
    );
  });

  test('an unrecognised label value falls through to the global default', () => {
    process.env[SECURITY_FAST_LANE_ENV] = 'true';
    expect(isSecurityFastLaneEnabled({ labels: { [SECURITY_FAST_LANE_LABEL]: 'yes' } })).toBe(true);
    delete process.env[SECURITY_FAST_LANE_ENV];
    expect(isSecurityFastLaneEnabled({ labels: { [SECURITY_FAST_LANE_LABEL]: 'yes' } })).toBe(
      false,
    );
  });
});

describe('updateScanMatchesCandidate', () => {
  const base = { image: 'repo/app:2.0.0' } as never;

  test('matches by digest, from the stamped digest or the image reference', () => {
    const container = { result: { digest: NEW } } as unknown as Container;
    expect(updateScanMatchesCandidate(container, { ...base, imageDigest: NEW })).toBe(true);
    expect(updateScanMatchesCandidate(container, { image: `repo/app@${NEW}` } as never)).toBe(true);
    expect(updateScanMatchesCandidate(container, { ...base, imageDigest: 'sha256:x' })).toBe(false);
  });

  test('falls back to the tag when the candidate has no digest', () => {
    const container = { result: { tag: '2.0.0' } } as unknown as Container;
    expect(updateScanMatchesCandidate(container, base)).toBe(true);
    expect(updateScanMatchesCandidate(container, { image: '2.0.0' } as never)).toBe(true);
    expect(updateScanMatchesCandidate(container, { image: 'repo/app:3.0.0' } as never)).toBe(false);
    expect(updateScanMatchesCandidate({} as Container, base)).toBe(false);
  });
});
