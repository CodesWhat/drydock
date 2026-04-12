import ContainersGroupHeader from '@/components/containers/ContainersGroupHeader.vue';
import { mountWithPlugins } from '../../helpers/mount';

function mountHeader(
  overrides: Partial<InstanceType<typeof ContainersGroupHeader>['$props']> = {},
) {
  return mountWithPlugins(ContainersGroupHeader, {
    props: {
      group: {
        key: 'stack-a',
        name: 'stack-a',
        containers: [],
        containerCount: 3,
        updatesAvailable: 3,
        updatableCount: 3,
      },
      collapsed: false,
      containerActionsEnabled: true,
      containerActionsDisabledReason: 'Disabled by server',
      inProgress: false,
      tt: (label: string) => ({ value: label, showDelay: 400 }),
      ...overrides,
    },
    global: {
      directives: {
        tooltip: {},
      },
    },
  });
}

describe('ContainersGroupHeader', () => {
  it('renders the idle update-all state when no batch is active', () => {
    const wrapper = mountHeader();

    expect(wrapper.text()).toContain('Update all');
    expect(wrapper.text()).not.toContain('Updating stack');
    expect(wrapper.find('button[disabled]').exists()).toBe(false);
  });

  it('keeps the single-container loading copy spinner-only without batch progress text', () => {
    const wrapper = mountHeader({
      group: {
        key: 'stack-a',
        name: 'stack-a',
        containers: [],
        containerCount: 1,
        updatesAvailable: 1,
        updatableCount: 1,
      },
      inProgress: true,
      frozenTotal: 1,
      doneCount: 0,
    });

    expect(wrapper.text()).toContain('Update all');
    expect(wrapper.text()).not.toContain('Updating stack');
    expect(wrapper.find('button[disabled]').exists()).toBe(true);
  });

  // DO NOT REGRESS: per-card "N of M" update labels are a 2026 UX anti-pattern.
  // Batch progress belongs in the group header and container cards stay phase-only.
  it('renders active multi-container progress with frozen batch counts', async () => {
    const wrapper = mountHeader({
      inProgress: true,
      frozenTotal: 5,
      doneCount: 2,
    });

    expect(wrapper.text()).toContain('Updating stack · 2 of 5 done');
    expect(wrapper.find('button[disabled]').exists()).toBe(true);

    await wrapper.setProps({
      doneCount: 4,
    });

    expect(wrapper.text()).toContain('Updating stack · 4 of 5 done');
  });

  it('returns to the idle state after the batch clears', () => {
    const wrapper = mountHeader({
      inProgress: false,
      frozenTotal: undefined,
      doneCount: undefined,
    });

    expect(wrapper.text()).toContain('Update all');
    expect(wrapper.text()).not.toContain('Updating stack');
  });
});
