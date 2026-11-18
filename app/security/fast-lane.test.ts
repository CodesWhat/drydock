import type { Container } from '../model/container.js';
import {
  evaluateSecurityFastLane,
  isSecurityFastLaneEnabled,
  SECURITY_FAST_LANE_ENV,
  SECURITY_FAST_LANE_ID_CAP,
  SECURITY_FAST_LANE_LABEL,
  updateScanMatchesCandidate,
} from './fast-lane.js';

type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';

function scan(
  vulns: Array<[string, Severity]>,
  overrides: Record<string, unknown> = {},
): NonNullable<Container['security']>['scan'] {
  return {
    scanner: 'trivy',
    image: 'repo/app:1.0.0',
    scannedAt: '2026-01-01T00:00:00.000Z',
    status: vulns.some(([, s]) => s === 'CRITICAL' || s === 'HIGH') ? 'blocked' : 'passed',
    blockSeverities: ['CRITICAL', 'HIGH'],
    blockingCount: 0,
    summary: { unknown: 0, low: 0, medium: 0, high: 0, critical: 0 },
    vulnerabilities: vulns.map(([id, severity]) => ({ id, severity })),
    ...overrides,
  } as never;
}

function makeContainer(
  running: ReturnType<typeof scan>,
  candidate: ReturnType<typeof scan> | undefined,
  overrides: Partial<Container> = {},
): Container {
  return {
    id: 'c1',
    name: 'web',
    labels: { [SECURITY_FAST_LANE_LABEL]: 'true' },
    image: { digest: { value: 'sha256:run' } },
    result: { tag: '2.0.0', digest: 'sha256:new' },
    security: { scan: running, ...(candidate ? { updateScan: candidate } : {}) },
    ...overrides,
  } as unknown as Container;
}

const candidateScan = (vulns: Array<[string, Severity]>, overrides = {}) =>
  scan(vulns, { image: 'repo/app:2.0.0', imageDigest: 'sha256:new', ...overrides });

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

  test('a candidate that introduces a new critical does not qualify even when it fixes one', () => {
    const container = makeContainer(
      scan([['CVE-1', 'CRITICAL']]),
      candidateScan([['CVE-9', 'CRITICAL']]),
    );
    expect(evaluateSecurityFastLane(container)).toBeUndefined();
  });

  test('a new high or a critical the running image already had at another severity is tolerated', () => {
    const container = makeContainer(
      scan([
        ['CVE-1', 'CRITICAL'],
        ['CVE-2', 'MEDIUM'],
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
    const container = makeContainer(undefined as never, candidateScan([]));
    expect(evaluateSecurityFastLane(container)).toBeUndefined();
  });

  test('errored scans on either side do not qualify', () => {
    expect(
      evaluateSecurityFastLane(
        makeContainer(scan([['CVE-1', 'CRITICAL']], { status: 'error' }), candidateScan([])),
      ),
    ).toBeUndefined();
    expect(
      evaluateSecurityFastLane(
        makeContainer(scan([['CVE-1', 'CRITICAL']]), candidateScan([], { status: 'error' })),
      ),
    ).toBeUndefined();
  });

  test('a candidate scan of a different image than the pending one does not qualify', () => {
    const stale = candidateScan([], { imageDigest: 'sha256:other', image: 'repo/app:1.5.0' });
    expect(
      evaluateSecurityFastLane(makeContainer(scan([['CVE-1', 'CRITICAL']]), stale)),
    ).toBeUndefined();
  });

  test('a running scan of a different digest than the running image does not qualify', () => {
    const container = makeContainer(
      scan([['CVE-1', 'CRITICAL']], { imageDigest: 'sha256:old' }),
      candidateScan([]),
    );
    expect(evaluateSecurityFastLane(container)).toBeUndefined();
  });

  test('a running scan without a digest is accepted', () => {
    const container = makeContainer(scan([['CVE-1', 'CRITICAL']]), candidateScan([]), {
      image: { digest: {} } as never,
    });
    expect(evaluateSecurityFastLane(container)?.fixedCount).toBe(1);
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

  test('an ID recorded at both severities counts once, as critical', () => {
    const container = makeContainer(
      scan([
        ['CVE-1', 'HIGH'],
        ['CVE-1', 'CRITICAL'],
      ]),
      candidateScan([]),
    );
    expect(evaluateSecurityFastLane(container)).toMatchObject({
      fixedCount: 1,
      fixedCritical: 1,
      fixedHigh: 0,
    });
  });

  test('scans without a vulnerability list are treated as empty', () => {
    const noList = candidateScan([]);
    (noList as { vulnerabilities?: unknown }).vulnerabilities = undefined;
    const running = scan([['CVE-1', 'CRITICAL']]);
    expect(evaluateSecurityFastLane(makeContainer(running, noList))?.fixedCount).toBe(1);
    const runningNoList = scan([]);
    (runningNoList as { vulnerabilities?: unknown }).vulnerabilities = undefined;
    expect(evaluateSecurityFastLane(makeContainer(runningNoList, candidateScan([])))).toBe(
      undefined,
    );
  });

  test('a container that did not opt in is never fast-laned', () => {
    const container = makeContainer(scan([['CVE-1', 'CRITICAL']]), candidateScan([]), {
      labels: {},
    });
    expect(evaluateSecurityFastLane(container)).toBeUndefined();
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
    const container = { result: { digest: 'sha256:new' } } as unknown as Container;
    expect(updateScanMatchesCandidate(container, { ...base, imageDigest: 'sha256:new' })).toBe(
      true,
    );
    expect(updateScanMatchesCandidate(container, { image: 'repo/app@sha256:new' } as never)).toBe(
      true,
    );
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
