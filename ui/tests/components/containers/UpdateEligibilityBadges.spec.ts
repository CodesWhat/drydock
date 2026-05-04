import { mount } from '@vue/test-utils';
import UpdateEligibilityBadges from '@/components/containers/UpdateEligibilityBadges.vue';
import type { UpdateBlocker, UpdateEligibility } from '@/types/container';

// Stub iconify-icon globally (used directly in the template)
const IconifyStub = {
  name: 'iconify-icon',
  props: ['icon', 'width', 'height'],
  template: '<span class="iconify-stub" :data-icon="icon" />',
};

const globalConfig = {
  components: { 'iconify-icon': IconifyStub },
  directives: { tooltip: () => {} },
};

function makeBlocker(overrides: Partial<UpdateBlocker> = {}): UpdateBlocker {
  return {
    reason: overrides.reason ?? 'no-update-trigger-configured',
    message: overrides.message ?? 'No trigger configured.',
    actionable: overrides.actionable ?? true,
    actionHint: overrides.actionHint,
    liftableAt: overrides.liftableAt,
    details: overrides.details,
  };
}

function makeEligibility(overrides: Partial<UpdateEligibility> = {}): UpdateEligibility {
  return {
    eligible: overrides.eligible ?? false,
    blockers: overrides.blockers ?? [makeBlocker()],
    evaluatedAt: overrides.evaluatedAt ?? '2026-04-23T00:00:00.000Z',
  };
}

describe('UpdateEligibilityBadges', () => {
  describe('no-op conditions', () => {
    it('renders nothing when eligibility is undefined', () => {
      const wrapper = mount(UpdateEligibilityBadges, {
        props: {},
        global: globalConfig,
      });
      expect(wrapper.find('[data-test="eligibility-badge-full"]').exists()).toBe(false);
    });

    it('renders nothing when eligible is true', () => {
      const wrapper = mount(UpdateEligibilityBadges, {
        props: {
          eligibility: makeEligibility({ eligible: true, blockers: [] }),
        },
        global: globalConfig,
      });
      expect(wrapper.find('[data-test="eligibility-badge-full"]').exists()).toBe(false);
    });

    it('renders nothing when the only blocker is no-update-available', () => {
      const wrapper = mount(UpdateEligibilityBadges, {
        props: {
          eligibility: makeEligibility({
            eligible: false,
            blockers: [makeBlocker({ reason: 'no-update-available' })],
          }),
        },
        global: globalConfig,
      });
      expect(wrapper.find('[data-test="eligibility-badge-full"]').exists()).toBe(false);
    });
  });

  describe('full-stack rendering', () => {
    it('renders all active blockers stacked', () => {
      const wrapper = mount(UpdateEligibilityBadges, {
        props: {
          eligibility: makeEligibility({
            blockers: [
              makeBlocker({ reason: 'snoozed', message: 'Snoozed until May 1.' }),
              makeBlocker({ reason: 'skip-tag', message: 'Tag skipped.' }),
            ],
          }),
        },
        global: globalConfig,
      });
      const full = wrapper.find('[data-test="eligibility-badge-full"]');
      expect(full.exists()).toBe(true);
      const items = full.findAll('[data-reason]');
      expect(items).toHaveLength(2);
    });

    it('sets correct data-reason attribute on each blocker', () => {
      const wrapper = mount(UpdateEligibilityBadges, {
        props: {
          eligibility: makeEligibility({
            blockers: [makeBlocker({ reason: 'snoozed' }), makeBlocker({ reason: 'skip-tag' })],
          }),
        },
        global: globalConfig,
      });
      const items = wrapper.findAll('[data-reason]');
      expect(items[0].attributes('data-reason')).toBe('snoozed');
      expect(items[1].attributes('data-reason')).toBe('skip-tag');
    });

    it('renders actionHint when present', () => {
      const wrapper = mount(UpdateEligibilityBadges, {
        props: {
          eligibility: makeEligibility({
            blockers: [
              makeBlocker({
                reason: 'threshold-not-reached',
                message: 'Threshold not met.',
                actionHint: 'Lower the threshold.',
              }),
            ],
          }),
        },
        global: globalConfig,
      });
      const full = wrapper.find('[data-test="eligibility-badge-full"]');
      expect(full.text()).toContain('Lower the threshold.');
    });

    it('renders liftableAt when present', () => {
      const wrapper = mount(UpdateEligibilityBadges, {
        props: {
          eligibility: makeEligibility({
            blockers: [
              makeBlocker({
                reason: 'snoozed',
                message: 'Snoozed.',
                liftableAt: '2026-05-01T00:00:00.000Z',
              }),
            ],
          }),
        },
        global: globalConfig,
      });
      const full = wrapper.find('[data-test="eligibility-badge-full"]');
      expect(full.text()).toContain('Lifts:');
    });
  });

  describe('hasActiveOperationBadge suppression', () => {
    it('suppresses active-operation blocker when hasActiveOperationBadge is true', () => {
      const wrapper = mount(UpdateEligibilityBadges, {
        props: {
          eligibility: makeEligibility({
            blockers: [makeBlocker({ reason: 'active-operation', message: 'In progress.' })],
          }),
          hasActiveOperationBadge: true,
        },
        global: globalConfig,
      });
      expect(wrapper.find('[data-test="eligibility-badge-full"]').exists()).toBe(false);
    });

    it('shows active-operation blocker when hasActiveOperationBadge is false', () => {
      const wrapper = mount(UpdateEligibilityBadges, {
        props: {
          eligibility: makeEligibility({
            blockers: [makeBlocker({ reason: 'active-operation', message: 'In progress.' })],
          }),
          hasActiveOperationBadge: false,
        },
        global: globalConfig,
      });
      const items = wrapper.findAll('[data-reason]');
      expect(items).toHaveLength(1);
      expect(items[0].attributes('data-reason')).toBe('active-operation');
    });

    it('shows remaining blockers when active-operation is suppressed alongside others', () => {
      const wrapper = mount(UpdateEligibilityBadges, {
        props: {
          eligibility: makeEligibility({
            blockers: [
              makeBlocker({ reason: 'snoozed' }),
              makeBlocker({ reason: 'active-operation' }),
            ],
          }),
          hasActiveOperationBadge: true,
        },
        global: globalConfig,
      });
      const items = wrapper.findAll('[data-reason]');
      expect(items).toHaveLength(1);
      expect(items[0].attributes('data-reason')).toBe('snoozed');
    });
  });

  describe('severity sort order', () => {
    it('shows hard blockers before soft blockers regardless of API order', () => {
      const wrapper = mount(UpdateEligibilityBadges, {
        props: {
          eligibility: makeEligibility({
            // soft before hard in API order
            blockers: [
              makeBlocker({ reason: 'snoozed' }),
              makeBlocker({ reason: 'agent-mismatch' }),
            ],
          }),
        },
        global: globalConfig,
      });
      const items = wrapper.findAll('[data-reason]');
      expect(items[0].attributes('data-reason')).toBe('agent-mismatch');
      expect(items[1].attributes('data-reason')).toBe('snoozed');
    });
  });

  describe('reason labels', () => {
    const labelCases: Array<[UpdateBlocker['reason'], string]> = [
      ['security-scan-blocked', 'Security blocked'],
      ['last-update-rolled-back', 'Rolled back'],
      ['snoozed', 'Snoozed'],
      ['skip-tag', 'Tag skipped'],
      ['skip-digest', 'Digest skipped'],
      ['maturity-not-reached', 'Maturing'],
      ['threshold-not-reached', 'Below threshold'],
      ['rollback-container', 'Rollback'],
      ['active-operation', 'In progress'],
      ['trigger-excluded', 'Trigger excluded'],
      ['trigger-not-included', 'Trigger filtered'],
      ['agent-mismatch', 'Agent mismatch'],
      ['no-update-trigger-configured', 'No trigger'],
    ];

    for (const [reason, expectedLabel] of labelCases) {
      it(`shows "${expectedLabel}" label for reason "${reason}"`, () => {
        const wrapper = mount(UpdateEligibilityBadges, {
          props: {
            eligibility: makeEligibility({
              blockers: [makeBlocker({ reason, message: 'Test.' })],
            }),
            hasActiveOperationBadge: false,
          },
          global: globalConfig,
        });
        const item = wrapper.find(`[data-reason="${reason}"]`);
        expect(item.exists()).toBe(true);
        expect(item.text()).toContain(expectedLabel);
      });
    }
  });

  describe('reason icons', () => {
    const iconCases: Array<[UpdateBlocker['reason'], string]> = [
      ['security-scan-blocked', 'mdi:shield-alert'],
      ['last-update-rolled-back', 'mdi:alert-circle'],
      ['snoozed', 'mdi:alarm-snooze'],
      ['skip-tag', 'mdi:tag-off'],
      ['skip-digest', 'mdi:tag-off'],
      ['maturity-not-reached', 'mdi:timer-sand'],
      ['threshold-not-reached', 'mdi:filter-variant'],
      ['rollback-container', 'mdi:backup-restore'],
      ['active-operation', 'mdi:sync'],
      ['trigger-excluded', 'mdi:cog-off'],
      ['trigger-not-included', 'mdi:cog-off'],
      ['agent-mismatch', 'mdi:cog-off'],
      ['no-update-trigger-configured', 'mdi:cog-off'],
    ];

    for (const [reason, expectedIcon] of iconCases) {
      it(`uses icon "${expectedIcon}" for reason "${reason}"`, () => {
        const wrapper = mount(UpdateEligibilityBadges, {
          props: {
            eligibility: makeEligibility({
              blockers: [makeBlocker({ reason, message: 'Test.' })],
            }),
            hasActiveOperationBadge: false,
          },
          global: globalConfig,
        });
        const item = wrapper.find(`[data-reason="${reason}"]`);
        expect(item.exists()).toBe(true);
        const iconEl = item.element.querySelector('iconify-icon');
        expect(iconEl).not.toBeNull();
        expect(iconEl!.getAttribute('icon')).toBe(expectedIcon);
      });
    }
  });

  describe('reason color coding', () => {
    it('applies danger color for security-scan-blocked', () => {
      const wrapper = mount(UpdateEligibilityBadges, {
        props: {
          eligibility: makeEligibility({
            blockers: [makeBlocker({ reason: 'security-scan-blocked' })],
          }),
        },
        global: globalConfig,
      });
      const item = wrapper.find('[data-reason="security-scan-blocked"]');
      expect(item.attributes('style') ?? '').toContain('var(--dd-danger-muted)');
    });

    it('applies danger color for last-update-rolled-back', () => {
      const wrapper = mount(UpdateEligibilityBadges, {
        props: {
          eligibility: makeEligibility({
            blockers: [makeBlocker({ reason: 'last-update-rolled-back' })],
          }),
        },
        global: globalConfig,
      });
      const item = wrapper.find('[data-reason="last-update-rolled-back"]');
      expect(item.attributes('style') ?? '').toContain('var(--dd-danger-muted)');
    });
  });

  describe('liftableAt formatting', () => {
    it('formats a valid ISO date without throwing', () => {
      expect(() =>
        mount(UpdateEligibilityBadges, {
          props: {
            eligibility: makeEligibility({
              blockers: [
                makeBlocker({
                  reason: 'snoozed',
                  message: 'Snoozed.',
                  liftableAt: '2026-07-04T00:00:00.000Z',
                }),
              ],
            }),
          },
          global: globalConfig,
        }),
      ).not.toThrow();
    });

    it('handles invalid ISO date gracefully without throwing', () => {
      expect(() =>
        mount(UpdateEligibilityBadges, {
          props: {
            eligibility: makeEligibility({
              blockers: [
                makeBlocker({
                  reason: 'snoozed',
                  message: 'Snoozed.',
                  liftableAt: 'not-a-date',
                }),
              ],
            }),
          },
          global: globalConfig,
        }),
      ).not.toThrow();
    });
  });
});
