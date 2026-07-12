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

  // #467: on rc.4, existing users' default column set overflows the table at moderate desktop
  // widths (see DataTable.spec.ts "column width shrink-to-fit (#467)"), and the group header's
  // full-row <td> renders as wide as the overflowing row. Without sticky positioning, the
  // "Update all" button scrolls out of the visible area. Pin it to the logical end edge (RTL
  // safe) so it stays reachable regardless of overflow.
  it('pins the update-all action to the end edge so it stays visible when the row overflows (#467)', () => {
    const wrapper = mountHeader();
    const sticky = wrapper.find('[data-test="group-header-update-all-sticky"]');

    expect(sticky.exists()).toBe(true);
    expect(sticky.classes()).toEqual(expect.arrayContaining(['sticky', 'end-0']));
    expect(sticky.find('button').exists()).toBe(true);
  });

  it('uses tighter spacing for the first group and looser spacing for later groups', async () => {
    const wrapper = mountHeader({ isFirst: true });

    expect(wrapper.classes()).toContain('mt-2');
    expect(wrapper.classes()).not.toContain('mt-9');

    await wrapper.setProps({ isFirst: false });

    expect(wrapper.classes()).toContain('mt-9');
    expect(wrapper.classes()).not.toContain('mt-2');
  });

  it('silences update counts and update-all controls in notify mode', () => {
    const wrapper = mountHeader({ showUpdateControls: false });

    expect(wrapper.text()).not.toContain('3 updates');
    expect(wrapper.text()).not.toContain('Update all');
    expect(wrapper.find('[data-test="group-header-update-all-sticky"]').exists()).toBe(false);
  });
});
