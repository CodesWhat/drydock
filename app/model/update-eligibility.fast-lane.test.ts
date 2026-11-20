import type { Container } from './container.js';
import { computeUpdateEligibility, type UpdateEligibilityContext } from './update-eligibility.js';

const FIXED_NOW = new Date('2026-04-23T12:00:00.000Z').getTime();
const FAST_LANE = { fixedIds: ['CVE-1'], fixedCount: 1, fixedCritical: 1, fixedHigh: 0 };

function makeTrigger(threshold = 'all') {
  return {
    type: 'docker',
    agent: undefined,
    configuration: { threshold },
    getId: () => 'docker.update',
  };
}

function makeContainer(overrides: Partial<Container> = {}): Container {
  return {
    id: 'c1',
    name: 'web',
    watcher: 'local',
    image: {
      id: 'img-1',
      registry: { name: 'hub', url: 'https://registry-1.docker.io' },
      name: 'nginx',
      tag: { value: '1.0.0', semver: true },
      digest: { watch: false },
      architecture: 'amd64',
      os: 'linux',
    },
    result: { tag: '1.0.1' },
    updateAvailable: false,
    updateKind: { kind: 'tag', localValue: '1.0.0', remoteValue: '1.0.1', semverDiff: 'patch' },
    securityFastLane: FAST_LANE,
    ...overrides,
  } as unknown as Container;
}

function context(overrides: Partial<UpdateEligibilityContext> = {}): UpdateEligibilityContext {
  return {
    triggers: { 'docker.update': makeTrigger() as never },
    getActiveOperation: () => undefined,
    now: FIXED_NOW,
    ...overrides,
  };
}

const reasons = (result: ReturnType<typeof computeUpdateEligibility>) =>
  result.blockers.map((blocker) => blocker.reason);

describe('security fast lane eligibility', () => {
  test('without the flag a snoozed, immature candidate in a closed window is held', () => {
    const container = makeContainer({
      securityFastLane: undefined,
      updatePolicy: { snoozeUntil: '2030-01-01T00:00:00.000Z', maturityMode: 'mature' },
      updateDetectedAt: new Date(FIXED_NOW - 1000).toISOString(),
    });
    const result = computeUpdateEligibility(container, context({ maintenanceWindowOpen: false }));
    expect(reasons(result)).toStrictEqual([
      'maintenance-window-closed',
      'snoozed',
      'maturity-not-reached',
    ]);
    expect(result.securityFastLane).toBeUndefined();
  });

  test('bypasses the maturity min-age hold and names it', () => {
    const container = makeContainer({
      updatePolicy: { maturityMode: 'mature', maturityMinAgeDays: 7 },
      updateDetectedAt: new Date(FIXED_NOW - 1000).toISOString(),
    });
    const result = computeUpdateEligibility(container, context());
    expect(result.eligible).toBe(true);
    expect(result.blockers).toStrictEqual([]);
    expect(result.securityFastLane).toStrictEqual({
      ...FAST_LANE,
      bypassedHolds: ['maturity-not-reached'],
    });
  });

  test('bypasses the release-count maturity hold', () => {
    const container = makeContainer({
      updateDetectedAt: new Date(FIXED_NOW - 20 * 86_400_000).toISOString(),
      updatePolicy: { maturityMode: 'mature', maturityMinAgeDays: 5, maturitySkipReleases: 3 },
    });
    const result = computeUpdateEligibility(container, context());
    expect(result.eligible).toBe(true);
    expect(result.securityFastLane?.bypassedHolds).toStrictEqual(['maturity-releases-not-reached']);
  });

  test('bypasses an active snooze', () => {
    const container = makeContainer({ updatePolicy: { snoozeUntil: '2030-01-01T00:00:00.000Z' } });
    const result = computeUpdateEligibility(container, context());
    expect(result.eligible).toBe(true);
    expect(result.securityFastLane?.bypassedHolds).toStrictEqual(['snoozed']);
  });

  test('bypasses a closed maintenance window', () => {
    const result = computeUpdateEligibility(
      makeContainer(),
      context({ maintenanceWindowOpen: false }),
    );
    expect(result.eligible).toBe(true);
    expect(result.securityFastLane?.bypassedHolds).toStrictEqual(['maintenance-window-closed']);
  });

  test('reports an empty bypass list when nothing was holding the candidate', () => {
    const result = computeUpdateEligibility(makeContainer(), context());
    expect(result.eligible).toBe(true);
    expect(result.securityFastLane).toStrictEqual({ ...FAST_LANE, bypassedHolds: [] });
  });

  test('does not bypass dd.action.exclude', () => {
    const container = makeContainer({
      actionTriggerExclude: 'docker.update',
      updatePolicy: { snoozeUntil: '2030-01-01T00:00:00.000Z' },
    });
    const result = computeUpdateEligibility(container, context());
    expect(result.eligible).toBe(false);
    expect(reasons(result)).toStrictEqual(['trigger-excluded']);
  });

  test('does not bypass the trigger threshold', () => {
    const result = computeUpdateEligibility(
      makeContainer(),
      context({ triggers: { 'docker.update': makeTrigger('major-only') as never } }),
    );
    expect(reasons(result)).toStrictEqual(['threshold-not-reached']);
  });

  test('does not bypass skip-tag or skip-digest entries', () => {
    const tag = computeUpdateEligibility(
      makeContainer({ updatePolicy: { skipTags: ['1.0.1'] } }),
      context(),
    );
    expect(reasons(tag)).toStrictEqual(['skip-tag']);
    const digest = computeUpdateEligibility(
      makeContainer({
        image: {
          ...makeContainer().image,
          digest: { watch: true, value: 'sha256:aaa' },
        },
        result: { tag: '1.0.0', digest: 'sha256:bbb' },
        updatePolicy: { skipDigests: ['sha256:bbb'] },
      } as never),
      context(),
    );
    expect(reasons(digest)).toContain('skip-digest');
  });

  test('does not bypass a rolled-back candidate or an active operation', () => {
    const container = makeContainer({
      updateRollback: {
        recordedAt: '2026-04-01T00:00:00.000Z',
        targetDigest: '1.0.1',
        reason: 'unhealthy',
        lastError: '',
      },
    });
    const result = computeUpdateEligibility(
      container,
      context({ getActiveOperation: () => ({ id: 'op', status: 'queued' }) }),
    );
    expect(reasons(result)).toStrictEqual(['last-update-rolled-back', 'active-operation']);
  });

  test('does not bypass a missing update trigger', () => {
    const result = computeUpdateEligibility(makeContainer(), context({ triggers: {} }));
    expect(reasons(result)).toStrictEqual(['no-update-trigger-configured']);
  });

  test('does not bypass a group notify-only ceiling', () => {
    const container = makeContainer({
      groupPolicy: { group: 'prod', id: 'p1', actions: { updateMode: 'notify' } },
    } as never);
    expect(reasons(computeUpdateEligibility(container, context()))).toStrictEqual([
      'group-notify-only',
    ]);
  });

  test('a blocked updateScan on the candidate still blocks', () => {
    const container = makeContainer({
      security: {
        updateScan: {
          status: 'blocked',
          image: 'nginx:1.0.1',
          summary: {},
          vulnerabilities: [],
        },
      },
    } as never);
    expect(reasons(computeUpdateEligibility(container, context()))).toStrictEqual([
      'security-scan-blocked',
    ]);
  });

  describe('a blocked scan of the running image', () => {
    const security = (updateScan: Record<string, unknown>) =>
      ({
        scan: { status: 'blocked', image: 'nginx:1.0.0', summary: {}, vulnerabilities: [] },
        updateScan: { image: 'nginx:1.0.1', summary: {}, vulnerabilities: [], ...updateScan },
      }) as never;

    // The fast lane never lifts the scan gate: the candidate that will actually be deployed is
    // only known after the pull, so a passing scan taken beforehand is not enough to wave it through.
    test('still holds a fast-laned candidate whose own scan passed', () => {
      const result = computeUpdateEligibility(
        makeContainer({ security: security({ status: 'passed' }) }),
        context(),
      );
      expect(reasons(result)).toStrictEqual(['security-scan-blocked']);
    });

    test('is still lifted by the relative gate, as before', () => {
      const result = computeUpdateEligibility(
        makeContainer({
          securityFastLane: undefined,
          security: security({ status: 'passed', relativeGate: { decision: 'passed' } }),
        }),
        context(),
      );
      expect(result.eligible).toBe(true);
    });
  });
});
