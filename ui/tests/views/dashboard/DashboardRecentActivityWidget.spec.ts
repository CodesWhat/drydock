import type { VueWrapper } from '@vue/test-utils';
import type { AuditEntry } from '@/utils/audit-helpers';
import DashboardRecentActivityWidget from '@/views/dashboard/components/DashboardRecentActivityWidget.vue';
import { mountWithPlugins } from '../../helpers/mount';

const mountedWrappers: VueWrapper[] = [];

function makeEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: 'a1',
    timestamp: new Date(Date.now() - 5 * 60_000).toISOString(),
    action: 'update-applied',
    containerName: 'nginx',
    status: 'success',
    triggerName: 'docker.local',
    ...overrides,
  };
}

function mountWidget(
  props: Partial<InstanceType<typeof DashboardRecentActivityWidget>['$props']> = {},
) {
  const wrapper = mountWithPlugins(DashboardRecentActivityWidget, {
    props: { editMode: false, entries: [], error: null, loading: false, ...props },
  });
  mountedWrappers.push(wrapper);
  return wrapper;
}

describe('DashboardRecentActivityWidget', () => {
  afterEach(() => {
    mountedWrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  });

  it('renders timestamp, actor, action and target for each entry', () => {
    const wrapper = mountWidget({
      entries: [
        makeEntry(),
        makeEntry({
          id: 'a2',
          action: 'agent-disconnect',
          containerName: 'edge-1',
          triggerName: undefined,
          status: 'error',
        }),
      ],
    });

    const rows = wrapper.findAll('[data-activity-row]');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.text()).toContain('nginx');
    expect(rows[0]!.text()).toContain('docker.local');
    expect(rows[0]!.text().toLowerCase()).toContain('update');
    expect(rows[0]!.find('span[title]').text()).not.toBe('');
    expect(rows[1]!.text()).toContain('edge-1');
    expect(rows[1]!.text()).toContain('System');
  });

  it('emits openEntry for a row and viewAll from the header link', async () => {
    const entry = makeEntry();
    const wrapper = mountWidget({ entries: [entry] });

    await wrapper.get('[data-activity-row]').trigger('click');
    expect(wrapper.emitted('openEntry')).toEqual([[entry]]);

    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('viewAll')).toHaveLength(1);
  });

  it('shows loading, error and empty states', async () => {
    const wrapper = mountWidget({ loading: true });
    expect(wrapper.text()).toContain('Loading activity');

    await wrapper.setProps({ loading: false, error: 'boom' });
    expect(wrapper.text()).toContain('Failed to load recent activity');

    await wrapper.setProps({ error: null });
    expect(wrapper.text()).toContain('No recent activity');
  });

  it('keeps showing entries when a later refresh errors', async () => {
    const wrapper = mountWidget({ entries: [makeEntry()], error: 'boom' });

    expect(wrapper.findAll('[data-activity-row]')).toHaveLength(1);
    expect(wrapper.text()).not.toContain('Failed to load recent activity');
  });

  it('shows a drag handle in edit mode only', async () => {
    const wrapper = mountWidget();
    expect(wrapper.find('.drag-handle').exists()).toBe(false);

    await wrapper.setProps({ editMode: true });
    expect(wrapper.find('.drag-handle').exists()).toBe(true);
  });
});
