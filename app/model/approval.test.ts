/**
 * Tests for the pure approval-queue model (spec-ca-2-approval-queue.md, slice 1).
 *
 * The parametrised `shouldQueueForApproval` table is this slice's real deliverable:
 * the predicate is reasoned from 6.0.1's resolver rather than executed, and the two
 * mode-flip cases are what falsify it cheaply.
 */
import type { ActionPolicyTrigger } from './action-policy.js';
import {
  APPROVAL_SCHEMA_VERSION,
  type ApprovalRecord,
  buildApprovalRecordInput,
  classifyApprovalCandidate,
  getApprovalCandidateRef,
  isApprovalDeferred,
  isApprovalPending,
  isApprovalResolved,
  isAutoDispatchable,
  shouldQueueForApproval,
} from './approval.js';
import type { Container } from './container.js';

vi.mock('../agent/manager.js', () => ({
  getAgent: vi.fn(() => undefined),
}));

vi.mock('../log/index.js', () => ({
  default: {
    child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

type TriggerFixtureOptions = {
  auto?: ActionPolicyTrigger['configuration'] extends infer C
    ? C extends { auto?: infer A }
      ? A
      : never
    : never;
  id?: string;
  type?: string;
  agent?: string;
  threshold?: string;
};

function createTrigger(options: TriggerFixtureOptions = {}): Record<string, ActionPolicyTrigger> {
  const id = options.id ?? 'docker.local';
  return {
    [id]: {
      type: options.type ?? 'docker',
      ...(options.agent !== undefined ? { agent: options.agent } : {}),
      configuration: {
        auto: options.auto ?? 'none',
        ...(options.threshold !== undefined ? { threshold: options.threshold } : {}),
      },
      getId: () => id,
    } as unknown as ActionPolicyTrigger,
  };
}

function createContainer(overrides: Partial<Container> = {}): Container {
  return {
    id: 'container-1',
    name: 'nginx',
    displayName: 'nginx',
    displayIcon: 'icon',
    status: 'running',
    watcher: 'local',
    image: {
      id: 'image-1',
      registry: { name: 'hub', url: 'https://hub' },
      name: 'library/nginx',
      tag: { value: '1.2.3', semver: true },
      digest: { watch: false },
      architecture: 'amd64',
      os: 'linux',
    },
    result: { tag: '1.2.4' },
    updateAvailable: true,
    updateKind: {
      kind: 'tag',
      localValue: '1.2.3',
      remoteValue: '1.2.4',
      semverDiff: 'patch',
    },
    ...overrides,
  } as Container;
}

describe('shouldQueueForApproval', () => {
  test('returns false when the container carries no raw update candidate', () => {
    const container = createContainer({
      result: { tag: '1.2.3' },
      updateKind: { kind: 'unknown' },
    });

    expect(shouldQueueForApproval(container, createTrigger(), 'manual')).toBe(false);
  });

  // Named falsifying test 1 (spec edge case 6/7 pair, residual-risk item 1).
  test('an auto-resolved container produces no row under updateMode auto', () => {
    const container = createContainer();
    const triggers = createTrigger({ auto: 'all' });

    expect(shouldQueueForApproval(container, triggers, 'auto')).toBe(false);
  });

  // Named falsifying test 2 (spec edge case 7).
  test('mode flip auto to manual queues the previously auto-dispatched candidate', () => {
    const container = createContainer();
    const triggers = createTrigger({ auto: 'all' });

    expect(shouldQueueForApproval(container, triggers, 'auto')).toBe(false);
    expect(shouldQueueForApproval(container, triggers, 'manual')).toBe(true);
  });

  test('a manual-resolved container is queued even under updateMode auto', () => {
    const container = createContainer();
    const triggers = createTrigger({ auto: 'none' });

    expect(shouldQueueForApproval(container, triggers, 'auto')).toBe(true);
  });

  test('an onauto trigger without a matching auto label resolves manual and is queued under auto', () => {
    const container = createContainer({ actionTriggerInclude: 'docker.local' });
    const triggers = createTrigger({ auto: 'onauto' });

    expect(shouldQueueForApproval(container, triggers, 'auto')).toBe(true);
  });

  test('an onauto trigger with a matching auto label is auto-dispatchable and is not queued', () => {
    const container = createContainer({
      actionTriggerInclude: 'docker.local',
      actionTriggerAuto: 'docker.local',
    });
    const triggers = createTrigger({ auto: 'onauto' });

    expect(shouldQueueForApproval(container, triggers, 'auto')).toBe(false);
    expect(shouldQueueForApproval(container, triggers, 'manual')).toBe(true);
  });

  // Spec edge case 8.
  test.each([
    ['no compatible action trigger at all', undefined, {}],
    ['trigger-not-included', createTrigger({ auto: 'onauto' }), {} as Partial<Container>],
    [
      'trigger-excluded',
      createTrigger({ auto: 'all' }),
      { actionTriggerExclude: 'docker.local' } as Partial<Container>,
    ],
    [
      'agent-mismatch',
      createTrigger({ agent: 'edge-1' }),
      { agent: 'edge-2' } as Partial<Container>,
    ],
  ])('a hard-blocked container (%s) never produces a row', (_label, triggers, overrides) => {
    const container = createContainer(overrides as Partial<Container>);

    expect(shouldQueueForApproval(container, triggers, 'manual')).toBe(false);
  });

  // Spec edge case 13.
  test('the self-update-unavailable hard blocker gates the queue exactly as the Update button does', () => {
    const container = createContainer({
      image: {
        ...createContainer().image,
        name: 'codeswhat/drydock',
      },
    });
    const triggers = createTrigger();

    expect(
      shouldQueueForApproval(container, triggers, 'manual', { isSelfUpdateAvailable: false }),
    ).toBe(false);
    expect(
      shouldQueueForApproval(container, triggers, 'manual', { isSelfUpdateAvailable: true }),
    ).toBe(true);
  });

  // Spec edge case 9 — the whole reason the predicate reads hasRawUpdate.
  test.each([
    [
      'snoozed',
      { updatePolicy: { snoozeUntil: '2999-01-01T00:00:00.000Z' } } as Partial<Container>,
    ],
    ['skip-tag', { updatePolicy: { skipTags: ['1.2.4'] } } as Partial<Container>],
    [
      'maturity-not-reached',
      {
        updatePolicy: { maturityMode: 'mature' as const, maturityMinAgeDays: 30 },
      } as Partial<Container>,
    ],
  ])('a soft-blocked container (%s) still produces a row', (_label, overrides) => {
    const container = createContainer(overrides);

    expect(shouldQueueForApproval(container, createTrigger(), 'manual')).toBe(true);
  });

  test('a threshold-filtered candidate is soft-blocked and still produces a row', () => {
    const container = createContainer({
      updateKind: { kind: 'tag', localValue: '1.2.3', remoteValue: '2.0.0', semverDiff: 'major' },
      result: { tag: '2.0.0' },
    });

    expect(shouldQueueForApproval(container, createTrigger({ threshold: 'minor' }), 'manual')).toBe(
      true,
    );
  });

  test('an in-flight update operation does not suppress the row', () => {
    const container = createContainer({
      updateOperation: { id: 'op-1', status: 'in-progress' },
    } as Partial<Container>);

    expect(shouldQueueForApproval(container, createTrigger(), 'manual')).toBe(true);
  });

  // Spec "Done when" — every updateMode x action policy x blocker combination.
  describe('parametrised predicate table', () => {
    const actionPolicies = [
      { label: 'auto-resolved', triggers: createTrigger({ auto: 'all' }), overrides: {} },
      { label: 'manual-resolved', triggers: createTrigger({ auto: 'none' }), overrides: {} },
      { label: 'blocked', triggers: createTrigger({ auto: 'onauto' }), overrides: {} },
    ] as const;

    const blockerStates = [
      { label: 'clear', overrides: {} as Partial<Container> },
      {
        label: 'soft blocker',
        overrides: {
          updatePolicy: { snoozeUntil: '2999-01-01T00:00:00.000Z' },
        } as Partial<Container>,
      },
      {
        label: 'hard blocker',
        overrides: { actionTriggerExclude: 'docker.local' } as Partial<Container>,
      },
    ] as const;

    const cases = (['notify', 'manual', 'auto'] as const).flatMap((updateMode) =>
      actionPolicies.flatMap((actionPolicy) =>
        blockerStates.map((blockerState) => {
          const isHardBlocked =
            blockerState.label === 'hard blocker' || actionPolicy.label === 'blocked';
          const isAutoDispatchable =
            updateMode === 'auto' && actionPolicy.label === 'auto-resolved';
          return {
            updateMode,
            actionPolicy: actionPolicy.label,
            blockerState: blockerState.label,
            triggers: actionPolicy.triggers,
            overrides: { ...actionPolicy.overrides, ...blockerState.overrides },
            expected: !isHardBlocked && !isAutoDispatchable,
          };
        }),
      ),
    );

    test.each(cases)(
      'updateMode=$updateMode actionPolicy=$actionPolicy blockers=$blockerState -> $expected',
      ({ updateMode, triggers, overrides, expected }) => {
        expect(shouldQueueForApproval(createContainer(overrides), triggers, updateMode)).toBe(
          expected,
        );
      },
    );
  });
});

describe('isAutoDispatchable', () => {
  test.each(['notify', 'manual'] as const)(
    'is false under updateMode %s however the action policy resolves',
    (updateMode) => {
      expect(
        isAutoDispatchable(createContainer(), createTrigger({ auto: 'all' }), updateMode),
      ).toBe(false);
    },
  );

  test('is true only when the resolver returns an auto verdict under updateMode auto', () => {
    expect(isAutoDispatchable(createContainer(), createTrigger({ auto: 'all' }), 'auto')).toBe(
      true,
    );
    expect(isAutoDispatchable(createContainer(), createTrigger({ auto: 'none' }), 'auto')).toBe(
      false,
    );
  });

  test('is false when an explicit exclude wins the walk', () => {
    const container = createContainer({ actionTriggerExclude: 'docker.local' });

    expect(isAutoDispatchable(container, createTrigger({ auto: 'all' }), 'auto')).toBe(false);
  });
});

describe('classifyApprovalCandidate', () => {
  test('reads no-candidate when nothing newer was detected', () => {
    const container = createContainer({
      result: { tag: '1.2.3' },
      updateKind: { kind: 'unknown' },
    });

    expect(classifyApprovalCandidate(container, createTrigger(), 'manual')).toBe('no-candidate');
  });

  test('reads blocked for a hard blocker and queue once it lifts', () => {
    const container = createContainer({ actionTriggerExclude: 'docker.local' });

    expect(classifyApprovalCandidate(container, createTrigger({ auto: 'all' }), 'manual')).toBe(
      'blocked',
    );
    expect(classifyApprovalCandidate(createContainer(), createTrigger(), 'manual')).toBe('queue');
  });

  test('reads auto-dispatch only when the trigger path will apply the candidate itself', () => {
    const triggers = createTrigger({ auto: 'all' });

    expect(classifyApprovalCandidate(createContainer(), triggers, 'auto')).toBe('auto-dispatch');
    expect(classifyApprovalCandidate(createContainer(), triggers, 'manual')).toBe('queue');
  });

  // A hard blocker stops the auto path too, so calling this auto-dispatch would let the
  // reconciler resolve a live row as `auto-applied` for an update that never runs.
  test('a hard blocker outranks an auto resolution', () => {
    const container = createContainer({
      updateRollback: { targetDigest: '1.2.4', reason: 'health-gate' },
    } as Partial<Container>);
    const triggers = createTrigger({ auto: 'all' });

    expect(isAutoDispatchable(container, triggers, 'auto')).toBe(true);
    expect(classifyApprovalCandidate(container, triggers, 'auto')).toBe('blocked');
  });

  test('the self-update option reaches the eligibility context', () => {
    const container = createContainer({
      image: { ...createContainer().image, name: 'codeswhat/drydock' },
    });

    expect(
      classifyApprovalCandidate(container, createTrigger(), 'manual', {
        isSelfUpdateAvailable: false,
      }),
    ).toBe('blocked');
  });
});

describe('getApprovalCandidateRef', () => {
  test('prefers the candidate digest over the candidate tag', () => {
    const container = createContainer({ result: { tag: '1.2.4', digest: 'sha256:beef' } });

    expect(getApprovalCandidateRef(container)).toBe('sha256:beef');
  });

  test('falls back to the candidate tag', () => {
    expect(getApprovalCandidateRef(createContainer())).toBe('1.2.4');
  });

  test('returns undefined when the result carries neither a tag nor a digest', () => {
    const container = createContainer({ result: { created: '2026-01-01T00:00:00.000Z' } });

    expect(getApprovalCandidateRef(container)).toBeUndefined();
  });

  test('returns undefined when the container has no result at all', () => {
    const container = createContainer({ result: undefined });

    expect(getApprovalCandidateRef(container)).toBeUndefined();
  });
});

describe('buildApprovalRecordInput', () => {
  test('derives the flat record fields from the container', () => {
    const container = createContainer({
      agent: 'edge-1',
      result: {
        tag: '1.2.4',
        releaseNotes: {
          title: 'v1.2.4',
          body: 'notes',
          url: 'https://example.test/releases/1.2.4',
          publishedAt: '2026-01-01T00:00:00.000Z',
          provider: 'github',
        },
      },
      security: {
        updateScan: {
          scanner: 'trivy',
          image: 'library/nginx:1.2.4',
          scannedAt: '2026-02-02T03:04:05.000Z',
          status: 'passed',
          blockSeverities: [],
          blockingCount: 0,
          summary: { unknown: 1, low: 2, medium: 3, high: 4, critical: 5 },
          vulnerabilities: [],
        },
      },
    } as Partial<Container>);

    expect(buildApprovalRecordInput(container)).toStrictEqual({
      containerId: 'container-1',
      containerIdentityKey: 'edge-1::local::nginx',
      containerName: 'nginx',
      watcher: 'local',
      agent: 'edge-1',
      image: 'library/nginx',
      fromRef: '1.2.3',
      toRef: '1.2.4',
      candidateRef: '1.2.4',
      updateKind: 'tag',
      semverDiff: 'patch',
      releaseNotesUrl: 'https://example.test/releases/1.2.4',
      scanCritical: 5,
      scanHigh: 4,
      scanMedium: 3,
      scanLow: 2,
      scanUnknown: 1,
      scanAt: '2026-02-02T03:04:05.000Z',
    });
  });

  test('omits every optional field when the container carries none of them', () => {
    expect(buildApprovalRecordInput(createContainer())).toStrictEqual({
      containerId: 'container-1',
      containerIdentityKey: '::local::nginx',
      containerName: 'nginx',
      watcher: 'local',
      image: 'library/nginx',
      fromRef: '1.2.3',
      toRef: '1.2.4',
      candidateRef: '1.2.4',
      updateKind: 'tag',
      semverDiff: 'patch',
    });
  });

  test('carries digest refs for a digest-kind candidate', () => {
    const container = createContainer({
      image: {
        ...createContainer().image,
        digest: { watch: true, value: 'sha256:old' },
      },
      result: { tag: '1.2.3', digest: 'sha256:new' },
      updateKind: {
        kind: 'digest',
        localValue: 'sha256:old',
        remoteValue: 'sha256:new',
        semverDiff: 'unknown',
      },
    });

    expect(buildApprovalRecordInput(container)).toMatchObject({
      fromRef: 'sha256:old',
      toRef: 'sha256:new',
      candidateRef: 'sha256:new',
      updateKind: 'digest',
      semverDiff: 'unknown',
    });
  });

  // Spec edge case 10 (the #411 class of bug).
  test('same-named containers on two agents get distinct identity keys', () => {
    const first = buildApprovalRecordInput(createContainer({ agent: 'edge-1' }));
    const second = buildApprovalRecordInput(createContainer({ agent: 'edge-2' }));

    expect(first?.containerIdentityKey).toBe('edge-1::local::nginx');
    expect(second?.containerIdentityKey).toBe('edge-2::local::nginx');
  });

  test('falls back to the container id when the identity is incomplete', () => {
    const container = createContainer({ watcher: '' });

    expect(buildApprovalRecordInput(container)?.containerIdentityKey).toBe('container-1');
  });

  test('falls back to an empty fromRef when neither updateKind nor the installed tag names one', () => {
    const container = createContainer({
      image: {
        ...createContainer().image,
        tag: undefined as unknown as Container['image']['tag'],
      },
      updateKind: undefined as unknown as Container['updateKind'],
    });

    expect(buildApprovalRecordInput(container)).toMatchObject({ fromRef: '', toRef: '1.2.4' });
  });

  test('returns undefined when no candidate ref can be derived', () => {
    const container = createContainer({ result: { created: '2026-01-01T00:00:00.000Z' } });

    expect(buildApprovalRecordInput(container)).toBeUndefined();
  });

  test('defaults updateKind and semverDiff to unknown when the container omits them', () => {
    const container = createContainer({
      updateKind: undefined as unknown as Container['updateKind'],
    });

    expect(buildApprovalRecordInput(container)).toMatchObject({
      updateKind: 'unknown',
      semverDiff: 'unknown',
      fromRef: '1.2.3',
      toRef: '1.2.4',
    });
  });
});

function createRecord(overrides: Partial<ApprovalRecord> = {}): ApprovalRecord {
  return {
    schemaVersion: APPROVAL_SCHEMA_VERSION,
    id: 'approval-1',
    containerId: 'container-1',
    containerIdentityKey: '::local::nginx',
    containerName: 'nginx',
    watcher: 'local',
    image: 'library/nginx',
    fromRef: '1.2.3',
    toRef: '1.2.4',
    candidateRef: '1.2.4',
    updateKind: 'tag',
    semverDiff: 'patch',
    createdAt: '2026-01-01T00:00:00.000Z',
    createdAtMs: Date.parse('2026-01-01T00:00:00.000Z'),
    decision: 'pending',
    ...overrides,
  };
}

describe('approval state predicates', () => {
  const now = Date.parse('2026-06-01T00:00:00.000Z');

  test('a pending row is pending and neither deferred nor resolved', () => {
    const record = createRecord();

    expect(isApprovalPending(record, now)).toBe(true);
    expect(isApprovalDeferred(record, now)).toBe(false);
    expect(isApprovalResolved(record)).toBe(false);
  });

  test('a deferral in the future is deferred and not pending', () => {
    const record = createRecord({
      decision: 'deferred',
      deferredUntil: '2026-07-01T00:00:00.000Z',
    });

    expect(isApprovalDeferred(record, now)).toBe(true);
    expect(isApprovalPending(record, now)).toBe(false);
  });

  // Spec edge case 4 — expiry is a query predicate, with no sweep job.
  test('an expired deferral falls back into the pending set with no job running', () => {
    const record = createRecord({
      decision: 'deferred',
      deferredUntil: '2026-05-01T00:00:00.000Z',
    });

    expect(isApprovalDeferred(record, now)).toBe(false);
    expect(isApprovalPending(record, now)).toBe(true);
  });

  test('a deferral with no deferredUntil is treated as expired', () => {
    const record = createRecord({ decision: 'deferred' });

    expect(isApprovalDeferred(record, now)).toBe(false);
    expect(isApprovalPending(record, now)).toBe(true);
  });

  test('a deferral with an unparseable deferredUntil is treated as expired', () => {
    const record = createRecord({ decision: 'deferred', deferredUntil: 'not-a-date' });

    expect(isApprovalDeferred(record, now)).toBe(false);
    expect(isApprovalPending(record, now)).toBe(true);
  });

  test.each(['approved', 'rejected'] as const)(
    'a %s row is neither pending nor deferred',
    (decision) => {
      const record = createRecord({ decision, decidedAt: '2026-05-02T00:00:00.000Z' });

      expect(isApprovalPending(record, now)).toBe(false);
      expect(isApprovalDeferred(record, now)).toBe(false);
    },
  );

  test('a resolved row leaves the pending set even while its decision is still pending', () => {
    const record = createRecord({
      resolution: 'superseded',
      resolvedAt: '2026-05-02T00:00:00.000Z',
    });

    expect(isApprovalResolved(record)).toBe(true);
    expect(isApprovalPending(record, now)).toBe(false);
  });

  test('a resolved deferral is no longer deferred', () => {
    const record = createRecord({
      decision: 'deferred',
      deferredUntil: '2026-07-01T00:00:00.000Z',
      resolution: 'container-removed',
      resolvedAt: '2026-05-02T00:00:00.000Z',
    });

    expect(isApprovalDeferred(record, now)).toBe(false);
    expect(isApprovalPending(record, now)).toBe(false);
  });
});
