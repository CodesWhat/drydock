import { mount } from '@vue/test-utils';
import UpdateStatusPanel from '@/components/containers/UpdateStatusPanel.vue';
import type { UpdateEligibility } from '@/types/container';

const routerPush = vi.fn();

vi.mock('vue-router', async () => {
  const actual = await vi.importActual<typeof import('vue-router')>('vue-router');
  return { ...actual, useRouter: () => ({ push: routerPush }) };
});

function eligibility(
  reason?: 'snoozed' | 'security-scan-blocked' | 'trigger-not-included',
): UpdateEligibility {
  return {
    eligible: reason === undefined,
    blockers: reason
      ? [
          {
            reason,
            severity: reason === 'security-scan-blocked' ? 'hard' : 'soft',
            message: 'Condition detail.',
            actionable: true,
          },
        ]
      : [],
    evaluatedAt: '2026-07-12T00:00:00.000Z',
  };
}

function container(reason?: 'snoozed' | 'security-scan-blocked' | 'trigger-not-included') {
  return {
    id: 'container-1',
    name: 'nginx',
    newTag: '1.2.3',
    updateEligibility: eligibility(reason),
  };
}

describe('UpdateStatusPanel', () => {
  beforeEach(() => routerPush.mockReset());

  it('renders the summary and emits a manual update request', async () => {
    const wrapper = mount(UpdateStatusPanel, {
      props: { container: container(), mode: 'manual' },
      global: { stubs: { AppIcon: { template: '<span />' } } },
    });

    expect(wrapper.get('[data-test="update-status-summary"]').text()).toContain(
      'Update available — ready to apply manually.',
    );
    await wrapper.get('[data-test="update-status-manual-cta"]').trigger('click');
    expect(wrapper.emitted('update')).toHaveLength(1);
    // No conditions, no dryRunTriggerId, no insightNote — the details block's
    // three-way v-if should stay entirely closed.
    expect(wrapper.find('details').exists()).toBe(false);
  });

  it('renders a pinned-tag insight as an up-to-date state with an informational detail row (#498)', () => {
    const wrapper = mount(UpdateStatusPanel, {
      props: {
        container: {
          id: 'container-1',
          name: 'immich-machine-learning',
          newTag: null,
          updateInsight: { tag: 'v3.0.2-openvino', kind: 'major' as const },
          updateEligibility: eligibility(),
        },
        mode: 'manual',
      },
      global: { stubs: { AppIcon: { template: '<span />' } } },
    });

    // Pinned-ness is not an update state (#498 display honesty): the panel reads
    // up-to-date, and the held-back tag surfaces only via the insight detail row.
    expect(wrapper.get('[data-test="update-status-panel"]').attributes('data-state')).toBe(
      'up-to-date',
    );
    expect(wrapper.get('[data-test="update-status-summary"]').text()).toBe('Up to date.');
    const insightRow = wrapper.get('[data-reason="update-insight"]');
    expect(insightRow.attributes('data-tone')).toBe('info');
    expect(insightRow.text()).toBe(
      "Newer version available: v3.0.2-openvino. This tag is pinned — drydock won't update it automatically.",
    );
    expect(wrapper.find('[data-test="update-status-manual-cta"]').exists()).toBe(false);
  });

  it('keeps notify-mode conditions collapsed and disables the CTA', () => {
    const wrapper = mount(UpdateStatusPanel, {
      props: { container: container('snoozed'), mode: 'notify' },
      global: { stubs: { AppIcon: { template: '<span />' } } },
    });

    expect(wrapper.get('details').attributes('open')).toBeUndefined();
    expect(wrapper.get('[data-test="update-status-manual-cta"]').attributes()).toHaveProperty(
      'disabled',
    );
  });

  it('emits an in-panel tab action for policy conditions', async () => {
    const wrapper = mount(UpdateStatusPanel, {
      props: { container: container('snoozed'), mode: 'manual' },
      global: { stubs: { AppIcon: { template: '<span />' } } },
    });

    await wrapper.get('[data-test="update-status-action-snoozed"]').trigger('click');
    expect(wrapper.emitted('open-tab')).toEqual([['actions', 'update-policy']]);
  });

  it('navigates to an existing route for route-backed conditions', async () => {
    const wrapper = mount(UpdateStatusPanel, {
      props: { container: container('security-scan-blocked'), mode: 'manual' },
      global: { stubs: { AppIcon: { template: '<span />' } } },
    });

    await wrapper.get('[data-test="update-status-action-security-scan-blocked"]').trigger('click');
    expect(routerPush).toHaveBeenCalledWith({ path: '/security' });
  });

  it('renders configuration docs actions as safe accessible external links', () => {
    const wrapper = mount(UpdateStatusPanel, {
      props: { container: container('trigger-not-included'), mode: 'manual' },
      global: { stubs: { AppIcon: { template: '<span />' } } },
    });

    const action = wrapper.get('[data-test="update-status-action-trigger-not-included"]');
    expect(action.element.tagName).toBe('A');
    expect(action.attributes('href')).toBe(
      'https://getdrydock.com/docs/configuration/actions/update-eligibility#reasons-reference',
    );
    expect(action.attributes('target')).toBe('_blank');
    expect(action.attributes('rel')).toBe('noopener noreferrer');
    expect(action.text()).toBe('Configure trigger labels');
  });

  it('renders each condition with its own severity tone', () => {
    const wrapper = mount(UpdateStatusPanel, {
      props: {
        container: {
          ...container(),
          updateEligibility: {
            eligible: false,
            evaluatedAt: '2026-07-12T00:00:00.000Z',
            blockers: [
              {
                reason: 'security-scan-blocked',
                severity: 'hard',
                message: 'Security blocked.',
                actionable: true,
              },
              {
                reason: 'snoozed',
                severity: 'soft',
                message: 'Snoozed.',
                actionable: true,
              },
            ],
          },
        },
        mode: 'manual',
      },
      global: { stubs: { AppIcon: { template: '<span />' } } },
    });

    expect(wrapper.get('[data-reason="security-scan-blocked"]').attributes('data-tone')).toBe(
      'danger',
    );
    expect(wrapper.get('[data-reason="snoozed"]').attributes('data-tone')).toBe('warning');
  });

  it('renders one collapsed lift-countdown line for a liftable condition (#display-honesty)', () => {
    const wrapper = mount(UpdateStatusPanel, {
      props: {
        container: {
          id: 'container-1',
          name: 'nginx',
          newTag: '1.2.3',
          updateEligibility: {
            eligible: false,
            evaluatedAt: '2026-07-12T00:00:00.000Z',
            blockers: [
              {
                reason: 'maturity-not-reached',
                severity: 'soft',
                message: 'Maturity policy requires updates to be at least 7 days old.',
                actionable: true,
                liftableAt: '2026-07-18T12:00:00.000Z',
                details: { minAgeDays: 7 },
              },
            ],
          },
        },
        mode: 'manual',
      },
      global: { stubs: { AppIcon: { template: '<span />' } } },
    });

    const condition = wrapper.get('[data-reason="maturity-not-reached"]');
    // The old two-line rendering (countdown span + a separate "Lifts at {date}" line)
    // collapsed into one liftCountdown line: "{countdown} · unlocks {date}".
    const countdownLine = condition.find('.dd-text-muted');
    expect(countdownLine.exists()).toBe(true);
    expect(countdownLine.text()).toContain('unlocks');
    expect(countdownLine.text()).toMatch(/^.+ · unlocks .+$/);
  });

  it('shows the effective dry-run trigger and labels the update action as preview-only', () => {
    const wrapper = mount(UpdateStatusPanel, {
      props: {
        container: container(),
        mode: 'manual',
        dryRunTriggerId: 'docker.local',
      },
      global: { stubs: { AppIcon: { template: '<span />' } } },
    });

    expect(wrapper.get('[data-reason="dry-run-trigger"]').text()).toContain(
      'Action trigger docker.local is in dry-run mode',
    );
    expect(wrapper.get('[data-test="update-status-manual-cta"]').text()).toBe('Preview only');
    expect(wrapper.get('[data-test="update-status-manual-cta"]').classes()).toContain('min-h-11');
  });
});
