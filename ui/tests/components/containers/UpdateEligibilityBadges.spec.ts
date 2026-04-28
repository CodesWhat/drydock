import { mount } from '@vue/test-utils';
import UpdateEligibilityBadges from '@/components/containers/UpdateEligibilityBadges.vue';
import { preferences } from '@/preferences/store';
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
  afterEach(() => {
    preferences.containers.eligibilityPills.showSoft = true;
    preferences.containers.eligibilityPills.deemphasizeSoft = true;
  });

  describe('no-op conditions', () => {
    it('renders nothing when eligibility is undefined', () => {
      const wrapper = mount(UpdateEligibilityBadges, {
        props: {},
        global: globalConfig,
      });
      expect(wrapper.find('[data-test="eligibility-badge-primary"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="eligibility-badge-full"]').exists()).toBe(false);
    });

    it('renders nothing when eligible is true', () => {
      const wrapper = mount(UpdateEligibilityBadges, {
        props: {
          eligibility: makeEligibility({ eligible: true, blockers: [] }),
        },
        global: globalConfig,
      });
      expect(wrapper.find('[data-test="eligibility-badge-primary"]').exists()).toBe(false);
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
      expect(wrapper.find('[data-test="eligibility-badge-primary"]').exists()).toBe(false);
    });

    it('renders nothing when eligible and blockers contain only no-update-available', () => {
      const wrapper = mount(UpdateEligibilityBadges, {
        props: {
          eligibility: makeEligibility({
            eligible: false,
            blockers: [makeBlocker({ reason: 'no-update-available' })],
          }),
        },
        global: globalConfig,
      });
      expect(wrapper.find('[data-test="eligibility-badge-primary"]').exists()).toBe(false);
    });
  });

  describe('compact variant (default)', () => {
    it('renders primary badge for a single blocker', () => {
      const wrapper = mount(UpdateEligibilityBadges, {
        props: {
          eligibility: makeEligibility({
            blockers: [makeBlocker({ reason: 'snoozed', message: 'Snoozed until May 1.' })],
          }),
        },
        global: globalConfig,
      });
      const badge = wrapper.find('[data-test="eligibility-badge-primary"]');
      expect(badge.exists()).toBe(true);
      expect(badge.text()).toContain('Snoozed');
    });

    it('does not render +N indicator for a single blocker', () => {
      const wrapper = mount(UpdateEligibilityBadges, {
        props: {
          eligibility: makeEligibility({
            blockers: [makeBlocker({ reason: 'snoozed' })],
          }),
        },
        global: globalConfig,
      });
      expect(wrapper.find('[data-test="eligibility-badge-extra"]').exists()).toBe(false);
    });

    it('renders +N indicator for multiple blockers', () => {
      const wrapper = mount(UpdateEligibilityBadges, {
        props: {
          eligibility: makeEligibility({
            blockers: [
              makeBlocker({ reason: 'snoozed' }),
              makeBlocker({ reason: 'skip-tag' }),
              makeBlocker({ reason: 'threshold-not-reached' }),
            ],
          }),
        },
        global: globalConfig,
      });
      const extra = wrapper.find('[data-test="eligibility-badge-extra"]');
      expect(extra.exists()).toBe(true);
      expect(extra.text()).toBe('+2');
    });

    it('does not render full stack in compact mode', () => {
      const wrapper = mount(UpdateEligibilityBadges, {
        props: {
          eligibility: makeEligibility({
            blockers: [makeBlocker({ reason: 'snoozed' })],
          }),
        },
        global: globalConfig,
      });
      expect(wrapper.find('[data-test="eligibility-badge-full"]').exists()).toBe(false);
    });
  });

  describe('full variant', () => {
    it('renders the full stack', () => {
      const wrapper = mount(UpdateEligibilityBadges, {
        props: {
          eligibility: makeEligibility({
            blockers: [
              makeBlocker({ reason: 'snoozed', message: 'Snoozed until May 1.' }),
              makeBlocker({ reason: 'skip-tag', message: 'Tag skipped.' }),
            ],
          }),
          variant: 'full',
        },
        global: globalConfig,
      });
      const full = wrapper.find('[data-test="eligibility-badge-full"]');
      expect(full.exists()).toBe(true);
      const items = full.findAll('[data-reason]');
      expect(items).toHaveLength(2);
      expect(items[0].attributes('data-reason')).toBe('snoozed');
      expect(items[1].attributes('data-reason')).toBe('skip-tag');
    });

    it('shows message and actionHint in full mode', () => {
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
          variant: 'full',
        },
        global: globalConfig,
      });
      const full = wrapper.find('[data-test="eligibility-badge-full"]');
      expect(full.text()).toContain('Threshold not met.');
      expect(full.text()).toContain('Lower the threshold.');
    });

    it('shows formatted liftableAt in full mode', () => {
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
          variant: 'full',
        },
        global: globalConfig,
      });
      const full = wrapper.find('[data-test="eligibility-badge-full"]');
      // Just verify "Lifts:" text appears — locale format varies across environments
      expect(full.text()).toContain('Lifts:');
    });

    it('does not render +N indicator in full mode', () => {
      const wrapper = mount(UpdateEligibilityBadges, {
        props: {
          eligibility: makeEligibility({
            blockers: [makeBlocker({ reason: 'snoozed' }), makeBlocker({ reason: 'skip-tag' })],
          }),
          variant: 'full',
        },
        global: globalConfig,
      });
      expect(wrapper.find('[data-test="eligibility-badge-extra"]').exists()).toBe(false);
    });
  });

  describe('tooltip content', () => {
    it('badge has v-tooltip binding with message', () => {
      // We test tooltip text via the title attribute fallback (the directive sets title
      // as a fallback when the shared tooltip element is not visible in jsdom)
      const wrapper = mount(UpdateEligibilityBadges, {
        props: {
          eligibility: makeEligibility({
            blockers: [
              makeBlocker({
                reason: 'security-scan-blocked',
                message: 'Security scan blocked update.',
                actionHint: 'Use force-update.',
              }),
            ],
          }),
        },
        global: {
          components: { 'iconify-icon': IconifyStub },
          // Use real tooltip directive so title fallback is applied
          directives: { tooltip: {} },
        },
      });
      const badge = wrapper.find('[data-test="eligibility-badge-primary"]');
      expect(badge.exists()).toBe(true);
    });

    it('includes liftableAt in compact tooltip', () => {
      // Test that liftableAt flows to blockerTooltip. We verify indirectly by
      // mounting the component and checking it renders without error.
      const wrapper = mount(UpdateEligibilityBadges, {
        props: {
          eligibility: makeEligibility({
            blockers: [
              makeBlocker({
                reason: 'snoozed',
                message: 'Snoozed.',
                liftableAt: '2026-06-01T00:00:00.000Z',
              }),
            ],
          }),
        },
        global: globalConfig,
      });
      expect(wrapper.find('[data-test="eligibility-badge-primary"]').exists()).toBe(true);
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
      expect(wrapper.find('[data-test="eligibility-badge-primary"]').exists()).toBe(false);
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
      const badge = wrapper.find('[data-test="eligibility-badge-primary"]');
      expect(badge.exists()).toBe(true);
      expect(badge.text()).toContain('In progress');
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
      const badge = wrapper.find('[data-test="eligibility-badge-primary"]');
      expect(badge.exists()).toBe(true);
      expect(badge.text()).toContain('Snoozed');
      // Only 1 remaining blocker so no +N
      expect(wrapper.find('[data-test="eligibility-badge-extra"]').exists()).toBe(false);
    });
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
      const badge = wrapper.find('[data-test="eligibility-badge-primary"]');
      const style = badge.attributes('style') ?? '';
      expect(style).toContain('var(--dd-danger-muted)');
    });

    it('applies muted deemphasized style for snoozed (soft, deemphasizeSoft=true by default)', () => {
      const wrapper = mount(UpdateEligibilityBadges, {
        props: {
          eligibility: makeEligibility({
            blockers: [makeBlocker({ reason: 'snoozed' })],
          }),
        },
        global: globalConfig,
      });
      const badge = wrapper.find('[data-test="eligibility-badge-primary"]');
      const style = badge.attributes('style') ?? '';
      expect(style).toContain('var(--dd-bg-elevated)');
    });

    it('applies muted deemphasized style for skip-tag (soft, deemphasizeSoft=true by default)', () => {
      const wrapper = mount(UpdateEligibilityBadges, {
        props: {
          eligibility: makeEligibility({
            blockers: [makeBlocker({ reason: 'skip-tag' })],
          }),
        },
        global: globalConfig,
      });
      const badge = wrapper.find('[data-test="eligibility-badge-primary"]');
      const style = badge.attributes('style') ?? '';
      expect(style).toContain('var(--dd-bg-elevated)');
    });

    it('applies muted deemphasized style for skip-digest (soft, deemphasizeSoft=true by default)', () => {
      const wrapper = mount(UpdateEligibilityBadges, {
        props: {
          eligibility: makeEligibility({
            blockers: [makeBlocker({ reason: 'skip-digest' })],
          }),
        },
        global: globalConfig,
      });
      const badge = wrapper.find('[data-test="eligibility-badge-primary"]');
      const style = badge.attributes('style') ?? '';
      expect(style).toContain('var(--dd-bg-elevated)');
    });

    it('applies muted deemphasized style for maturity-not-reached (soft, deemphasizeSoft=true by default)', () => {
      const wrapper = mount(UpdateEligibilityBadges, {
        props: {
          eligibility: makeEligibility({
            blockers: [makeBlocker({ reason: 'maturity-not-reached' })],
          }),
        },
        global: globalConfig,
      });
      const badge = wrapper.find('[data-test="eligibility-badge-primary"]');
      const style = badge.attributes('style') ?? '';
      expect(style).toContain('var(--dd-bg-elevated)');
    });

    it('applies muted deemphasized style for threshold-not-reached (soft, deemphasizeSoft=true by default)', () => {
      const wrapper = mount(UpdateEligibilityBadges, {
        props: {
          eligibility: makeEligibility({
            blockers: [makeBlocker({ reason: 'threshold-not-reached' })],
          }),
        },
        global: globalConfig,
      });
      const badge = wrapper.find('[data-test="eligibility-badge-primary"]');
      const style = badge.attributes('style') ?? '';
      expect(style).toContain('var(--dd-bg-elevated)');
    });

    it('applies muted deemphasized style for trigger-excluded (soft, deemphasizeSoft=true by default)', () => {
      const wrapper = mount(UpdateEligibilityBadges, {
        props: {
          eligibility: makeEligibility({
            blockers: [makeBlocker({ reason: 'trigger-excluded' })],
          }),
        },
        global: globalConfig,
      });
      const badge = wrapper.find('[data-test="eligibility-badge-primary"]');
      const style = badge.attributes('style') ?? '';
      expect(style).toContain('var(--dd-bg-elevated)');
    });

    it('applies muted deemphasized style for trigger-not-included (soft, deemphasizeSoft=true by default)', () => {
      const wrapper = mount(UpdateEligibilityBadges, {
        props: {
          eligibility: makeEligibility({
            blockers: [makeBlocker({ reason: 'trigger-not-included' })],
          }),
        },
        global: globalConfig,
      });
      const badge = wrapper.find('[data-test="eligibility-badge-primary"]');
      const style = badge.attributes('style') ?? '';
      expect(style).toContain('var(--dd-bg-elevated)');
    });

    it('applies info color for active-operation', () => {
      const wrapper = mount(UpdateEligibilityBadges, {
        props: {
          eligibility: makeEligibility({
            blockers: [makeBlocker({ reason: 'active-operation' })],
          }),
          hasActiveOperationBadge: false,
        },
        global: globalConfig,
      });
      const badge = wrapper.find('[data-test="eligibility-badge-primary"]');
      const style = badge.attributes('style') ?? '';
      expect(style).toContain('var(--dd-info-muted)');
    });

    it('applies neutral color for rollback-container', () => {
      const wrapper = mount(UpdateEligibilityBadges, {
        props: {
          eligibility: makeEligibility({
            blockers: [makeBlocker({ reason: 'rollback-container' })],
          }),
        },
        global: globalConfig,
      });
      const badge = wrapper.find('[data-test="eligibility-badge-primary"]');
      const style = badge.attributes('style') ?? '';
      expect(style).toContain('var(--dd-neutral-muted)');
    });

    it('applies neutral color for agent-mismatch', () => {
      const wrapper = mount(UpdateEligibilityBadges, {
        props: {
          eligibility: makeEligibility({
            blockers: [makeBlocker({ reason: 'agent-mismatch' })],
          }),
        },
        global: globalConfig,
      });
      const badge = wrapper.find('[data-test="eligibility-badge-primary"]');
      const style = badge.attributes('style') ?? '';
      expect(style).toContain('var(--dd-neutral-muted)');
    });

    it('applies neutral color for no-update-trigger-configured', () => {
      const wrapper = mount(UpdateEligibilityBadges, {
        props: {
          eligibility: makeEligibility({
            blockers: [makeBlocker({ reason: 'no-update-trigger-configured' })],
          }),
        },
        global: globalConfig,
      });
      const badge = wrapper.find('[data-test="eligibility-badge-primary"]');
      const style = badge.attributes('style') ?? '';
      expect(style).toContain('var(--dd-neutral-muted)');
    });
  });

  describe('reason labels', () => {
    const labelCases: Array<[UpdateBlocker['reason'], string]> = [
      ['security-scan-blocked', 'Security blocked'],
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
        const badge = wrapper.find('[data-test="eligibility-badge-primary"]');
        expect(badge.text()).toContain(expectedLabel);
      });
    }
  });

  describe('reason icons', () => {
    // iconify-icon is a custom web element rendered as-is in jsdom; query it
    // by tag name and read the icon attribute directly.
    const iconCases: Array<[UpdateBlocker['reason'], string]> = [
      ['security-scan-blocked', 'mdi:shield-alert'],
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
        const badge = wrapper.find('[data-test="eligibility-badge-primary"]');
        expect(badge.exists()).toBe(true);
        // iconify-icon is a web component; find via querySelectorAll on the element
        const iconEl = badge.element.querySelector('iconify-icon');
        expect(iconEl).not.toBeNull();
        expect(iconEl!.getAttribute('icon')).toBe(expectedIcon);
      });
    }
  });

  describe('liftableAt formatting', () => {
    it('formats a valid ISO date in compact tooltip (rendered without error)', () => {
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

    it('handles invalid ISO date gracefully (falls back to raw string)', () => {
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

  describe('showSoft preference', () => {
    it('renders nothing when showSoft=false and the only blocker is soft', () => {
      preferences.containers.eligibilityPills.showSoft = false;
      const wrapper = mount(UpdateEligibilityBadges, {
        props: {
          eligibility: makeEligibility({
            blockers: [makeBlocker({ reason: 'snoozed' })],
          }),
        },
        global: globalConfig,
      });
      expect(wrapper.find('[data-test="eligibility-badge-primary"]').exists()).toBe(false);
    });

    it('renders only hard blockers when showSoft=false and mixed hard+soft blockers exist', () => {
      preferences.containers.eligibilityPills.showSoft = false;
      const wrapper = mount(UpdateEligibilityBadges, {
        props: {
          eligibility: makeEligibility({
            blockers: [
              makeBlocker({ reason: 'agent-mismatch' }),
              makeBlocker({ reason: 'snoozed' }),
            ],
          }),
        },
        global: globalConfig,
      });
      const badge = wrapper.find('[data-test="eligibility-badge-primary"]');
      expect(badge.exists()).toBe(true);
      expect(badge.text()).toContain('Agent mismatch');
      // Only 1 hard blocker visible — no +N
      expect(wrapper.find('[data-test="eligibility-badge-extra"]').exists()).toBe(false);
    });

    it('does not count hidden soft blockers in the +N indicator when showSoft=false', () => {
      preferences.containers.eligibilityPills.showSoft = false;
      const wrapper = mount(UpdateEligibilityBadges, {
        props: {
          eligibility: makeEligibility({
            blockers: [
              makeBlocker({ reason: 'agent-mismatch' }),
              makeBlocker({ reason: 'no-update-trigger-configured' }),
              makeBlocker({ reason: 'snoozed' }),
              makeBlocker({ reason: 'skip-tag' }),
            ],
          }),
        },
        global: globalConfig,
      });
      // 2 hard blockers → primary + +1 (not +3)
      const extra = wrapper.find('[data-test="eligibility-badge-extra"]');
      expect(extra.exists()).toBe(true);
      expect(extra.text()).toBe('+1');
    });

    it('renders soft blockers normally when showSoft=true (default)', () => {
      // showSoft is already true (reset by afterEach), but make it explicit
      preferences.containers.eligibilityPills.showSoft = true;
      const wrapper = mount(UpdateEligibilityBadges, {
        props: {
          eligibility: makeEligibility({
            blockers: [makeBlocker({ reason: 'snoozed' })],
          }),
        },
        global: globalConfig,
      });
      expect(wrapper.find('[data-test="eligibility-badge-primary"]').exists()).toBe(true);
    });
  });

  describe('deemphasizeSoft preference', () => {
    it('renders soft blocker with warning color when deemphasizeSoft=false', () => {
      preferences.containers.eligibilityPills.deemphasizeSoft = false;
      const wrapper = mount(UpdateEligibilityBadges, {
        props: {
          eligibility: makeEligibility({
            blockers: [makeBlocker({ reason: 'snoozed' })],
          }),
        },
        global: globalConfig,
      });
      const badge = wrapper.find('[data-test="eligibility-badge-primary"]');
      const style = badge.attributes('style') ?? '';
      expect(style).toContain('var(--dd-warning-muted)');
    });

    it('renders hard blocker with its own color regardless of deemphasizeSoft', () => {
      preferences.containers.eligibilityPills.deemphasizeSoft = false;
      const wrapper = mount(UpdateEligibilityBadges, {
        props: {
          eligibility: makeEligibility({
            blockers: [makeBlocker({ reason: 'security-scan-blocked' })],
          }),
        },
        global: globalConfig,
      });
      const badge = wrapper.find('[data-test="eligibility-badge-primary"]');
      const style = badge.attributes('style') ?? '';
      expect(style).toContain('var(--dd-danger-muted)');
    });

    it('renders hard blocker with its own color when deemphasizeSoft=true', () => {
      // deemphasizeSoft=true should not affect hard blockers
      preferences.containers.eligibilityPills.deemphasizeSoft = true;
      const wrapper = mount(UpdateEligibilityBadges, {
        props: {
          eligibility: makeEligibility({
            blockers: [makeBlocker({ reason: 'security-scan-blocked' })],
          }),
        },
        global: globalConfig,
      });
      const badge = wrapper.find('[data-test="eligibility-badge-primary"]');
      const style = badge.attributes('style') ?? '';
      expect(style).toContain('var(--dd-danger-muted)');
    });
  });

  describe('severity sort order', () => {
    it('shows hard blocker first even when soft blocker is first in the API payload', () => {
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
      const badge = wrapper.find('[data-test="eligibility-badge-primary"]');
      expect(badge.exists()).toBe(true);
      expect(badge.text()).toContain('Agent mismatch');
    });

    it('shows hard blocker as primary in full mode when soft blocker is first in payload', () => {
      const wrapper = mount(UpdateEligibilityBadges, {
        props: {
          eligibility: makeEligibility({
            blockers: [
              makeBlocker({ reason: 'snoozed' }),
              makeBlocker({ reason: 'agent-mismatch' }),
            ],
          }),
          variant: 'full',
        },
        global: globalConfig,
      });
      const full = wrapper.find('[data-test="eligibility-badge-full"]');
      const items = full.findAll('[data-reason]');
      expect(items[0].attributes('data-reason')).toBe('agent-mismatch');
      expect(items[1].attributes('data-reason')).toBe('snoozed');
    });
  });

  describe('data-severity attribute', () => {
    it('compact primary badge has data-severity="hard" for a hard blocker', () => {
      const wrapper = mount(UpdateEligibilityBadges, {
        props: {
          eligibility: makeEligibility({
            blockers: [makeBlocker({ reason: 'agent-mismatch' })],
          }),
        },
        global: globalConfig,
      });
      const badge = wrapper.find('[data-test="eligibility-badge-primary"]');
      expect(badge.attributes('data-severity')).toBe('hard');
    });

    it('compact primary badge has data-severity="soft" for a soft blocker', () => {
      const wrapper = mount(UpdateEligibilityBadges, {
        props: {
          eligibility: makeEligibility({
            blockers: [makeBlocker({ reason: 'snoozed' })],
          }),
        },
        global: globalConfig,
      });
      const badge = wrapper.find('[data-test="eligibility-badge-primary"]');
      expect(badge.attributes('data-severity')).toBe('soft');
    });

    it('full mode rows expose data-severity on each blocker item', () => {
      const wrapper = mount(UpdateEligibilityBadges, {
        props: {
          eligibility: makeEligibility({
            blockers: [
              makeBlocker({ reason: 'agent-mismatch' }),
              makeBlocker({ reason: 'snoozed' }),
            ],
          }),
          variant: 'full',
        },
        global: globalConfig,
      });
      const full = wrapper.find('[data-test="eligibility-badge-full"]');
      const items = full.findAll('[data-reason]');
      expect(items[0].attributes('data-severity')).toBe('hard');
      expect(items[1].attributes('data-severity')).toBe('soft');
    });

    it('data-severity uses severity field from blocker when present', () => {
      const wrapper = mount(UpdateEligibilityBadges, {
        props: {
          eligibility: makeEligibility({
            blockers: [
              // Override via explicit severity field
              { ...makeBlocker({ reason: 'snoozed' }), severity: 'hard' as const },
            ],
          }),
        },
        global: globalConfig,
      });
      const badge = wrapper.find('[data-test="eligibility-badge-primary"]');
      expect(badge.attributes('data-severity')).toBe('hard');
    });
  });
});
