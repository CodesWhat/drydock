import * as container from './container.js';
import { daysToMs } from './maturity-policy.js';

const RUN = `sha256:${'a'.repeat(64)}`;
const NEW = `sha256:${'b'.repeat(64)}`;
const OTHER = `sha256:${'d'.repeat(64)}`;

const summary = { unknown: 0, low: 0, medium: 0, high: 0, critical: 0 };

function scan(ids: Array<[string, string]>, extra: Record<string, unknown> = {}) {
  return {
    scanner: 'trivy',
    image: `organization/image@${RUN}`,
    scannedRef: `organization/image@${RUN}`,
    imageDigest: RUN,
    scannedAt: '2026-01-01T00:00:00.000Z',
    status: 'blocked',
    blockSeverities: ['CRITICAL', 'HIGH'],
    blockingCount: ids.length,
    summary,
    vulnerabilities: ids.map(([id, severity]) => ({ id, severity })),
    severityIds: {
      critical: ids.filter(([, s]) => s === 'CRITICAL').map(([id]) => id),
      high: ids.filter(([, s]) => s === 'HIGH').map(([id]) => id),
    },
    ...extra,
  };
}

function build(overrides: Record<string, unknown> = {}) {
  return {
    id: 'container-123456789',
    name: 'test',
    watcher: 'test',
    labels: { 'dd.security.fastlane': 'true' },
    image: {
      id: 'image-123456789',
      registry: { name: 'hub', url: 'https://hub' },
      name: 'organization/image',
      tag: { value: '1.0.0', semver: true },
      digest: { watch: false, value: RUN },
      architecture: 'arch',
      os: 'os',
    },
    result: { tag: '1.0.1', digest: NEW },
    security: {
      scan: scan([
        ['CVE-1', 'CRITICAL'],
        ['CVE-2', 'MEDIUM'],
      ]),
      updateScan: scan([['CVE-2', 'MEDIUM']], {
        image: `organization/image@${NEW}`,
        scannedRef: `organization/image@${NEW}`,
        imageDigest: NEW,
        scannedAt: '2026-01-02T00:00:00.000Z',
        status: 'passed',
      }),
    },
    ...overrides,
  };
}

const held = {
  updatePolicy: {
    snoozeUntil: new Date(Date.now() + daysToMs(1)).toISOString(),
    maturityMode: 'mature',
    maturityMinAgeDays: 30,
  },
  updateDetectedAt: new Date().toISOString(),
};

describe('validate: security fast lane', () => {
  test('derives the flag from the stored scans and lifts snooze and maturity', () => {
    const validated = container.validate(build(held));
    expect(validated.securityFastLane).toStrictEqual({
      fixedIds: ['CVE-1'],
      fixedCount: 1,
      fixedCritical: 1,
      fixedHigh: 0,
    });
    expect(validated.updateAvailable).toBe(true);
  });

  test('without the label the same update stays suppressed', () => {
    const validated = container.validate(build({ ...held, labels: {} }));
    expect(validated.securityFastLane).toBeUndefined();
    expect(validated.updateAvailable).toBe(false);
  });

  test('an unscanned candidate stays suppressed', () => {
    const validated = container.validate(
      build({ ...held, security: { scan: build().security.scan } }),
    );
    expect(validated.securityFastLane).toBeUndefined();
    expect(validated.updateAvailable).toBe(false);
  });

  test('a candidate that only fixes medium findings stays suppressed', () => {
    const validated = container.validate(
      build({
        ...held,
        security: {
          scan: scan([['CVE-2', 'MEDIUM']]),
          updateScan: scan([], {
            image: `organization/image@${NEW}`,
            scannedRef: `organization/image@${NEW}`,
            imageDigest: NEW,
            scannedAt: '2026-01-02T00:00:00.000Z',
            status: 'passed',
          }),
        },
      }),
    );
    expect(validated.securityFastLane).toBeUndefined();
    expect(validated.updateAvailable).toBe(false);
  });

  test('skip lists still suppress a fast-laned update', () => {
    const validated = container.validate(
      build({ updatePolicy: { ...held.updatePolicy, skipTags: ['1.0.1'] } }),
    );
    expect(validated.securityFastLane).toBeDefined();
    expect(validated.updateAvailable).toBe(false);
  });

  test('a candidate scan of the mutable tag rather than the pending digest stays suppressed', () => {
    const input = build(held);
    (input.security.updateScan as { imageDigest?: string }).imageDigest = OTHER;
    const validated = container.validate(input);
    expect(validated.securityFastLane).toBeUndefined();
    expect(validated.updateAvailable).toBe(false);
  });

  test('is not set when there is no pending update, and a stale value is dropped', () => {
    const stale = {
      ...build({ result: { tag: '1.0.0' } }),
      securityFastLane: { fixedIds: ['CVE-9'], fixedCount: 1, fixedCritical: 1, fixedHigh: 0 },
    };
    expect(container.validate(stale).securityFastLane).toBeUndefined();
  });

  test('a stored flag round-trips through validate and is recomputed from the scans', () => {
    const first = container.validate(build(held));
    const second = container.validate({ ...first, security: { scan: first.security?.scan } });
    expect(second.securityFastLane).toBeUndefined();
  });
});
