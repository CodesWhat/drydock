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
});
