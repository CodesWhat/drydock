import type { Container } from './container.js';
import {
  BLOCKER_SEVERITY,
  computeUpdateEligibility,
  getHardBlockers,
  getPrimaryHardBlocker,
  getSoftBlockers,
  hasHardBlocker,
  isSelfContainerImage,
  type UpdateEligibilityContext,
} from './update-eligibility.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_IMAGE = {
  id: 'img-1',
  registry: { name: 'hub', url: 'https://registry-1.docker.io' },
  name: 'nginx',
  tag: { value: '1.0.0', semver: true },
  digest: { watch: false },
  architecture: 'amd64',
  os: 'linux',
};

function makeContainer(overrides: Partial<Container> = {}): Container {
  return {
    id: 'c1',
    name: 'web',
    displayName: 'web',
    displayIcon: 'mdi:docker',
    status: 'running',
    watcher: 'local',
    image: BASE_IMAGE,
    updateAvailable: false,
    updateKind: { kind: 'unknown' },
    ...overrides,
  } as Container;
}

// Container with a detected tag update
function makeContainerWithTagUpdate(overrides: Partial<Container> = {}): Container {
  return makeContainer({
    image: {
      ...BASE_IMAGE,
      tag: { value: '1.0.0', semver: true },
    },
    result: { tag: '1.1.0' },
    updateAvailable: true,
    updateKind: { kind: 'tag', localValue: '1.0.0', remoteValue: '1.1.0', semverDiff: 'minor' },
    ...overrides,
  });
}

// Container with a detected digest update
function makeContainerWithDigestUpdate(overrides: Partial<Container> = {}): Container {
  return makeContainer({
    image: {
      ...BASE_IMAGE,
      digest: { watch: true, value: 'sha256:aaa' },
    },
    result: { digest: 'sha256:bbb' },
    updateAvailable: true,
    updateKind: {
      kind: 'digest',
      localValue: 'sha256:aaa',
      remoteValue: 'sha256:bbb',
      semverDiff: 'unknown',
    },
    ...overrides,
  });
}

// A minimal trigger mock with all the methods eligibility needs
function makeTrigger(
  overrides: Partial<{
    type: string;
    agent: string | undefined;
    configuration: { threshold?: string };
    getId: () => string;
    isTriggerIncluded: (c: Container, include: string | undefined) => boolean;
    isTriggerExcluded: (c: Container, exclude: string | undefined) => boolean;
  }> = {},
) {
  return {
    type: 'docker',
    agent: undefined,
    configuration: { threshold: 'all' },
    getId: () => 'docker.update',
    isTriggerIncluded: (_c: Container, include: string | undefined) => !include,
    isTriggerExcluded: (_c: Container, _exclude: string | undefined) => false,
    ...overrides,
  };
}

function makeContext(overrides: Partial<UpdateEligibilityContext> = {}): UpdateEligibilityContext {
  return {
    triggers: undefined,
    getActiveOperation: () => undefined,
    ...overrides,
  };
}

// Fixed timestamp for deterministic tests: 2026-04-23T12:00:00.000Z
const FIXED_NOW = new Date('2026-04-23T12:00:00.000Z').getTime();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('computeUpdateEligibility', () => {
  describe('no-update-available', () => {
    test('detects update via image.created date difference when tags are identical', () => {
      // Tags are the same but created dates differ → raw update detected → NOT no-update-available
      const trigger = makeTrigger();
      const container = makeContainer({
        image: {
          ...BASE_IMAGE,
          tag: { value: '1.0.0', semver: true },
          created: '2026-01-01T00:00:00.000Z',
        },
        result: { tag: '1.0.0', created: '2026-02-01T00:00:00.000Z' },
      });
      const result = computeUpdateEligibility(
        container,
        makeContext({
          triggers: { 'docker.update': trigger as never },
          now: FIXED_NOW,
        }),
      );
      expect(result.blockers.find((b) => b.reason === 'no-update-available')).toBeUndefined();
    });

    test('no update when image.created dates are equal', () => {
      const container = makeContainer({
        image: {
          ...BASE_IMAGE,
          tag: { value: '1.0.0', semver: true },
          created: '2026-01-01T00:00:00.000Z',
        },
        result: { tag: '1.0.0', created: '2026-01-01T00:00:00.000Z' },
      });
      const result = computeUpdateEligibility(container, makeContext({ now: FIXED_NOW }));
      expect(result.blockers[0].reason).toBe('no-update-available');
    });

    test('returns no-update-available when container has no result', () => {
      const container = makeContainer();
      const result = computeUpdateEligibility(container, makeContext({ now: FIXED_NOW }));
      expect(result.eligible).toBe(false);
      expect(result.blockers).toHaveLength(1);
      expect(result.blockers[0].reason).toBe('no-update-available');
      expect(result.blockers[0].actionable).toBe(false);
    });

    test('returns no-update-available when tags match', () => {
      const container = makeContainer({
        image: { ...BASE_IMAGE, tag: { value: '1.0.0', semver: true } },
        result: { tag: '1.0.0' },
      });
      const result = computeUpdateEligibility(container, makeContext({ now: FIXED_NOW }));
      expect(result.blockers[0].reason).toBe('no-update-available');
    });

    test('no-update-available short-circuits — no other blockers included', () => {
      const container = makeContainer({
        // no result, but also snooze configured
        updatePolicy: { snoozeUntil: '2030-01-01T00:00:00.000Z' },
      });
      const result = computeUpdateEligibility(container, makeContext({ now: FIXED_NOW }));
      expect(result.blockers).toHaveLength(1);
      expect(result.blockers[0].reason).toBe('no-update-available');
    });
  });

  describe('eligible path', () => {
    test('returns eligible when update available and no blockers', () => {
      const trigger = makeTrigger();
      const container = makeContainerWithTagUpdate();
      const result = computeUpdateEligibility(
        container,
        makeContext({
          triggers: { 'docker.update': trigger as never },
          now: FIXED_NOW,
        }),
      );
      expect(result.eligible).toBe(true);
      expect(result.blockers).toHaveLength(0);
    });

    test('digest update is eligible with no blockers', () => {
      const trigger = makeTrigger();
      const container = makeContainerWithDigestUpdate();
      const result = computeUpdateEligibility(
        container,
        makeContext({
          triggers: { 'docker.update': trigger as never },
          now: FIXED_NOW,
        }),
      );
      expect(result.eligible).toBe(true);
      expect(result.blockers).toHaveLength(0);
    });
  });

  describe('evaluatedAt', () => {
    test('evaluatedAt is an ISO 8601 string', () => {
      const container = makeContainerWithTagUpdate();
      const result = computeUpdateEligibility(container, makeContext({ now: FIXED_NOW }));
      expect(result.evaluatedAt).toBe(new Date(FIXED_NOW).toISOString());
      expect(() => new Date(result.evaluatedAt)).not.toThrow();
    });

    test('evaluatedAt uses Date.now() when no now provided', () => {
      const before = Date.now();
      const container = makeContainerWithTagUpdate();
      const result = computeUpdateEligibility(container, makeContext());
      const after = Date.now();
      const evaluatedMs = new Date(result.evaluatedAt).getTime();
      expect(evaluatedMs).toBeGreaterThanOrEqual(before);
      expect(evaluatedMs).toBeLessThanOrEqual(after);
    });
  });

  describe('security-scan-blocked', () => {
    test('emits blocker when updateScan status is blocked', () => {
      const container = makeContainerWithTagUpdate({
        security: {
          updateScan: {
            scanner: 'trivy',
            image: 'nginx:1.1.0',
            scannedAt: new Date().toISOString(),
            status: 'blocked',
            blockSeverities: ['CRITICAL'],
            blockingCount: 2,
            summary: { unknown: 0, low: 0, medium: 0, high: 1, critical: 1 },
            vulnerabilities: [],
          },
        },
      });
      const result = computeUpdateEligibility(container, makeContext({ now: FIXED_NOW }));
      const blocker = result.blockers.find((b) => b.reason === 'security-scan-blocked');
      expect(blocker).toBeDefined();
      expect(blocker?.actionable).toBe(true);
      expect(blocker?.actionHint).toBe('Lower the scan severity threshold before updating.');
    });

    test('no blocker when updateScan status is passed', () => {
      const trigger = makeTrigger();
      const container = makeContainerWithTagUpdate({
        security: {
          updateScan: {
            scanner: 'trivy',
            image: 'nginx:1.1.0',
            scannedAt: new Date().toISOString(),
            status: 'passed',
            blockSeverities: [],
            blockingCount: 0,
            summary: { unknown: 0, low: 0, medium: 0, high: 0, critical: 0 },
            vulnerabilities: [],
          },
        },
      });
      const result = computeUpdateEligibility(
        container,
        makeContext({
          triggers: { 'docker.update': trigger as never },
          now: FIXED_NOW,
        }),
      );
      expect(result.blockers.find((b) => b.reason === 'security-scan-blocked')).toBeUndefined();
    });

    test('relative pass overrides the otherwise-blocking current scan', () => {
      const summary = { unknown: 0, low: 0, medium: 0, high: 1, critical: 1 };
      const container = makeContainerWithTagUpdate({
        security: {
          scan: {
            scanner: 'trivy',
            image: 'nginx:1.0.0',
            scannedAt: new Date().toISOString(),
            status: 'blocked',
            blockSeverities: ['CRITICAL', 'HIGH'],
            blockingCount: 2,
            summary,
            vulnerabilities: [],
          },
          updateScan: {
            scanner: 'trivy',
            image: 'nginx:1.1.0',
            scannedAt: new Date().toISOString(),
            status: 'passed',
            blockSeverities: ['CRITICAL', 'HIGH'],
            blockingCount: 2,
            summary,
            vulnerabilities: [],
            relativeGate: {
              decision: 'passed',
              reason: 'no-worse-than-current',
              currentSummary: summary,
            },
          },
        },
      });

      const result = computeUpdateEligibility(container, makeContext({ now: FIXED_NOW }));

      expect(result.blockers.find((b) => b.reason === 'security-scan-blocked')).toBeUndefined();
    });

    test.each([
      ['matching digest metadata', { image: 'nginx:candidate', imageDigest: 'sha256:bbb' }],
      ['matching pinned image', { image: 'nginx@sha256:bbb' }],
    ])('relative pass accepts a digest candidate via %s', (_label, updateScanIdentity) => {
      const summary = { unknown: 0, low: 0, medium: 0, high: 1, critical: 1 };
      const container = makeContainerWithDigestUpdate({
        security: {
          scan: {
            scanner: 'trivy',
            image: 'nginx@sha256:aaa',
            imageDigest: 'sha256:aaa',
            scannedAt: new Date().toISOString(),
            status: 'blocked',
            blockSeverities: ['CRITICAL', 'HIGH'],
            blockingCount: 2,
            summary,
            vulnerabilities: [],
          },
          updateScan: {
            scanner: 'trivy',
            ...updateScanIdentity,
            scannedAt: new Date().toISOString(),
            status: 'passed',
            blockSeverities: ['CRITICAL', 'HIGH'],
            blockingCount: 2,
            summary,
            vulnerabilities: [],
            relativeGate: {
              decision: 'passed',
              reason: 'no-worse-than-current',
              currentSummary: summary,
            },
          },
        },
      });

      const result = computeUpdateEligibility(container, makeContext({ now: FIXED_NOW }));

      expect(result.blockers.find((b) => b.reason === 'security-scan-blocked')).toBeUndefined();
    });

    test('stale relative pass does not match a different digest candidate', () => {
      const summary = { unknown: 0, low: 0, medium: 0, high: 1, critical: 1 };
      const container = makeContainerWithDigestUpdate({
        security: {
          scan: {
            scanner: 'trivy',
            image: 'nginx@sha256:aaa',
            imageDigest: 'sha256:aaa',
            scannedAt: new Date().toISOString(),
            status: 'blocked',
            blockSeverities: ['CRITICAL', 'HIGH'],
            blockingCount: 2,
            summary,
            vulnerabilities: [],
          },
          updateScan: {
            scanner: 'trivy',
            image: 'nginx@sha256:ccc',
            imageDigest: 'sha256:ccc',
            scannedAt: new Date().toISOString(),
            status: 'passed',
            blockSeverities: ['CRITICAL', 'HIGH'],
            blockingCount: 2,
            summary,
            vulnerabilities: [],
            relativeGate: {
              decision: 'passed',
              reason: 'no-worse-than-current',
              currentSummary: summary,
            },
          },
        },
      });

      const result = computeUpdateEligibility(container, makeContext({ now: FIXED_NOW }));

      expect(result.blockers.find((b) => b.reason === 'security-scan-blocked')).toBeDefined();
    });

    test('stale relative pass does not override a blocked current scan for a newer candidate', () => {
      const summary = { unknown: 0, low: 0, medium: 0, high: 1, critical: 1 };
      const container = makeContainerWithTagUpdate({
        result: { tag: '1.2.0' },
        security: {
          scan: {
            scanner: 'trivy',
            image: 'nginx:1.0.0',
            scannedAt: new Date().toISOString(),
            status: 'blocked',
            blockSeverities: ['CRITICAL', 'HIGH'],
            blockingCount: 2,
            summary,
            vulnerabilities: [],
          },
          updateScan: {
            scanner: 'trivy',
            image: 'nginx:1.1.0',
            scannedAt: new Date().toISOString(),
            status: 'passed',
            blockSeverities: ['CRITICAL', 'HIGH'],
            blockingCount: 2,
            summary,
            vulnerabilities: [],
            relativeGate: {
              decision: 'passed',
              reason: 'no-worse-than-current',
              currentSummary: summary,
            },
          },
        },
      });

      const result = computeUpdateEligibility(container, makeContext({ now: FIXED_NOW }));

      expect(result.blockers.find((b) => b.reason === 'security-scan-blocked')).toBeDefined();
    });

    test('plain candidate pass does not override a blocked current scan', () => {
      const summary = { unknown: 0, low: 0, medium: 0, high: 1, critical: 1 };
      const container = makeContainerWithTagUpdate({
        security: {
          scan: {
            scanner: 'trivy',
            image: 'nginx:1.0.0',
            scannedAt: new Date().toISOString(),
            status: 'blocked',
            blockSeverities: ['CRITICAL', 'HIGH'],
            blockingCount: 2,
            summary,
            vulnerabilities: [],
          },
          updateScan: {
            scanner: 'trivy',
            image: 'nginx:1.1.0',
            scannedAt: new Date().toISOString(),
            status: 'passed',
            blockSeverities: [],
            blockingCount: 0,
            summary: { unknown: 0, low: 0, medium: 0, high: 0, critical: 0 },
            vulnerabilities: [],
          },
        },
      });

      const result = computeUpdateEligibility(container, makeContext({ now: FIXED_NOW }));

      expect(result.blockers.find((b) => b.reason === 'security-scan-blocked')).toBeDefined();
    });

    test('no blocker when no security info present', () => {
      const trigger = makeTrigger();
      const container = makeContainerWithTagUpdate();
      const result = computeUpdateEligibility(
        container,
        makeContext({
          triggers: { 'docker.update': trigger as never },
          now: FIXED_NOW,
        }),
      );
      expect(result.blockers.find((b) => b.reason === 'security-scan-blocked')).toBeUndefined();
    });
  });

  describe('last-update-rolled-back', () => {
    const ROLLBACK_DIGEST = 'sha256:deadbeef';
    const OTHER_DIGEST = 'sha256:cafebabe';
    const ROLLBACK_STATE = {
      recordedAt: '2026-04-01T00:00:00.000Z',
      targetDigest: ROLLBACK_DIGEST,
      reason: 'start_new_failed',
      lastError: 'container exited with code 1',
    };

    test('emits blocker when candidate digest matches recorded rollback targetDigest', () => {
      const container = makeContainerWithTagUpdate({
        result: { tag: '1.1.0', digest: ROLLBACK_DIGEST },
        updateRollback: ROLLBACK_STATE,
      });
      const result = computeUpdateEligibility(container, makeContext({ now: FIXED_NOW }));
      const blocker = result.blockers.find((b) => b.reason === 'last-update-rolled-back');
      expect(blocker).toBeDefined();
      expect(blocker?.severity).toBe('hard');
      expect(blocker?.actionable).toBe(true);
      expect(blocker?.actionHint).toBeTruthy();
      expect(blocker?.details?.targetDigest).toBe(ROLLBACK_DIGEST);
      expect(blocker?.details?.rollbackReason).toBe('start_new_failed');
      expect(blocker?.details?.lastError).toBe('container exited with code 1');
    });

    test('does NOT emit blocker when candidate digest differs from recorded rollback targetDigest', () => {
      const trigger = makeTrigger();
      const container = makeContainerWithTagUpdate({
        result: { tag: '1.2.0', digest: OTHER_DIGEST },
        updateRollback: ROLLBACK_STATE,
      });
      const result = computeUpdateEligibility(
        container,
        makeContext({ triggers: { 'docker.update': trigger as never }, now: FIXED_NOW }),
      );
      expect(result.blockers.find((b) => b.reason === 'last-update-rolled-back')).toBeUndefined();
    });

    test('does NOT emit blocker when candidate digest is undefined', () => {
      const trigger = makeTrigger();
      // result.tag update present but no digest
      const container = makeContainerWithTagUpdate({
        result: { tag: '1.1.0' },
        updateRollback: ROLLBACK_STATE,
      });
      const result = computeUpdateEligibility(
        container,
        makeContext({ triggers: { 'docker.update': trigger as never }, now: FIXED_NOW }),
      );
      expect(result.blockers.find((b) => b.reason === 'last-update-rolled-back')).toBeUndefined();
    });

    test('emits blocker when digest is unavailable and candidate tag matches recorded rollback target', () => {
      const container = makeContainerWithTagUpdate({
        result: { tag: '1.1.0' },
        updateRollback: {
          ...ROLLBACK_STATE,
          targetDigest: '1.1.0',
        },
      });
      const result = computeUpdateEligibility(container, makeContext({ now: FIXED_NOW }));
      const blocker = result.blockers.find((b) => b.reason === 'last-update-rolled-back');
      expect(blocker).toBeDefined();
      expect(blocker?.details?.targetDigest).toBe('1.1.0');
    });

    test('does NOT emit blocker when dd.update.rollback-gate=off', () => {
      const trigger = makeTrigger();
      const container = makeContainerWithTagUpdate({
        result: { tag: '1.1.0', digest: ROLLBACK_DIGEST },
        updateRollback: ROLLBACK_STATE,
        labels: { 'dd.update.rollback-gate': 'off' },
      });
      const result = computeUpdateEligibility(
        container,
        makeContext({ triggers: { 'docker.update': trigger as never }, now: FIXED_NOW }),
      );
      expect(result.blockers.find((b) => b.reason === 'last-update-rolled-back')).toBeUndefined();
    });

    test('emits blocker when dd.update.rollback-gate=on (explicit)', () => {
      const container = makeContainerWithTagUpdate({
        result: { tag: '1.1.0', digest: ROLLBACK_DIGEST },
        updateRollback: ROLLBACK_STATE,
        labels: { 'dd.update.rollback-gate': 'on' },
      });
      const result = computeUpdateEligibility(container, makeContext({ now: FIXED_NOW }));
      expect(result.blockers.find((b) => b.reason === 'last-update-rolled-back')).toBeDefined();
    });

    test('ignores unrecognised rollback-gate label value (treats as gate on)', () => {
      const container = makeContainerWithTagUpdate({
        result: { tag: '1.1.0', digest: ROLLBACK_DIGEST },
        updateRollback: ROLLBACK_STATE,
        labels: { 'dd.update.rollback-gate': 'yes' },
      });
      const result = computeUpdateEligibility(container, makeContext({ now: FIXED_NOW }));
      expect(result.blockers.find((b) => b.reason === 'last-update-rolled-back')).toBeDefined();
    });

    test('does NOT emit blocker when updateRollback is absent', () => {
      const trigger = makeTrigger();
      const container = makeContainerWithTagUpdate({
        result: { tag: '1.1.0', digest: ROLLBACK_DIGEST },
      });
      const result = computeUpdateEligibility(
        container,
        makeContext({ triggers: { 'docker.update': trigger as never }, now: FIXED_NOW }),
      );
      expect(result.blockers.find((b) => b.reason === 'last-update-rolled-back')).toBeUndefined();
    });

    test('BLOCKER_SEVERITY for last-update-rolled-back is hard', () => {
      expect(BLOCKER_SEVERITY['last-update-rolled-back']).toBe('hard');
    });
  });

  describe('snoozed', () => {
    test('formatSnoozeDate falls back to raw ISO string when toLocaleDateString throws', () => {
      const originalToLocaleDateString = Date.prototype.toLocaleDateString;
      Date.prototype.toLocaleDateString = () => {
        throw new Error('locale error');
      };
      try {
        const snoozeUntil = '2030-01-01T00:00:00.000Z';
        const container = makeContainerWithTagUpdate({ updatePolicy: { snoozeUntil } });
        const result = computeUpdateEligibility(container, makeContext({ now: FIXED_NOW }));
        const blocker = result.blockers.find((b) => b.reason === 'snoozed');
        expect(blocker?.message).toContain(snoozeUntil);
      } finally {
        Date.prototype.toLocaleDateString = originalToLocaleDateString;
      }
    });

    test('emits blocker when snoozeUntil is in the future', () => {
      const snoozeUntil = '2030-01-01T00:00:00.000Z';
      const container = makeContainerWithTagUpdate({
        updatePolicy: { snoozeUntil },
      });
      const result = computeUpdateEligibility(container, makeContext({ now: FIXED_NOW }));
      const blocker = result.blockers.find((b) => b.reason === 'snoozed');
      expect(blocker).toBeDefined();
      expect(blocker?.liftableAt).toBe(snoozeUntil);
      expect(blocker?.actionable).toBe(true);
    });

    test('no blocker when snoozeUntil is in the past', () => {
      const trigger = makeTrigger();
      const container = makeContainerWithTagUpdate({
        updatePolicy: { snoozeUntil: '2020-01-01T00:00:00.000Z' },
      });
      const result = computeUpdateEligibility(
        container,
        makeContext({
          triggers: { 'docker.update': trigger as never },
          now: FIXED_NOW,
        }),
      );
      expect(result.blockers.find((b) => b.reason === 'snoozed')).toBeUndefined();
    });

    test('snooze message contains human-readable date', () => {
      const container = makeContainerWithTagUpdate({
        updatePolicy: { snoozeUntil: '2030-06-15T00:00:00.000Z' },
      });
      const result = computeUpdateEligibility(container, makeContext({ now: FIXED_NOW }));
      const blocker = result.blockers.find((b) => b.reason === 'snoozed');
      expect(blocker?.message).toContain('2030');
    });
  });

  describe('skip-tag', () => {
    test('emits blocker when remote tag is in skipTags', () => {
      const container = makeContainerWithTagUpdate({
        updatePolicy: { skipTags: ['1.1.0'] },
      });
      const result = computeUpdateEligibility(container, makeContext({ now: FIXED_NOW }));
      const blocker = result.blockers.find((b) => b.reason === 'skip-tag');
      expect(blocker).toBeDefined();
      expect(blocker?.details?.skippedTag).toBe('1.1.0');
      expect(blocker?.actionable).toBe(true);
    });

    test('no blocker when remote tag is not in skipTags', () => {
      const trigger = makeTrigger();
      const container = makeContainerWithTagUpdate({
        updatePolicy: { skipTags: ['2.0.0'] },
      });
      const result = computeUpdateEligibility(
        container,
        makeContext({
          triggers: { 'docker.update': trigger as never },
          now: FIXED_NOW,
        }),
      );
      expect(result.blockers.find((b) => b.reason === 'skip-tag')).toBeUndefined();
    });

    test('no blocker when skipTags is empty', () => {
      const trigger = makeTrigger();
      const container = makeContainerWithTagUpdate({ updatePolicy: { skipTags: [] } });
      const result = computeUpdateEligibility(
        container,
        makeContext({
          triggers: { 'docker.update': trigger as never },
          now: FIXED_NOW,
        }),
      );
      expect(result.blockers.find((b) => b.reason === 'skip-tag')).toBeUndefined();
    });

    test('no skip-tag blocker when container has no result tag', () => {
      const container = makeContainerWithDigestUpdate({
        updatePolicy: { skipTags: ['1.1.0'] },
      });
      const result = computeUpdateEligibility(container, makeContext({ now: FIXED_NOW }));
      expect(result.blockers.find((b) => b.reason === 'skip-tag')).toBeUndefined();
    });
  });

  describe('skip-digest', () => {
    test('emits blocker when remote digest is in skipDigests', () => {
      const container = makeContainerWithDigestUpdate({
        updatePolicy: { skipDigests: ['sha256:bbb'] },
      });
      const result = computeUpdateEligibility(container, makeContext({ now: FIXED_NOW }));
      const blocker = result.blockers.find((b) => b.reason === 'skip-digest');
      expect(blocker).toBeDefined();
      expect(blocker?.details?.skippedDigest).toBe('sha256:bbb');
    });

    test('no blocker when digest not in skipDigests', () => {
      const trigger = makeTrigger();
      const container = makeContainerWithDigestUpdate({
        updatePolicy: { skipDigests: ['sha256:zzz'] },
      });
      const result = computeUpdateEligibility(
        container,
        makeContext({
          triggers: { 'docker.update': trigger as never },
          now: FIXED_NOW,
        }),
      );
      expect(result.blockers.find((b) => b.reason === 'skip-digest')).toBeUndefined();
    });
  });

  describe('maturity-not-reached', () => {
    test('emits blocker when maturityMode=mature and update is not old enough', () => {
      // Update detected 2 days ago, min age is 7 days
      const updateDetectedAt = new Date(FIXED_NOW - 2 * 24 * 60 * 60 * 1000).toISOString();
      const container = makeContainerWithTagUpdate({
        updateDetectedAt,
        updatePolicy: { maturityMode: 'mature', maturityMinAgeDays: 7 },
      });
      const result = computeUpdateEligibility(container, makeContext({ now: FIXED_NOW }));
      const blocker = result.blockers.find((b) => b.reason === 'maturity-not-reached');
      expect(blocker).toBeDefined();
      expect(blocker?.actionable).toBe(true);
      expect(blocker?.details?.minAgeDays).toBe(7);
      expect(blocker?.details?.remainingMs).toBeGreaterThan(0);
      expect(blocker?.liftableAt).toBeDefined();
    });

    test('maturity blocker identifies the declarative source tier', () => {
      const container = makeContainerWithTagUpdate({
        updateDetectedAt: new Date(FIXED_NOW - 24 * 60 * 60 * 1000).toISOString(),
        updatePolicy: { maturityMode: 'mature', maturityMinAgeDays: 7 },
        updatePolicySources: { maturityMode: 'label', maturityMinAgeDays: 'label' },
      });

      const result = computeUpdateEligibility(container, makeContext({ now: FIXED_NOW }));
      const blocker = result.blockers.find((b) => b.reason === 'maturity-not-reached');
      expect(blocker?.message).toContain('from label');
      expect(blocker?.details?.policySource).toBe('label');
    });

    test('liftableAt is correct ISO date when updateDetectedAt is known', () => {
      const updateDetectedAt = new Date(FIXED_NOW - 2 * 24 * 60 * 60 * 1000).toISOString();
      const container = makeContainerWithTagUpdate({
        updateDetectedAt,
        updatePolicy: { maturityMode: 'mature', maturityMinAgeDays: 7 },
      });
      const result = computeUpdateEligibility(container, makeContext({ now: FIXED_NOW }));
      const blocker = result.blockers.find((b) => b.reason === 'maturity-not-reached');
      // liftableAt should be detectedAt + 7 days
      const expectedLiftableAt = new Date(
        new Date(updateDetectedAt).getTime() + 7 * 24 * 60 * 60 * 1000,
      ).toISOString();
      expect(blocker?.liftableAt).toBe(expectedLiftableAt);
    });

    test('no liftableAt when updateDetectedAt is unknown', () => {
      const container = makeContainerWithTagUpdate({
        updatePolicy: { maturityMode: 'mature', maturityMinAgeDays: 7 },
      });
      const result = computeUpdateEligibility(container, makeContext({ now: FIXED_NOW }));
      const blocker = result.blockers.find((b) => b.reason === 'maturity-not-reached');
      expect(blocker).toBeDefined();
      expect(blocker?.liftableAt).toBeUndefined();
    });

    test('no blocker when update has passed maturity threshold', () => {
      const trigger = makeTrigger();
      // Update detected 10 days ago, min age is 7 days
      const updateDetectedAt = new Date(FIXED_NOW - 10 * 24 * 60 * 60 * 1000).toISOString();
      const container = makeContainerWithTagUpdate({
        updateDetectedAt,
        updatePolicy: { maturityMode: 'mature', maturityMinAgeDays: 7 },
      });
      const result = computeUpdateEligibility(
        container,
        makeContext({
          triggers: { 'docker.update': trigger as never },
          now: FIXED_NOW,
        }),
      );
      expect(result.blockers.find((b) => b.reason === 'maturity-not-reached')).toBeUndefined();
    });

    test('no blocker when maturityMode is all', () => {
      const trigger = makeTrigger();
      const container = makeContainerWithTagUpdate({
        updatePolicy: { maturityMode: 'all', maturityMinAgeDays: 7 },
      });
      const result = computeUpdateEligibility(
        container,
        makeContext({
          triggers: { 'docker.update': trigger as never },
          now: FIXED_NOW,
        }),
      );
      expect(result.blockers.find((b) => b.reason === 'maturity-not-reached')).toBeUndefined();
    });

    test('message no longer states a remaining-days clause (#display-honesty)', () => {
      // The UI now composes its own countdown from details.remainingMs/clockStartAt
      // (see useUpdateStatus.ts maturitySentence()) — the "(N day(s) remaining)" clause
      // was dropped from the backend message itself.
      // Detected 6 days ago, min age 7 days → exactly 1 day remaining
      const updateDetectedAt = new Date(FIXED_NOW - 6 * 24 * 60 * 60 * 1000).toISOString();
      const container = makeContainerWithTagUpdate({
        updateDetectedAt,
        updatePolicy: { maturityMode: 'mature', maturityMinAgeDays: 7 },
      });
      const result = computeUpdateEligibility(container, makeContext({ now: FIXED_NOW }));
      const blocker = result.blockers.find((b) => b.reason === 'maturity-not-reached');
      expect(blocker?.message).toBe('Maturity policy requires updates to be at least 7 days old.');
      expect(blocker?.message).not.toContain('remaining');
    });

    test('details carry clockSource=detectedAt and clockStartAt when only updateDetectedAt resolves', () => {
      const updateDetectedAt = new Date(FIXED_NOW - 2 * 24 * 60 * 60 * 1000).toISOString();
      const container = makeContainerWithTagUpdate({
        updateDetectedAt,
        updatePolicy: { maturityMode: 'mature', maturityMinAgeDays: 7 },
      });
      const result = computeUpdateEligibility(container, makeContext({ now: FIXED_NOW }));
      const blocker = result.blockers.find((b) => b.reason === 'maturity-not-reached');
      expect(blocker?.details?.clockSource).toBe('detectedAt');
      expect(blocker?.details?.clockStartAt).toBe(new Date(updateDetectedAt).toISOString());
    });

    test('details carry clockSource=publishedAt and clockStartAt when trusted publishedAt wins', () => {
      // publishedAt = 3 days ago (trusted, older than detectedAt=2 days) → publishedAt wins
      const updateDetectedAt = new Date(FIXED_NOW - 2 * 24 * 60 * 60 * 1000).toISOString();
      const publishedAt = new Date(FIXED_NOW - 3 * 24 * 60 * 60 * 1000).toISOString();
      const container = makeContainerWithTagUpdate({
        updateDetectedAt,
        result: { tag: '1.1.0', publishedAt, publishedAtTrusted: true },
        updatePolicy: { maturityMode: 'mature', maturityMinAgeDays: 7 },
      });
      const result = computeUpdateEligibility(container, makeContext({ now: FIXED_NOW }));
      const blocker = result.blockers.find((b) => b.reason === 'maturity-not-reached');
      expect(blocker?.details?.clockSource).toBe('publishedAt');
      expect(blocker?.details?.clockStartAt).toBe(new Date(publishedAt).toISOString());
    });

    test('details carry clockSource=detectedAt when detection happened even earlier than trusted publishedAt (tie-break)', () => {
      // detectedAt is 5 days ago, publishedAt (trusted) is 3 days ago → detectedAt is the
      // earlier of the two and wins (mirrors the historical Math.min tie-break exactly).
      const updateDetectedAt = new Date(FIXED_NOW - 5 * 24 * 60 * 60 * 1000).toISOString();
      const publishedAt = new Date(FIXED_NOW - 3 * 24 * 60 * 60 * 1000).toISOString();
      const container = makeContainerWithTagUpdate({
        updateDetectedAt,
        result: { tag: '1.1.0', publishedAt, publishedAtTrusted: true },
        updatePolicy: { maturityMode: 'mature', maturityMinAgeDays: 7 },
      });
      const result = computeUpdateEligibility(container, makeContext({ now: FIXED_NOW }));
      const blocker = result.blockers.find((b) => b.reason === 'maturity-not-reached');
      expect(blocker?.details?.clockSource).toBe('detectedAt');
      expect(blocker?.details?.clockStartAt).toBe(new Date(updateDetectedAt).toISOString());
    });

    test('details omit clockSource and clockStartAt when no clock resolves', () => {
      const container = makeContainerWithTagUpdate({
        updatePolicy: { maturityMode: 'mature', maturityMinAgeDays: 7 },
      });
      const result = computeUpdateEligibility(container, makeContext({ now: FIXED_NOW }));
      const blocker = result.blockers.find((b) => b.reason === 'maturity-not-reached');
      expect(blocker).toBeDefined();
      expect(blocker?.details).not.toHaveProperty('clockSource');
      expect(blocker?.details).not.toHaveProperty('clockStartAt');
    });

    test('uses default minAgeDays (7) when maturityMinAgeDays not set', () => {
      const updateDetectedAt = new Date(FIXED_NOW - 2 * 24 * 60 * 60 * 1000).toISOString();
      const container = makeContainerWithTagUpdate({
        updateDetectedAt,
        updatePolicy: { maturityMode: 'mature' },
      });
      const result = computeUpdateEligibility(container, makeContext({ now: FIXED_NOW }));
      const blocker = result.blockers.find((b) => b.reason === 'maturity-not-reached');
      expect(blocker?.details?.minAgeDays).toBe(7);
    });

    test('no blocker when trusted publishedAt is old enough even if updateDetectedAt is recent', () => {
      const trigger = makeTrigger();
      // updateDetectedAt is 2 days ago (not old enough), but trusted publishedAt is 10 days ago
      const updateDetectedAt = new Date(FIXED_NOW - 2 * 24 * 60 * 60 * 1000).toISOString();
      const publishedAt = new Date(FIXED_NOW - 10 * 24 * 60 * 60 * 1000).toISOString();
      const container = makeContainerWithTagUpdate({
        updateDetectedAt,
        result: { tag: '1.1.0', publishedAt, publishedAtTrusted: true },
        updatePolicy: { maturityMode: 'mature', maturityMinAgeDays: 7 },
      });
      const result = computeUpdateEligibility(
        container,
        makeContext({ triggers: { 'docker.update': trigger as never }, now: FIXED_NOW }),
      );
      expect(result.blockers.find((b) => b.reason === 'maturity-not-reached')).toBeUndefined();
    });

    test('emits blocker when trusted publishedAt is still within maturity window', () => {
      // publishedAt = 3 days ago (trusted, older than detectedAt=2 days)
      // Math.min(now-3, now-2) = now-3 → age = 3 days < 7 → blocker
      const updateDetectedAt = new Date(FIXED_NOW - 2 * 24 * 60 * 60 * 1000).toISOString();
      const publishedAt = new Date(FIXED_NOW - 3 * 24 * 60 * 60 * 1000).toISOString();
      const container = makeContainerWithTagUpdate({
        updateDetectedAt,
        result: { tag: '1.1.0', publishedAt, publishedAtTrusted: true },
        updatePolicy: { maturityMode: 'mature', maturityMinAgeDays: 7 },
      });
      const result = computeUpdateEligibility(container, makeContext({ now: FIXED_NOW }));
      const blocker = result.blockers.find((b) => b.reason === 'maturity-not-reached');
      expect(blocker).toBeDefined();
    });

    test('ignores untrusted publishedAt and uses updateDetectedAt', () => {
      const trigger = makeTrigger();
      // publishedAt is old but trust=false → should fall back to updateDetectedAt (10 days) → pass
      const updateDetectedAt = new Date(FIXED_NOW - 10 * 24 * 60 * 60 * 1000).toISOString();
      const publishedAt = new Date(FIXED_NOW - 2 * 24 * 60 * 60 * 1000).toISOString();
      const container = makeContainerWithTagUpdate({
        updateDetectedAt,
        result: { tag: '1.1.0', publishedAt, publishedAtTrusted: false },
        updatePolicy: { maturityMode: 'mature', maturityMinAgeDays: 7 },
      });
      const result = computeUpdateEligibility(
        container,
        makeContext({ triggers: { 'docker.update': trigger as never }, now: FIXED_NOW }),
      );
      expect(result.blockers.find((b) => b.reason === 'maturity-not-reached')).toBeUndefined();
    });

    test('liftableAt uses trusted publishedAt as start when it is earlier than detectedAt', () => {
      // publishedAt is 2 days ago, detectedAt is 1 day ago; maturity start = publishedAt
      const publishedAt = new Date(FIXED_NOW - 2 * 24 * 60 * 60 * 1000).toISOString();
      const updateDetectedAt = new Date(FIXED_NOW - 1 * 24 * 60 * 60 * 1000).toISOString();
      const container = makeContainerWithTagUpdate({
        updateDetectedAt,
        result: { tag: '1.1.0', publishedAt, publishedAtTrusted: true },
        updatePolicy: { maturityMode: 'mature', maturityMinAgeDays: 7 },
      });
      const result = computeUpdateEligibility(container, makeContext({ now: FIXED_NOW }));
      const blocker = result.blockers.find((b) => b.reason === 'maturity-not-reached');
      expect(blocker).toBeDefined();
      const expectedLiftableAt = new Date(
        Date.parse(publishedAt) + 7 * 24 * 60 * 60 * 1000,
      ).toISOString();
      expect(blocker?.liftableAt).toBe(expectedLiftableAt);
    });
  });

  describe('no-update-trigger-configured', () => {
    test('emits blocker when no triggers provided', () => {
      const container = makeContainerWithTagUpdate();
      const result = computeUpdateEligibility(
        container,
        makeContext({
          triggers: undefined,
          now: FIXED_NOW,
        }),
      );
      const blocker = result.blockers.find((b) => b.reason === 'no-update-trigger-configured');
      expect(blocker).toBeDefined();
      expect(blocker?.actionable).toBe(true);
    });

    test('emits blocker when triggers is empty object', () => {
      const container = makeContainerWithTagUpdate();
      const result = computeUpdateEligibility(
        container,
        makeContext({
          triggers: {},
          now: FIXED_NOW,
        }),
      );
      const blocker = result.blockers.find((b) => b.reason === 'no-update-trigger-configured');
      expect(blocker).toBeDefined();
    });

    test('emits blocker when only non-docker triggers present', () => {
      const slackTrigger = {
        type: 'slack',
        agent: undefined,
        configuration: {},
        getId: () => 'slack.default',
        isTriggerIncluded: () => true,
        isTriggerExcluded: () => false,
      };
      const container = makeContainerWithTagUpdate();
      const result = computeUpdateEligibility(
        container,
        makeContext({
          triggers: { 'slack.default': slackTrigger as never },
          now: FIXED_NOW,
        }),
      );
      const blocker = result.blockers.find((b) => b.reason === 'no-update-trigger-configured');
      expect(blocker).toBeDefined();
    });
  });

  describe('threshold-not-reached', () => {
    test('defaults to all threshold when trigger has no configuration', () => {
      // Exercises t.configuration?.threshold ?? 'all' fallback
      const trigger = makeTrigger({ configuration: undefined as never });
      const container = makeContainerWithTagUpdate();
      const result = computeUpdateEligibility(
        container,
        makeContext({
          triggers: { 'docker.update': trigger as never },
          now: FIXED_NOW,
        }),
      );
      // 'all' threshold passes every update
      expect(result.blockers.find((b) => b.reason === 'threshold-not-reached')).toBeUndefined();
    });

    test('message uses kind when semverDiff is undefined', () => {
      // Exercises: semverDiff ?? kind ?? 'unknown' → uses kind when semverDiff is undefined
      // 'digest' threshold rejects a tag update (kind='tag', semverDiff=undefined)
      const trigger = makeTrigger({ configuration: { threshold: 'digest' } });
      const container = makeContainerWithTagUpdate({
        updateKind: {
          kind: 'tag' as never,
          localValue: '1.0',
          remoteValue: '2.0',
          semverDiff: undefined as never,
        },
      });
      const result = computeUpdateEligibility(
        container,
        makeContext({
          triggers: { 'docker.update': trigger as never },
          now: FIXED_NOW,
        }),
      );
      const blocker = result.blockers.find((b) => b.reason === 'threshold-not-reached');
      expect(blocker).toBeDefined();
      expect(blocker?.message).toContain('tag');
    });

    test('message uses unknown when both semverDiff and kind are undefined', () => {
      // Exercises: semverDiff ?? kind ?? 'unknown' → uses 'unknown' when both are undefined
      // 'digest' threshold rejects an update with undefined kind
      const trigger = makeTrigger({ configuration: { threshold: 'digest' } });
      const container = makeContainer({
        image: { ...BASE_IMAGE, tag: { value: '1.0.0', semver: true } },
        result: { tag: '2.0.0' },
        updateKind: {
          kind: undefined as never,
          localValue: '1.0',
          remoteValue: '2.0',
          semverDiff: undefined as never,
        },
      });
      const result = computeUpdateEligibility(
        container,
        makeContext({
          triggers: { 'docker.update': trigger as never },
          now: FIXED_NOW,
        }),
      );
      const blocker = result.blockers.find((b) => b.reason === 'threshold-not-reached');
      expect(blocker).toBeDefined();
      expect(blocker?.message).toContain('unknown');
    });

    test('emits blocker when trigger threshold is major-only and update is minor', () => {
      // 'major-only' predicate: semverDiff === 'major' — blocks minor updates
      const trigger = makeTrigger({ configuration: { threshold: 'major-only' } });
      const container = makeContainerWithTagUpdate({
        updateKind: { kind: 'tag', localValue: '1.0.0', remoteValue: '1.1.0', semverDiff: 'minor' },
      });
      const result = computeUpdateEligibility(
        container,
        makeContext({
          triggers: { 'docker.update': trigger as never },
          now: FIXED_NOW,
        }),
      );
      const blocker = result.blockers.find((b) => b.reason === 'threshold-not-reached');
      expect(blocker).toBeDefined();
      expect(blocker?.details?.threshold).toBe('major-only');
      expect(blocker?.actionable).toBe(true);
    });

    test('no blocker when threshold is all', () => {
      const trigger = makeTrigger({ configuration: { threshold: 'all' } });
      const container = makeContainerWithTagUpdate();
      const result = computeUpdateEligibility(
        container,
        makeContext({
          triggers: { 'docker.update': trigger as never },
          now: FIXED_NOW,
        }),
      );
      expect(result.blockers.find((b) => b.reason === 'threshold-not-reached')).toBeUndefined();
    });

    test('threshold message shows correct semverDiff', () => {
      // 'major-only' blocks minor updates — both threshold name and semverDiff appear in message
      const trigger = makeTrigger({ configuration: { threshold: 'major-only' } });
      const container = makeContainerWithTagUpdate({
        updateKind: { kind: 'tag', localValue: '1.0.0', remoteValue: '1.1.0', semverDiff: 'minor' },
      });
      const result = computeUpdateEligibility(
        container,
        makeContext({
          triggers: { 'docker.update': trigger as never },
          now: FIXED_NOW,
        }),
      );
      const blocker = result.blockers.find((b) => b.reason === 'threshold-not-reached');
      expect(blocker?.message).toContain('major-only');
      expect(blocker?.message).toContain('minor');
    });
  });

  describe('rollback-container', () => {
    test('emits blocker for rollback container name', () => {
      const trigger = makeTrigger();
      const container = makeContainerWithTagUpdate({ name: 'web-old-1713000000' });
      const result = computeUpdateEligibility(
        container,
        makeContext({
          triggers: { 'docker.update': trigger as never },
          now: FIXED_NOW,
        }),
      );
      const blocker = result.blockers.find((b) => b.reason === 'rollback-container');
      expect(blocker).toBeDefined();
      expect(blocker?.actionable).toBe(false);
    });

    test('no rollback blocker for normal container', () => {
      const trigger = makeTrigger();
      const container = makeContainerWithTagUpdate({ name: 'web' });
      const result = computeUpdateEligibility(
        container,
        makeContext({
          triggers: { 'docker.update': trigger as never },
          now: FIXED_NOW,
        }),
      );
      expect(result.blockers.find((b) => b.reason === 'rollback-container')).toBeUndefined();
    });
  });

  describe('trigger-excluded', () => {
    test('emits trigger-excluded when isTriggerExcluded returns true', () => {
      const trigger = makeTrigger({
        isTriggerExcluded: () => true,
        isTriggerIncluded: () => true,
      });
      const container = makeContainerWithTagUpdate({
        actionTriggerExclude: 'docker.update',
      });
      const result = computeUpdateEligibility(
        container,
        makeContext({
          triggers: { 'docker.update': trigger as never },
          now: FIXED_NOW,
        }),
      );
      const blocker = result.blockers.find((b) => b.reason === 'trigger-excluded');
      expect(blocker).toBeDefined();
      expect(blocker?.details?.triggerExclude).toBe('docker.update');
    });

    test('reads the action-scoped exclude, never the deprecated mirror (#494)', () => {
      const isTriggerExcluded = vi.fn().mockReturnValue(false);
      const trigger = makeTrigger({
        isTriggerExcluded,
        isTriggerIncluded: () => true,
      });
      const container = makeContainerWithTagUpdate({
        triggerExclude: 'docker.update',
        notificationTriggerExclude: 'docker.update',
      });

      const result = computeUpdateEligibility(
        container,
        makeContext({
          triggers: { 'docker.update': trigger as never },
          now: FIXED_NOW,
        }),
      );

      expect(isTriggerExcluded).toHaveBeenCalledWith(container, undefined);
      expect(result.blockers.find((b) => b.reason === 'trigger-excluded')).toBeUndefined();
    });
  });

  describe('trigger-not-included', () => {
    test('emits trigger-not-included when isTriggerIncluded returns false and not excluded', () => {
      const trigger = makeTrigger({
        isTriggerExcluded: () => false,
        isTriggerIncluded: () => false,
      });
      const container = makeContainerWithTagUpdate({
        actionTriggerInclude: 'other.trigger',
      });
      const result = computeUpdateEligibility(
        container,
        makeContext({
          triggers: { 'docker.update': trigger as never },
          now: FIXED_NOW,
        }),
      );
      const blocker = result.blockers.find((b) => b.reason === 'trigger-not-included');
      expect(blocker).toBeDefined();
      expect(blocker?.details?.triggerInclude).toBe('other.trigger');
    });

    test('reads the action-scoped include, never the deprecated mirror (#494)', () => {
      const isTriggerIncluded = vi.fn().mockReturnValue(true);
      const trigger = makeTrigger({
        isTriggerExcluded: () => false,
        isTriggerIncluded,
      });
      const container = makeContainerWithTagUpdate({
        triggerInclude: 'slack.alert',
        notificationTriggerInclude: 'slack.alert',
      });

      const result = computeUpdateEligibility(
        container,
        makeContext({
          triggers: { 'docker.update': trigger as never },
          now: FIXED_NOW,
        }),
      );

      expect(isTriggerIncluded).toHaveBeenCalledWith(container, undefined);
      expect(result.blockers.find((b) => b.reason === 'trigger-not-included')).toBeUndefined();
    });

    test('trigger-excluded takes precedence over trigger-not-included', () => {
      const trigger = makeTrigger({
        isTriggerExcluded: () => true,
        isTriggerIncluded: () => false,
      });
      const container = makeContainerWithTagUpdate({
        triggerExclude: 'docker.update',
        triggerInclude: 'other',
      });
      const result = computeUpdateEligibility(
        container,
        makeContext({
          triggers: { 'docker.update': trigger as never },
          now: FIXED_NOW,
        }),
      );
      expect(result.blockers.find((b) => b.reason === 'trigger-excluded')).toBeDefined();
      expect(result.blockers.find((b) => b.reason === 'trigger-not-included')).toBeUndefined();
    });
  });

  describe('agent-mismatch', () => {
    test('message uses <none> for triggerAgent when trigger has no agent (trigger side)', () => {
      // trigger.agent=undefined → triggerAgent ?? '<none>' = '<none>'
      const trigger = makeTrigger({ agent: undefined, getId: undefined as never });
      const container = makeContainerWithTagUpdate({ agent: 'agent-x' });
      const result = computeUpdateEligibility(
        container,
        makeContext({
          triggers: { 'docker.update': trigger as never },
          now: FIXED_NOW,
        }),
      );
      const blocker = result.blockers.find((b) => b.reason === 'agent-mismatch');
      expect(blocker?.message).toContain("'<none>'");
      expect(blocker?.details?.triggerAgent).toBeUndefined();
    });

    test('message uses <none> for containerAgent when container has no agent', () => {
      // trigger.agent='agent-a', container.agent=undefined → container.agent ?? '<none>' = '<none>'
      const trigger = makeTrigger({ agent: 'agent-a' });
      const container = makeContainerWithTagUpdate(); // no agent property
      const result = computeUpdateEligibility(
        container,
        makeContext({
          triggers: { 'docker.update': trigger as never },
          now: FIXED_NOW,
        }),
      );
      const blocker = result.blockers.find((b) => b.reason === 'agent-mismatch');
      expect(blocker).toBeDefined();
      expect(blocker?.details?.containerAgent).toBeUndefined();
      expect(blocker?.message).toContain("'<none>'");
    });

    test('emits blocker when trigger.agent does not match container.agent', () => {
      const trigger = makeTrigger({ agent: 'agent-a' });
      const container = makeContainerWithTagUpdate({ agent: 'agent-b' });
      const result = computeUpdateEligibility(
        container,
        makeContext({
          triggers: { 'docker.update': trigger as never },
          now: FIXED_NOW,
        }),
      );
      const blocker = result.blockers.find((b) => b.reason === 'agent-mismatch');
      expect(blocker).toBeDefined();
      expect(blocker?.details?.triggerAgent).toBe('agent-a');
      expect(blocker?.details?.containerAgent).toBe('agent-b');
      expect(blocker?.actionable).toBe(true);
    });

    test('type-only lookup handles trigger with undefined type', () => {
      // Exercises: (trigger.type ?? '') — the ?? '' branch when type is undefined
      // A trigger with no type won't match DOCKER_TRIGGER_TYPES → no-update-trigger-configured
      const triggerNoType = {
        agent: undefined,
        configuration: {},
        getId: () => 'unknown.x',
        isTriggerIncluded: () => true,
        isTriggerExcluded: () => false,
      };
      const container = makeContainerWithTagUpdate();
      const result = computeUpdateEligibility(
        container,
        makeContext({
          triggers: { 'unknown.x': triggerNoType as never },
          now: FIXED_NOW,
        }),
      );
      // trigger has no type, can't be recognized as docker → no-update-trigger-configured
      expect(
        result.blockers.find((b) => b.reason === 'no-update-trigger-configured'),
      ).toBeDefined();
    });

    test('emits blocker when trigger has no agent and container is on a remote agent', () => {
      // trigger.agent=undefined + container.agent set → isTriggerAgentCompatible returns false
      // → type-only path detects agent-mismatch
      const trigger = makeTrigger({ agent: undefined });
      const container = makeContainerWithTagUpdate({ agent: 'agent-b' });
      const result = computeUpdateEligibility(
        container,
        makeContext({
          triggers: { 'docker.update': trigger as never },
          now: FIXED_NOW,
        }),
      );
      const blocker = result.blockers.find((b) => b.reason === 'agent-mismatch');
      expect(blocker).toBeDefined();
    });

    test('no blocker when trigger.agent matches container.agent', () => {
      const trigger = makeTrigger({ agent: 'agent-a' });
      const container = makeContainerWithTagUpdate({ agent: 'agent-a' });
      const result = computeUpdateEligibility(
        container,
        makeContext({
          triggers: { 'docker.update': trigger as never },
          now: FIXED_NOW,
        }),
      );
      expect(result.blockers.find((b) => b.reason === 'agent-mismatch')).toBeUndefined();
    });

    test('no blocker when trigger has no agent and container has no agent', () => {
      const trigger = makeTrigger({ agent: undefined });
      const container = makeContainerWithTagUpdate();
      const result = computeUpdateEligibility(
        container,
        makeContext({
          triggers: { 'docker.update': trigger as never },
          now: FIXED_NOW,
        }),
      );
      expect(result.blockers.find((b) => b.reason === 'agent-mismatch')).toBeUndefined();
    });
  });

  describe('active-operation', () => {
    test('emits blocker when getActiveOperation returns in-progress', () => {
      const trigger = makeTrigger();
      const container = makeContainerWithTagUpdate();
      const result = computeUpdateEligibility(
        container,
        makeContext({
          triggers: { 'docker.update': trigger as never },
          getActiveOperation: () => ({ id: 'op-1', status: 'in-progress' }),
          now: FIXED_NOW,
        }),
      );
      const blocker = result.blockers.find((b) => b.reason === 'active-operation');
      expect(blocker).toBeDefined();
      expect(blocker?.message).toContain('in progress');
      expect(blocker?.actionable).toBe(false);
      expect(blocker?.details?.status).toBe('in-progress');
    });

    test('emits blocker with queued message when status is queued', () => {
      const trigger = makeTrigger();
      const container = makeContainerWithTagUpdate();
      const result = computeUpdateEligibility(
        container,
        makeContext({
          triggers: { 'docker.update': trigger as never },
          getActiveOperation: () => ({ id: 'op-1', status: 'queued' }),
          now: FIXED_NOW,
        }),
      );
      const blocker = result.blockers.find((b) => b.reason === 'active-operation');
      expect(blocker?.message).toContain('queued');
    });

    test('no blocker when no active operation', () => {
      const trigger = makeTrigger();
      const container = makeContainerWithTagUpdate();
      const result = computeUpdateEligibility(
        container,
        makeContext({
          triggers: { 'docker.update': trigger as never },
          getActiveOperation: () => undefined,
          now: FIXED_NOW,
        }),
      );
      expect(result.blockers.find((b) => b.reason === 'active-operation')).toBeUndefined();
    });
  });

  describe('precedence ordering', () => {
    test('security-scan-blocked appears before snoozed', () => {
      const snoozeUntil = '2030-01-01T00:00:00.000Z';
      const container = makeContainerWithTagUpdate({
        security: {
          updateScan: {
            scanner: 'trivy',
            image: 'nginx:1.1.0',
            scannedAt: new Date().toISOString(),
            status: 'blocked',
            blockSeverities: ['CRITICAL'],
            blockingCount: 1,
            summary: { unknown: 0, low: 0, medium: 0, high: 0, critical: 1 },
            vulnerabilities: [],
          },
        },
        updatePolicy: { snoozeUntil },
      });
      const result = computeUpdateEligibility(container, makeContext({ now: FIXED_NOW }));
      expect(result.blockers[0].reason).toBe('security-scan-blocked');
      expect(result.blockers[1].reason).toBe('snoozed');
    });

    test('snoozed appears before skip-tag', () => {
      const snoozeUntil = '2030-01-01T00:00:00.000Z';
      const container = makeContainerWithTagUpdate({
        updatePolicy: { snoozeUntil, skipTags: ['1.1.0'] },
      });
      const result = computeUpdateEligibility(container, makeContext({ now: FIXED_NOW }));
      const reasons = result.blockers.map((b) => b.reason);
      expect(reasons.indexOf('snoozed')).toBeLessThan(reasons.indexOf('skip-tag'));
    });

    test('no-update-trigger-configured appears before active-operation', () => {
      const container = makeContainerWithTagUpdate();
      const result = computeUpdateEligibility(
        container,
        makeContext({
          triggers: undefined,
          getActiveOperation: () => ({ id: 'op-1', status: 'queued' }),
          now: FIXED_NOW,
        }),
      );
      const reasons = result.blockers.map((b) => b.reason);
      expect(reasons.indexOf('no-update-trigger-configured')).toBeLessThan(
        reasons.indexOf('active-operation'),
      );
    });

    test('multiple blockers all reported', () => {
      const snoozeUntil = '2030-01-01T00:00:00.000Z';
      const updateDetectedAt = new Date(FIXED_NOW - 2 * 24 * 60 * 60 * 1000).toISOString();
      const container = makeContainerWithTagUpdate({
        updateDetectedAt,
        updatePolicy: {
          snoozeUntil,
          maturityMode: 'mature',
          maturityMinAgeDays: 7,
          skipTags: ['1.1.0'],
        },
      });
      const result = computeUpdateEligibility(container, makeContext({ now: FIXED_NOW }));
      const reasons = result.blockers.map((b) => b.reason);
      expect(reasons).toContain('snoozed');
      expect(reasons).toContain('skip-tag');
      expect(reasons).toContain('maturity-not-reached');
      expect(result.eligible).toBe(false);
    });
  });

  describe('severity tagging', () => {
    test('every BLOCKER_SEVERITY entry classifies the reason as hard or soft', () => {
      const allReasons = [
        'no-update-available',
        'rollback-container',
        'active-operation',
        'security-scan-blocked',
        'last-update-rolled-back',
        'snoozed',
        'skip-tag',
        'skip-digest',
        'maturity-not-reached',
        'threshold-not-reached',
        'trigger-excluded',
        'trigger-not-included',
        'agent-mismatch',
        'no-update-trigger-configured',
        'maintenance-window-closed',
      ] as const;
      for (const reason of allReasons) {
        expect(BLOCKER_SEVERITY[reason]).toMatch(/^(hard|soft)$/);
      }
    });

    test('hard severities cover server-rejected reasons', () => {
      expect(BLOCKER_SEVERITY['no-update-available']).toBe('hard');
      expect(BLOCKER_SEVERITY['rollback-container']).toBe('hard');
      expect(BLOCKER_SEVERITY['active-operation']).toBe('hard');
      expect(BLOCKER_SEVERITY['security-scan-blocked']).toBe('hard');
      expect(BLOCKER_SEVERITY['last-update-rolled-back']).toBe('hard');
      expect(BLOCKER_SEVERITY['agent-mismatch']).toBe('hard');
      expect(BLOCKER_SEVERITY['no-update-trigger-configured']).toBe('hard');
    });

    test('soft severities cover policy reasons that manual update bypasses', () => {
      expect(BLOCKER_SEVERITY.snoozed).toBe('soft');
      expect(BLOCKER_SEVERITY['skip-tag']).toBe('soft');
      expect(BLOCKER_SEVERITY['skip-digest']).toBe('soft');
      expect(BLOCKER_SEVERITY['maturity-not-reached']).toBe('soft');
      expect(BLOCKER_SEVERITY['threshold-not-reached']).toBe('soft');
      // trigger-excluded / trigger-not-included are soft until v1.7.0 — see DEPRECATIONS.md
      expect(BLOCKER_SEVERITY['trigger-excluded']).toBe('soft');
      expect(BLOCKER_SEVERITY['trigger-not-included']).toBe('soft');
    });

    test('computeUpdateEligibility stamps severity on every emitted blocker', () => {
      const trigger = makeTrigger();
      const container = makeContainerWithTagUpdate({
        updatePolicy: {
          snoozeUntil: '2099-01-01T00:00:00.000Z',
        },
      } as Partial<Container>);

      const result = computeUpdateEligibility(
        container,
        makeContext({
          now: FIXED_NOW,
          triggers: { 'docker.update': trigger as any },
        }),
      );

      expect(result.blockers.length).toBeGreaterThan(0);
      for (const blocker of result.blockers) {
        expect(blocker.severity).toBe(BLOCKER_SEVERITY[blocker.reason]);
      }
    });
  });

  describe('helpers', () => {
    test('hasHardBlocker / getHardBlockers / getPrimaryHardBlocker pick out hard reasons', () => {
      const trigger = makeTrigger({ agent: 'edge-1' });
      const container = makeContainerWithTagUpdate({
        agent: 'edge-2',
        updatePolicy: { snoozeUntil: '2099-01-01T00:00:00.000Z' },
      } as Partial<Container>);
      const result = computeUpdateEligibility(
        container,
        makeContext({ now: FIXED_NOW, triggers: { 'docker.update': trigger as any } }),
      );

      expect(hasHardBlocker(result)).toBe(true);
      const hard = getHardBlockers(result);
      expect(hard.map((b) => b.reason)).toContain('agent-mismatch');
      const soft = getSoftBlockers(result);
      expect(soft.map((b) => b.reason)).toContain('snoozed');
      const primary = getPrimaryHardBlocker(result);
      expect(primary?.reason).toBe('agent-mismatch');
    });

    test('helpers return empty when eligibility is undefined', () => {
      expect(hasHardBlocker(undefined)).toBe(false);
      expect(getHardBlockers(undefined)).toEqual([]);
      expect(getSoftBlockers(undefined)).toEqual([]);
      expect(getPrimaryHardBlocker(undefined)).toBeUndefined();
    });

    test('helpers return empty when eligibility has only soft blockers', () => {
      const trigger = makeTrigger();
      const container = makeContainerWithTagUpdate({
        updatePolicy: { snoozeUntil: '2099-01-01T00:00:00.000Z' },
      } as Partial<Container>);
      const result = computeUpdateEligibility(
        container,
        makeContext({ now: FIXED_NOW, triggers: { 'docker.update': trigger as any } }),
      );

      expect(hasHardBlocker(result)).toBe(false);
      expect(getHardBlockers(result)).toEqual([]);
      expect(getSoftBlockers(result).map((b) => b.reason)).toEqual(['snoozed']);
    });
  });
});

// ---------------------------------------------------------------------------
// isSelfContainerImage
// ---------------------------------------------------------------------------

describe('isSelfContainerImage', () => {
  test('returns true for exact "drydock" image name', () => {
    expect(isSelfContainerImage('drydock')).toBe(true);
  });

  test('returns true for image ending with "/drydock"', () => {
    expect(isSelfContainerImage('ghcr.io/nicholaswilde/drydock')).toBe(true);
    expect(isSelfContainerImage('foo/drydock')).toBe(true);
    expect(isSelfContainerImage('registry.example.com/team/drydock')).toBe(true);
  });

  test('returns false for names that do not match', () => {
    expect(isSelfContainerImage('nginx')).toBe(false);
    expect(isSelfContainerImage('drydock-agent')).toBe(false);
    expect(isSelfContainerImage('mydrydock')).toBe(false);
    expect(isSelfContainerImage('foo/drydock-extra')).toBe(false);
  });

  test('returns false for undefined', () => {
    expect(isSelfContainerImage(undefined)).toBe(false);
  });

  test('returns false for empty string', () => {
    expect(isSelfContainerImage('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// self-update-unavailable blocker
// ---------------------------------------------------------------------------

describe('computeUpdateEligibility — self-update-unavailable', () => {
  // A self-container with a detected update
  function makeSelfContainer(overrides: Partial<Container> = {}): Container {
    return makeContainerWithTagUpdate({
      image: {
        id: 'img-drydock',
        registry: { name: 'hub', url: 'https://registry-1.docker.io' },
        name: 'drydock',
        tag: { value: '1.5.0', semver: true },
        digest: { watch: false },
        architecture: 'amd64',
        os: 'linux',
      },
      ...overrides,
    });
  }

  test('fires when self-container and isSelfUpdateAvailable === false', () => {
    const container = makeSelfContainer();
    const result = computeUpdateEligibility(
      container,
      makeContext({ isSelfUpdateAvailable: false }),
    );
    expect(result.blockers.some((b) => b.reason === 'self-update-unavailable')).toBe(true);
  });

  test('blocker has severity "hard"', () => {
    expect(BLOCKER_SEVERITY['self-update-unavailable']).toBe('hard');
    const container = makeSelfContainer();
    const result = computeUpdateEligibility(
      container,
      makeContext({ isSelfUpdateAvailable: false }),
    );
    const blocker = result.blockers.find((b) => b.reason === 'self-update-unavailable');
    expect(blocker?.severity).toBe('hard');
  });

  test('blocker is actionable and has actionHint', () => {
    const container = makeSelfContainer();
    const result = computeUpdateEligibility(
      container,
      makeContext({ isSelfUpdateAvailable: false }),
    );
    const blocker = result.blockers.find((b) => b.reason === 'self-update-unavailable');
    expect(blocker?.actionable).toBe(true);
    expect(typeof blocker?.actionHint).toBe('string');
    expect(blocker?.actionHint?.length).toBeGreaterThan(0);
  });

  test('does NOT fire when isSelfUpdateAvailable is undefined (fail-open)', () => {
    const container = makeSelfContainer();
    const result = computeUpdateEligibility(
      container,
      makeContext({ isSelfUpdateAvailable: undefined }),
    );
    expect(result.blockers.some((b) => b.reason === 'self-update-unavailable')).toBe(false);
  });

  test('does NOT fire when isSelfUpdateAvailable === true', () => {
    const container = makeSelfContainer();
    const result = computeUpdateEligibility(
      container,
      makeContext({ isSelfUpdateAvailable: true }),
    );
    expect(result.blockers.some((b) => b.reason === 'self-update-unavailable')).toBe(false);
  });

  test('does NOT fire when container is not a self-container (different image name)', () => {
    const container = makeContainerWithTagUpdate(); // nginx image
    const result = computeUpdateEligibility(
      container,
      makeContext({ isSelfUpdateAvailable: false }),
    );
    expect(result.blockers.some((b) => b.reason === 'self-update-unavailable')).toBe(false);
  });

  test('does NOT fire when isSelfUpdateAvailable is false but no update exists (short-circuit)', () => {
    // No result → hasRawTagOrDigestUpdate returns false → short-circuits with no-update-available
    const container = makeSelfContainer({ result: undefined });
    const result = computeUpdateEligibility(
      container,
      makeContext({ isSelfUpdateAvailable: false }),
    );
    expect(result.blockers).toHaveLength(1);
    expect(result.blockers[0].reason).toBe('no-update-available');
    expect(result.blockers.some((b) => b.reason === 'self-update-unavailable')).toBe(false);
  });

  test('fires for scoped image ending with /drydock', () => {
    const container = makeSelfContainer({
      image: {
        id: 'img-drydock',
        registry: { name: 'ghcr', url: 'https://ghcr.io' },
        name: 'nicholaswilde/drydock',
        tag: { value: '1.5.0', semver: true },
        digest: { watch: false },
        architecture: 'amd64',
        os: 'linux',
      },
    });
    const result = computeUpdateEligibility(
      container,
      makeContext({ isSelfUpdateAvailable: false }),
    );
    expect(result.blockers.some((b) => b.reason === 'self-update-unavailable')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// maintenance-window-closed blocker
// ---------------------------------------------------------------------------

describe('computeUpdateEligibility — maintenance-window-closed', () => {
  test('emits blocker when maintenanceWindowOpen is false (auto-update path)', () => {
    const trigger = makeTrigger();
    const container = makeContainerWithTagUpdate();
    const result = computeUpdateEligibility(
      container,
      makeContext({
        triggers: { 'docker.update': trigger as never },
        maintenanceWindowOpen: false,
        now: FIXED_NOW,
      }),
    );
    const blocker = result.blockers.find((b) => b.reason === 'maintenance-window-closed');
    expect(blocker).toBeDefined();
    expect(blocker?.actionable).toBe(false);
    expect(blocker?.message).toContain('maintenance window');
    expect(result.eligible).toBe(false);
  });

  test('blocker has severity "soft" — manual updates are not blocked', () => {
    expect(BLOCKER_SEVERITY['maintenance-window-closed']).toBe('soft');
    const trigger = makeTrigger();
    const container = makeContainerWithTagUpdate();
    const result = computeUpdateEligibility(
      container,
      makeContext({
        triggers: { 'docker.update': trigger as never },
        maintenanceWindowOpen: false,
        now: FIXED_NOW,
      }),
    );
    const blocker = result.blockers.find((b) => b.reason === 'maintenance-window-closed');
    expect(blocker?.severity).toBe('soft');
  });

  test('no blocker when maintenanceWindowOpen is true', () => {
    const trigger = makeTrigger();
    const container = makeContainerWithTagUpdate();
    const result = computeUpdateEligibility(
      container,
      makeContext({
        triggers: { 'docker.update': trigger as never },
        maintenanceWindowOpen: true,
        now: FIXED_NOW,
      }),
    );
    expect(result.blockers.find((b) => b.reason === 'maintenance-window-closed')).toBeUndefined();
    expect(result.eligible).toBe(true);
  });

  test('no blocker when maintenanceWindowOpen is undefined (manual update path — fail open)', () => {
    const trigger = makeTrigger();
    const container = makeContainerWithTagUpdate();
    const result = computeUpdateEligibility(
      container,
      makeContext({
        triggers: { 'docker.update': trigger as never },
        maintenanceWindowOpen: undefined,
        now: FIXED_NOW,
      }),
    );
    expect(result.blockers.find((b) => b.reason === 'maintenance-window-closed')).toBeUndefined();
    expect(result.eligible).toBe(true);
  });

  test('maintenance-window-closed does not appear when no update exists (short-circuit)', () => {
    // no-update-available short-circuit fires first
    const container = makeContainer();
    const result = computeUpdateEligibility(
      container,
      makeContext({ maintenanceWindowOpen: false, now: FIXED_NOW }),
    );
    expect(result.blockers).toHaveLength(1);
    expect(result.blockers[0].reason).toBe('no-update-available');
    expect(result.blockers.find((b) => b.reason === 'maintenance-window-closed')).toBeUndefined();
  });
});
