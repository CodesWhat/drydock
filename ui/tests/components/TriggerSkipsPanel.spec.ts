import { flushPromises } from '@vue/test-utils';
import { defineComponent } from 'vue';
import TriggerSkipsPanel from '@/components/TriggerSkipsPanel.vue';
import { getTriggerSkips } from '@/services/trigger';
import { mountWithPlugins } from '../helpers/mount';

vi.mock('@/services/trigger', () => ({ getTriggerSkips: vi.fn() }));

const mockGetTriggerSkips = getTriggerSkips as ReturnType<typeof vi.fn>;
const RouterLink = defineComponent({
  props: ['to'],
  template: '<a class="link" :data-to="JSON.stringify(to)"><slot /></a>',
});

function skip(containerId: string, overrides: Record<string, unknown> = {}) {
  return {
    containerId,
    containerName: `name-${containerId}`,
    reason: 'threshold-not-met',
    at: '2026-10-22T10:00:00.000Z',
    ...overrides,
  };
}

function page(data: unknown[], extra: Record<string, unknown> = {}) {
  return { data, total: data.length, limit: 20, offset: 0, hasMore: false, ...extra };
}

function mountPanel(
  trigger = { type: 'slack', name: 'ops' } as Record<string, unknown>,
  label?: string,
) {
  return mountWithPlugins(TriggerSkipsPanel, {
    props: { trigger: trigger as never, label },
    global: { stubs: { RouterLink } },
  });
}

describe('TriggerSkipsPanel', () => {
  beforeEach(() => {
    mockGetTriggerSkips.mockReset();
  });

  it('lists skips with readable reason text and a container link', async () => {
    mockGetTriggerSkips.mockResolvedValue(
      page([
        skip('c1'),
        skip('c2', { containerName: null, reason: 'digest-buffered', at: 'not-a-date' }),
      ]),
    );
    const wrapper = mountPanel({ type: 'slack', name: 'ops', agent: 'edge' }, 'ops');
    expect(wrapper.text()).toContain('Loading skips...');
    await flushPromises();

    expect(mockGetTriggerSkips).toHaveBeenCalledWith({
      type: 'slack',
      name: 'ops',
      agent: 'edge',
      limit: 20,
      offset: 0,
    });
    const rows = wrapper.findAll('[data-test="trigger-skip"]');
    expect(rows).toHaveLength(2);
    expect(rows[0].get('[data-test="trigger-skip-container"]').text()).toBe('name-c1');
    expect(rows[0].get('[data-test="trigger-skip-container"]').attributes('data-to')).toBe(
      JSON.stringify({ path: '/containers', query: { containerIds: 'c1' } }),
    );
    expect(rows[0].get('[data-test="trigger-skip-reason"]').text()).toBe(
      "Skipped: the update is below this trigger's threshold.",
    );
    expect(rows[0].get('[data-test="trigger-skip-time"]').text()).toBe(
      new Date('2026-10-22T10:00:00.000Z').toLocaleString(),
    );
    expect(rows[1].get('[data-test="trigger-skip-container"]').text()).toBe('c2');
    expect(rows[1].get('[data-test="trigger-skip-reason"]').text()).toBe(
      'Held for the next digest.',
    );
    expect(rows[1].get('[data-test="trigger-skip-time"]').text()).toBe('not-a-date');
    expect(wrapper.get('[data-test="trigger-skips-label"]').text()).toBe('ops');
    expect(wrapper.find('[data-test="trigger-skips-more"]').exists()).toBe(false);
  });

  it('shows the empty state', async () => {
    mockGetTriggerSkips.mockResolvedValue(page([]));
    const wrapper = mountPanel();
    await flushPromises();

    expect(wrapper.get('[data-test="trigger-skips-empty"]').text()).toBe('No recent skips');
    expect(wrapper.find('[data-test="trigger-skips-label"]').exists()).toBe(false);
  });

  it('shows an error when the first load fails', async () => {
    mockGetTriggerSkips.mockRejectedValue(new Error('boom'));
    const wrapper = mountPanel();
    await flushPromises();

    expect(wrapper.get('[data-test="trigger-skips-error"]').text()).toBe(
      'Unable to load recent skips',
    );
    expect(wrapper.find('[data-test="trigger-skips-empty"]').exists()).toBe(false);
  });

  it('appends the next page and keeps rows when loading more fails', async () => {
    mockGetTriggerSkips
      .mockResolvedValueOnce(page([skip('c1')], { total: 3, hasMore: true }))
      .mockResolvedValueOnce(page([skip('c2')], { total: 3, offset: 1, hasMore: true }))
      .mockRejectedValueOnce(new Error('boom'));
    const wrapper = mountPanel();
    await flushPromises();

    await wrapper.get('[data-test="trigger-skips-more"]').trigger('click');
    await flushPromises();
    expect(mockGetTriggerSkips).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 1 }));
    expect(wrapper.findAll('[data-test="trigger-skip"]')).toHaveLength(2);

    await wrapper.get('[data-test="trigger-skips-more"]').trigger('click');
    await flushPromises();
    expect(wrapper.findAll('[data-test="trigger-skip"]')).toHaveLength(2);
    expect(wrapper.find('[data-test="trigger-skips-error"]').exists()).toBe(true);
  });

  it('reloads when the trigger changes and ignores stale responses', async () => {
    let resolveFirst: (value: unknown) => void = () => {};
    mockGetTriggerSkips
      .mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce(page([skip('new')]));
    const wrapper = mountPanel();
    await wrapper.setProps({ trigger: { type: 'slack', name: 'other' } as never });
    await flushPromises();
    resolveFirst(page([skip('stale')]));
    await flushPromises();

    const rows = wrapper.findAll('[data-test="trigger-skip-container"]');
    expect(rows.map((row) => row.text())).toEqual(['name-new']);
  });

  it('drops a stale failure after the trigger changed', async () => {
    let rejectFirst: (error: Error) => void = () => {};
    mockGetTriggerSkips
      .mockReturnValueOnce(new Promise((_, reject) => (rejectFirst = reject)))
      .mockResolvedValueOnce(page([skip('new')]));
    const wrapper = mountPanel();
    await wrapper.setProps({ trigger: { type: 'slack', name: 'other' } as never });
    await flushPromises();
    rejectFirst(new Error('late'));
    await flushPromises();

    expect(wrapper.find('[data-test="trigger-skips-error"]').exists()).toBe(false);
    expect(wrapper.findAll('[data-test="trigger-skip"]')).toHaveLength(1);
  });

  it('clears shown rows when the first page of a changed trigger fails', async () => {
    mockGetTriggerSkips
      .mockResolvedValueOnce(page([skip('c1')], { total: 1 }))
      .mockRejectedValueOnce(new Error('boom'));
    const wrapper = mountPanel();
    await flushPromises();
    expect(wrapper.findAll('[data-test="trigger-skip"]')).toHaveLength(1);

    await wrapper.setProps({ trigger: { type: 'slack', name: 'other' } as never });
    await flushPromises();

    expect(wrapper.findAll('[data-test="trigger-skip"]')).toHaveLength(0);
    expect(wrapper.find('[data-test="trigger-skips-error"]').exists()).toBe(true);
  });

  it('replaces rows instead of appending when the trigger changes', async () => {
    mockGetTriggerSkips
      .mockResolvedValueOnce(page([skip('c1'), skip('c2')]))
      .mockResolvedValueOnce(page([skip('c3')]));
    const wrapper = mountPanel();
    await flushPromises();
    await wrapper.setProps({ trigger: { type: 'slack', name: 'other' } as never });
    await flushPromises();

    expect(mockGetTriggerSkips).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 0 }));
    const rows = wrapper.findAll('[data-test="trigger-skip-container"]');
    expect(rows.map((row) => row.text())).toEqual(['name-c3']);
  });
});
