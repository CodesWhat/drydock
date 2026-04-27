import type { Container } from './container.js';
import {
  BLOCKER_SEVERITY,
  computeUpdateEligibility,
  getHardBlockers,
  getPrimaryHardBlocker,
  getSoftBlockers,
  hasHardBlocker,
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
      expect(blocker?.actionHint).toBeTruthy();
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

    test('message uses singular "day" when exactly 1 day remains', () => {
      // Exercises: remainingDays !== 1 ? 's' : '' — the false branch (1 day remaining)
      // Detected 6 days ago, min age 7 days → exactly 1 day remaining
      const updateDetectedAt = new Date(FIXED_NOW - 6 * 24 * 60 * 60 * 1000).toISOString();
      const container = makeContainerWithTagUpdate({
        updateDetectedAt,
        updatePolicy: { maturityMode: 'mature', maturityMinAgeDays: 7 },
      });
      const result = computeUpdateEligibility(container, makeContext({ now: FIXED_NOW }));
      const blocker = result.blockers.find((b) => b.reason === 'maturity-not-reached');
      expect(blocker?.message).toContain('(1 day remaining)');
      expect(blocker?.message).not.toContain('1 days');
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
        triggerExclude: 'docker.update',
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
  });

  describe('trigger-not-included', () => {
    test('emits trigger-not-included when isTriggerIncluded returns false and not excluded', () => {
      const trigger = makeTrigger({
        isTriggerExcluded: () => false,
        isTriggerIncluded: () => false,
      });
      const container = makeContainerWithTagUpdate({
        triggerInclude: 'other.trigger',
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
        'snoozed',
        'skip-tag',
        'skip-digest',
        'maturity-not-reached',
        'threshold-not-reached',
        'trigger-excluded',
        'trigger-not-included',
        'agent-mismatch',
        'no-update-trigger-configured',
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
