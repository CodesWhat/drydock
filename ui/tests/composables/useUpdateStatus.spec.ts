import { i18n } from '@/boot/i18n';
import {
  deriveUpdateStatus,
  formatLiftCountdown,
  type UpdateStatusInput,
} from '@/composables/useUpdateStatus';
import type { UpdateBlocker, UpdateEligibility } from '@/types/container';
import { mapApiContainer } from '@/utils/container-mapper';

function blocker(overrides: Partial<UpdateBlocker> = {}): UpdateBlocker {
  return {
    reason: overrides.reason ?? 'snoozed',
    severity: overrides.severity,
    message: overrides.message ?? 'Policy condition.',
    actionable: overrides.actionable ?? true,
    actionHint: overrides.actionHint,
    liftableAt: overrides.liftableAt,
    details: overrides.details,
  };
}

function eligibility(blockers: UpdateBlocker[] = []): UpdateEligibility {
  return {
    eligible: blockers.length === 0,
    blockers,
    evaluatedAt: '2026-07-12T00:00:00.000Z',
  };
}

function input(overrides: Partial<UpdateStatusInput> = {}): UpdateStatusInput {
  return {
    container: {
      id: 'container-1',
      name: 'nginx',
      newTag: '1.2.3',
      newDigest: null,
      updateEligibility: eligibility(),
    },
    mode: 'manual',
    hasActiveOperationBadge: false,
    t: i18n.global.t,
    ...overrides,
  };
}

describe('deriveUpdateStatus', () => {
  it('describes an eligible manual update and allows its CTA', () => {
    const status = deriveUpdateStatus(input());

    expect(status.state).toBe('ready');
    expect(status.summary).toBe('Update available — ready to apply manually.');
    expect(status.manualUpdateDisabled).toBe(false);
    expect(status.conditions).toEqual([]);
  });

  it('treats a missing updateEligibility the same as an empty blockers list', () => {
    const status = deriveUpdateStatus(
      input({
        container: {
          id: 'container-1',
          name: 'nginx',
          newTag: '1.2.3',
          updateEligibility: undefined,
        },
      }),
    );

    expect(status.state).toBe('ready');
    expect(status.summary).toBe('Update available — ready to apply manually.');
    expect(status.manualUpdateDisabled).toBe(false);
    expect(status.conditions).toEqual([]);
  });

  it('describes automatic dispatch when auto mode is eligible', () => {
    const status = deriveUpdateStatus(input({ mode: 'auto' }));

    expect(status.summary).toBe('Update available — eligible for automatic dispatch.');
  });

  it('keeps hard blockers ahead of soft blockers and disables manual update', () => {
    const status = deriveUpdateStatus(
      input({
        container: {
          id: 'container-1',
          name: 'nginx',
          newTag: '1.2.3',
          updateEligibility: eligibility([
            blocker({ reason: 'snoozed', severity: 'soft' }),
            blocker({
              reason: 'agent-mismatch',
              severity: 'hard',
              details: { triggerId: 'edge.docker.local' },
            }),
          ]),
        },
      }),
    );

    expect(status.state).toBe('hard-blocked');
    expect(status.summary).toBe('Update blocked — fix required.');
    expect(status.manualUpdateDisabled).toBe(true);
    expect(status.conditions.map((condition) => condition.reason)).toEqual([
      'agent-mismatch',
      'snoozed',
    ]);
    expect(status.conditions[0].action).toEqual({
      kind: 'external',
      label: 'Configure trigger agent',
      href: 'https://getdrydock.com/docs/configuration/actions/update-eligibility#update-status-says-agent-mismatch',
    });
  });

  it('suppresses the active-operation condition when another operation badge is visible', () => {
    const status = deriveUpdateStatus(
      input({
        hasActiveOperationBadge: true,
        container: {
          id: 'container-1',
          name: 'nginx',
          newTag: '1.2.3',
          updateEligibility: eligibility([
            blocker({ reason: 'active-operation', severity: 'hard' }),
          ]),
        },
      }),
    );

    expect(status.conditions).toEqual([]);
    expect(status.state).toBe('in-progress');
  });

  it('reports in progress from the external operation badge without a visible candidate', () => {
    const status = deriveUpdateStatus(
      input({
        hasActiveOperationBadge: true,
        container: {
          id: 'container-1',
          name: 'nginx',
          newTag: null,
          newDigest: null,
          updateEligibility: eligibility([
            blocker({ reason: 'no-update-available', severity: 'hard', actionable: false }),
          ]),
        },
      }),
    );

    expect(status.state).toBe('in-progress');
    expect(status.summary).toBe('Update in progress.');
    expect(status.hasUpdate).toBe(true);
  });

  it('collapses policy details and disables updates in notify mode', () => {
    const status = deriveUpdateStatus(
      input({
        mode: 'notify',
        container: {
          id: 'container-1',
          name: 'nginx',
          newTag: '1.2.3',
          updateEligibility: eligibility([blocker({ reason: 'snoozed', severity: 'soft' })]),
        },
      }),
    );

    expect(status.state).toBe('notify');
    expect(status.summary).toBe("Notifications only — Drydock won't apply updates.");
    expect(status.detailsCollapsed).toBe(true);
    expect(status.manualUpdateDisabled).toBe(true);
  });

  it('keeps notify-only language even when eligibility contains a hard blocker', () => {
    const status = deriveUpdateStatus(
      input({
        mode: 'notify',
        container: {
          id: 'container-1',
          name: 'nginx',
          newTag: '1.2.3',
          updateEligibility: eligibility([blocker({ reason: 'agent-mismatch', severity: 'hard' })]),
        },
      }),
    );

    expect(status.state).toBe('notify');
    expect(status.summary).toBe("Notifications only — Drydock won't apply updates.");
    expect(status.detailsCollapsed).toBe(true);
    expect(status.manualUpdateDisabled).toBe(true);
  });

  it('describes a soft-filtered automatic candidate without promising dispatch', () => {
    const status = deriveUpdateStatus(
      input({
        mode: 'auto',
        container: {
          id: 'container-1',
          name: 'nginx',
          newTag: '1.2.3',
          updateEligibility: eligibility([blocker({ reason: 'snoozed', severity: 'soft' })]),
        },
      }),
    );

    expect(status.state).toBe('soft-blocked');
    expect(status.summary).toBe('Update available — auto-dispatch is filtered (manual works).');
  });

  it('maps policy, security, label, rollback, and trigger conditions to honest destinations', () => {
    const status = deriveUpdateStatus(
      input({
        container: {
          id: 'container-1',
          name: 'nginx',
          newTag: '1.2.3',
          updateEligibility: eligibility([
            blocker({ reason: 'snoozed', severity: 'soft' }),
            blocker({ reason: 'security-scan-blocked', severity: 'hard' }),
            blocker({ reason: 'trigger-not-included', severity: 'soft' }),
            blocker({ reason: 'last-update-rolled-back', severity: 'hard' }),
            blocker({ reason: 'no-update-trigger-configured', severity: 'hard' }),
          ]),
        },
      }),
    );

    const actions = Object.fromEntries(
      status.conditions.map((condition) => [condition.reason, condition.action]),
    );
    expect(actions.snoozed).toEqual({
      kind: 'tab',
      label: 'Edit update policy',
      tab: 'actions',
      section: 'update-policy',
    });
    expect(actions['security-scan-blocked']).toEqual({
      kind: 'route',
      label: 'Review scan results',
      to: { path: '/security' },
    });
    expect(actions['trigger-not-included']).toEqual({
      kind: 'external',
      label: 'Configure trigger labels',
      href: 'https://getdrydock.com/docs/configuration/actions/update-eligibility#reasons-reference',
    });
    expect(actions['last-update-rolled-back']).toEqual({
      kind: 'route',
      label: 'View rollback context',
      to: {
        path: '/audit',
        query: { actions: 'rollback,auto-rollback', container: 'nginx' },
      },
    });
    expect(actions['no-update-trigger-configured']).toEqual({
      kind: 'external',
      label: 'Configure update triggers',
      href: 'https://getdrydock.com/docs/configuration/triggers',
    });
  });

  it.each([
    {
      label: 'snoozed tag',
      reason: 'snoozed' as const,
      result: { tag: '1.3.0' },
      updateKind: { kind: 'tag', semverDiff: 'minor', remoteValue: '1.3.0' },
      updatePolicy: { snoozeUntil: '2099-07-13T00:00:00.000Z' },
    },
    {
      label: 'skipped tag',
      reason: 'skip-tag' as const,
      result: { tag: '1.3.0' },
      updateKind: { kind: 'tag', semverDiff: 'minor', remoteValue: '1.3.0' },
      updatePolicy: { skipTags: ['1.3.0'] },
    },
    {
      label: 'skipped digest',
      reason: 'skip-digest' as const,
      result: { tag: '1.2.2', digest: 'sha256:new' },
      updateKind: { kind: 'digest', semverDiff: 'unknown', remoteValue: 'sha256:new' },
      updatePolicy: { skipDigests: ['sha256:new'] },
    },
  ])('preserves a mapper-backed $label update when tag and digest are hidden', (scenario) => {
    const mapped = mapApiContainer({
      id: 'container-1',
      name: 'nginx',
      status: 'running',
      watcher: 'local',
      agent: null,
      image: { name: 'nginx', tag: { value: '1.2.2' } },
      result: scenario.result,
      updateAvailable: false,
      updateKind: scenario.updateKind,
      updatePolicy: scenario.updatePolicy,
      updateEligibility: {
        eligible: false,
        evaluatedAt: '2026-07-12T00:00:00.000Z',
        blockers: [
          {
            reason: scenario.reason,
            severity: 'soft',
            message: 'Snoozed until tomorrow.',
            actionable: true,
          },
        ],
      },
    });

    expect(mapped.newTag).toBeNull();
    expect(mapped.newDigest).toBeNull();
    const status = deriveUpdateStatus(input({ container: mapped }));
    expect(status.hasUpdate).toBe(true);
    expect(status.state).toBe('soft-blocked');
    expect(status.summary).not.toBe('Up to date.');
  });

  it('reports up to date without rendering no-update-available as a condition', () => {
    const status = deriveUpdateStatus(
      input({
        container: {
          id: 'container-1',
          name: 'nginx',
          newTag: null,
          updateEligibility: eligibility([
            blocker({ reason: 'no-update-available', severity: 'hard', actionable: false }),
          ]),
        },
      }),
    );

    expect(status.state).toBe('up-to-date');
    expect(status.summary).toBe('Up to date.');
    expect(status.conditions).toEqual([]);
    // No updateInsight on this container, so the insightNote ternary's second `&&`
    // operand is falsy even though the container is already up to date.
    expect(status.insightNote).toBeUndefined();
  });

  it('describes a pinned-tag insight as newer-but-non-actionable (#498)', () => {
    const status = deriveUpdateStatus(
      input({
        container: {
          id: 'container-1',
          name: 'immich-machine-learning',
          newTag: null,
          newDigest: null,
          updateInsight: { tag: 'v3.0.2-openvino', kind: 'major' },
          updateEligibility: eligibility([
            blocker({ reason: 'no-update-available', severity: 'hard', actionable: false }),
          ]),
        },
      }),
    );

    expect(status.state).toBe('insight');
    expect(status.summary).toBe('Newer version available — this tag is pinned.');
    expect(status.tone).toBe('info');
    expect(status.hasUpdate).toBe(false);
    expect(status.manualUpdateDisabled).toBe(true);
    expect(status.conditions).toEqual([]);
    expect(status.insightNote).toBe(
      "Newer version available: v3.0.2-openvino. This tag is pinned — drydock won't update it automatically.",
    );
  });

  it('omits the insight note once an update is actually actionable, even if updateInsight is still set', () => {
    const status = deriveUpdateStatus(
      input({
        container: {
          id: 'container-1',
          name: 'nginx',
          newTag: '1.2.3',
          updateInsight: { tag: 'v3.0.2-openvino', kind: 'major' },
          updateEligibility: eligibility(),
        },
      }),
    );

    // hasUpdate true short-circuits the insightNote `&&` before updateInsight is
    // even considered — an actionable update takes precedence over the insight.
    expect(status.hasUpdate).toBe(true);
    expect(status.insightNote).toBeUndefined();
  });

  it('detects digest-only updates', () => {
    const status = deriveUpdateStatus(
      input({
        container: {
          id: 'container-1',
          name: 'nginx',
          newTag: null,
          newDigest: 'sha256:new',
          updateEligibility: eligibility(),
        },
      }),
    );

    expect(status.state).toBe('ready');
    expect(status.hasUpdate).toBe(true);
  });

  it.each([
    ['rollback-container', 'hard', 'danger', 'route'],
    ['active-operation', 'hard', 'info', 'tab'],
    ['security-scan-blocked', 'hard', 'danger', 'route'],
    ['last-update-rolled-back', 'hard', 'danger', 'route'],
    ['snoozed', 'soft', 'warning', 'tab'],
    ['skip-tag', 'soft', 'warning', 'tab'],
    ['skip-digest', 'soft', 'warning', 'tab'],
    ['maturity-not-reached', 'soft', 'warning', 'tab'],
    ['threshold-not-reached', 'soft', 'warning', 'external'],
    ['trigger-excluded', 'soft', 'warning', 'external'],
    ['trigger-not-included', 'soft', 'warning', 'external'],
    ['agent-mismatch', 'hard', 'danger', 'external'],
    ['no-update-trigger-configured', 'hard', 'danger', 'external'],
    ['self-update-unavailable', 'hard', 'danger', 'external'],
    ['maintenance-window-closed', 'soft', 'warning', 'external'],
  ] as const)('maps %s to a localized presentation and safe action', (reason, severity, tone, actionKind) => {
    const status = deriveUpdateStatus(
      input({
        container: {
          id: 'container-1',
          name: 'nginx',
          newTag: '1.2.3',
          updateEligibility: eligibility([
            blocker({ reason, severity, details: { triggerId: 'docker.local' } }),
          ]),
        },
      }),
    );
    const condition = status.conditions[0];

    expect(condition.heading).not.toBe(reason);
    expect(condition.icon).toBeTruthy();
    expect(condition.tone).toBe(tone);
    expect(condition.action?.kind).toBe(actionKind);
  });

  it('composes the maturity condition body from a trusted-publishedAt clock (#display-honesty)', () => {
    const clockStartAt = '2026-07-18T00:00:00.000Z';
    const status = deriveUpdateStatus(
      input({
        container: {
          id: 'container-1',
          name: 'nginx',
          newTag: '1.2.3',
          updateEligibility: eligibility([
            blocker({
              reason: 'maturity-not-reached',
              severity: 'soft',
              message: 'Maturity policy requires updates to be at least 7 days old.',
              details: {
                minAgeDays: 7,
                clockSource: 'publishedAt',
                clockStartAt,
                remainingMs: 3 * 24 * 60 * 60 * 1000,
              },
            }),
          ]),
        },
      }),
    );

    const condition = status.conditions[0];
    const expectedDate = new Date(clockStartAt).toLocaleDateString();
    expect(condition.body).toBe(
      `Candidate published ${expectedDate} — 3 more days until the 7-day minimum`,
    );
  });

  it('composes the maturity condition body from an updateDetectedAt clock, singular day remaining (#display-honesty)', () => {
    const clockStartAt = '2026-07-19T00:00:00.000Z';
    const status = deriveUpdateStatus(
      input({
        container: {
          id: 'container-1',
          name: 'nginx',
          newTag: '1.2.3',
          updateEligibility: eligibility([
            blocker({
              reason: 'maturity-not-reached',
              severity: 'soft',
              message: 'Maturity policy requires updates to be at least 7 days old.',
              details: {
                minAgeDays: 7,
                clockSource: 'detectedAt',
                clockStartAt,
                remainingMs: 12 * 60 * 60 * 1000,
              },
            }),
          ]),
        },
      }),
    );

    const condition = status.conditions[0];
    const expectedDate = new Date(clockStartAt).toLocaleDateString();
    expect(condition.body).toBe(
      `Candidate detected ${expectedDate} — 1 more day until the 7-day minimum`,
    );
  });

  it('falls back to the plain blocker message when maturity clock details are absent (#display-honesty)', () => {
    const status = deriveUpdateStatus(
      input({
        container: {
          id: 'container-1',
          name: 'nginx',
          newTag: '1.2.3',
          updateEligibility: eligibility([
            blocker({
              reason: 'maturity-not-reached',
              severity: 'soft',
              message: 'Maturity policy requires updates to be at least 7 days old.',
              details: { minAgeDays: 7 },
            }),
          ]),
        },
      }),
    );

    const condition = status.conditions[0];
    expect(condition.body).toBe('Maturity policy requires updates to be at least 7 days old.');
  });

  it('falls back to the plain blocker message when details is entirely absent, not just missing fields (#display-honesty)', () => {
    const status = deriveUpdateStatus(
      input({
        container: {
          id: 'container-1',
          name: 'nginx',
          newTag: '1.2.3',
          updateEligibility: eligibility([
            blocker({
              reason: 'maturity-not-reached',
              severity: 'soft',
              message: 'Maturity policy requires updates to be at least 7 days old.',
            }),
          ]),
        },
      }),
    );

    const condition = status.conditions[0];
    expect(condition.body).toBe('Maturity policy requires updates to be at least 7 days old.');
  });

  it('formats a live lift countdown without dropping the exact date', () => {
    expect(
      formatLiftCountdown('2026-07-18T12:00:00.000Z', Date.parse('2026-07-12T12:00:00.000Z')),
    ).toBe('6d 0h 0m');
    expect(
      formatLiftCountdown('2026-07-12T13:05:00.000Z', Date.parse('2026-07-12T12:00:00.000Z')),
    ).toBe('1h 5m');
    expect(
      formatLiftCountdown('2026-07-12T12:05:00.000Z', Date.parse('2026-07-12T12:00:00.000Z')),
    ).toBe('5m');
    expect(
      formatLiftCountdown('not-a-date', Date.parse('2026-07-12T12:00:00.000Z')),
    ).toBeUndefined();
  });
});
