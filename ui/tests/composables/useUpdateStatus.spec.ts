import { i18n } from '@/boot/i18n';
import {
  deriveUpdateStatus,
  formatLiftCountdown,
  type UpdateStatusInput,
} from '@/composables/useUpdateStatus';
import type { UpdateBlocker, UpdateEligibility } from '@/types/container';

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

  it('describes automatic dispatch when auto mode is eligible', () => {
    const status = deriveUpdateStatus(input({ mode: 'auto' }));

    expect(status.summary).toBe('Update available — will dispatch automatically.');
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
      kind: 'route',
      label: 'Review update triggers',
      to: { path: '/triggers', query: { q: 'edge.docker.local' } },
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
      kind: 'tab',
      label: 'Review container labels',
      tab: 'labels',
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
      kind: 'route',
      label: 'Review update triggers',
      to: { path: '/triggers' },
    });
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
    ['threshold-not-reached', 'soft', 'warning', 'route'],
    ['trigger-excluded', 'soft', 'warning', 'tab'],
    ['trigger-not-included', 'soft', 'warning', 'tab'],
    ['agent-mismatch', 'hard', 'danger', 'route'],
    ['no-update-trigger-configured', 'hard', 'danger', 'route'],
    ['self-update-unavailable', 'hard', 'danger', 'route'],
    ['maintenance-window-closed', 'soft', 'warning', 'route'],
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

  it('formats a live lift countdown without dropping the exact date', () => {
    expect(
      formatLiftCountdown('2026-07-18T12:00:00.000Z', Date.parse('2026-07-12T12:00:00.000Z')),
    ).toBe('6d 0h 0m');
    expect(
      formatLiftCountdown('2026-07-12T13:05:00.000Z', Date.parse('2026-07-12T12:00:00.000Z')),
    ).toBe('1h 5m');
  });
});
