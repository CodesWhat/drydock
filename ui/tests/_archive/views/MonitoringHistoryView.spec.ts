import { mount } from '@vue/test-utils';
import MonitoringHistoryView from '@/views/MonitoringHistoryView.vue';

vi.mock('@/services/audit', () => ({
  getAuditLog: vi.fn(),
}));

import { getAuditLog } from '@/services/audit';

const mockEntries = [
  {
    id: '1',
    timestamp: '2025-01-15T10:30:00Z',
    action: 'update-applied',
    containerName: 'nginx',
    fromVersion: '1.0.0',
    toVersion: '1.1.0',
    status: 'success',
  },
  {
    id: '2',
    timestamp: '2025-01-15T09:00:00Z',
    action: 'update-available',
    containerName: 'redis',
    fromVersion: '7.0',
    toVersion: '7.2',
    status: 'info',
  },
];

describe('MonitoringHistoryView', () => {
  let wrapper;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  it('shows empty state when no entries', async () => {
    (getAuditLog as any).mockResolvedValue({ entries: [], total: 0 });
    wrapper = mount(MonitoringHistoryView);
    await new Promise((r) => setTimeout(r, 10));

    expect(wrapper.text()).toContain('No update history yet');
  });

  it('renders entries in the table', async () => {
    (getAuditLog as any).mockResolvedValue({ entries: mockEntries, total: 2 });
    wrapper = mount(MonitoringHistoryView);
    await new Promise((r) => setTimeout(r, 10));

    expect(wrapper.text()).toContain('nginx');
    expect(wrapper.text()).toContain('redis');
    expect(wrapper.text()).toContain('update-applied');
    expect(wrapper.text()).toContain('update-available');
  });

  it('calls getAuditLog on mount', async () => {
    (getAuditLog as any).mockResolvedValue({ entries: [], total: 0 });
    wrapper = mount(MonitoringHistoryView);
    await new Promise((r) => setTimeout(r, 10));

    expect(getAuditLog).toHaveBeenCalledWith({
      page: 1,
      limit: 20,
    });
  });

  it('shows error state on failure', async () => {
    (getAuditLog as any).mockRejectedValue(new Error('Server error'));
    wrapper = mount(MonitoringHistoryView);
    await new Promise((r) => setTimeout(r, 10));

    expect(wrapper.vm.error).toBe('Server error');
  });

  it('formats timestamps correctly', () => {
    (getAuditLog as any).mockResolvedValue({ entries: [], total: 0 });
    wrapper = mount(MonitoringHistoryView);

    expect(wrapper.vm.formatTimestamp('2025-01-15T10:30:00Z')).toBeTruthy();
    expect(wrapper.vm.formatTimestamp('')).toBe('-');
  });

  it('formats timestamps in compact mode when smAndUp is false', () => {
    (getAuditLog as any).mockResolvedValue({ entries: [], total: 0 });
    wrapper = mount(MonitoringHistoryView);
    wrapper.vm.smAndUp = false;

    const formatted = wrapper.vm.formatTimestamp('2025-01-15T10:30:00Z');
    expect(formatted).toMatch(/^[A-Za-z]{3} \d{1,2} /);
  });

  it('returns correct action colors', () => {
    (getAuditLog as any).mockResolvedValue({ entries: [], total: 0 });
    wrapper = mount(MonitoringHistoryView);

    expect(wrapper.vm.actionColor('update-applied')).toBe('success');
    expect(wrapper.vm.actionColor('update-failed')).toBe('error');
    expect(wrapper.vm.actionColor('unknown')).toBe('default');
  });

  it('returns correct status colors', () => {
    (getAuditLog as any).mockResolvedValue({ entries: [], total: 0 });
    wrapper = mount(MonitoringHistoryView);

    expect(wrapper.vm.statusColor('success')).toBe('success');
    expect(wrapper.vm.statusColor('error')).toBe('error');
    expect(wrapper.vm.statusColor('info')).toBe('info');
    expect(wrapper.vm.statusColor('unknown')).toBe('default');
  });

  it('resets page to 1 when filter changes', async () => {
    (getAuditLog as any).mockResolvedValue({ entries: mockEntries, total: 50 });
    wrapper = mount(MonitoringHistoryView);
    await new Promise((r) => setTimeout(r, 10));

    wrapper.vm.currentPage = 3;
    wrapper.vm.filterAction = 'update-applied';
    await new Promise((r) => setTimeout(r, 10));

    expect(wrapper.vm.currentPage).toBe(1);
  });

  it('resets page to 1 when container filter changes', async () => {
    (getAuditLog as any).mockResolvedValue({ entries: mockEntries, total: 50 });
    wrapper = mount(MonitoringHistoryView);
    await new Promise((r) => setTimeout(r, 10));

    wrapper.vm.currentPage = 2;
    wrapper.vm.filterContainer = 'nginx';
    await new Promise((r) => setTimeout(r, 10));

    expect(wrapper.vm.currentPage).toBe(1);
  });

  it('computes totalPages correctly', async () => {
    (getAuditLog as any).mockResolvedValue({ entries: mockEntries, total: 50 });
    wrapper = mount(MonitoringHistoryView);
    await new Promise((r) => setTimeout(r, 10));

    expect(wrapper.vm.totalPages).toBe(3); // 50 / 20 = 2.5, ceil = 3
  });

  it('computes activeFilterCount based on filter fields', async () => {
    (getAuditLog as any).mockResolvedValue({ entries: [], total: 0 });
    wrapper = mount(MonitoringHistoryView);
    await new Promise((r) => setTimeout(r, 10));

    wrapper.vm.filterAction = 'update-applied';
    wrapper.vm.filterContainer = 'nginx';
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.activeFilterCount).toBe(2);
  });

  it('toggles filters panel from toolbar button click', async () => {
    (getAuditLog as any).mockResolvedValue({ entries: [], total: 0 });
    wrapper = mount(MonitoringHistoryView);
    await new Promise((r) => setTimeout(r, 10));

    expect(wrapper.vm.showFilters).toBe(false);
    await wrapper.find('.v-btn').trigger('click');
    expect(wrapper.vm.showFilters).toBe(true);
  });

  it('updates filters through select/text-field v-model handlers', async () => {
    (getAuditLog as any).mockResolvedValue({ entries: mockEntries, total: 2 });
    wrapper = mount(MonitoringHistoryView);
    await new Promise((r) => setTimeout(r, 10));
    wrapper.vm.showFilters = true;
    await wrapper.vm.$nextTick();

    const selects = wrapper.findAll('select.v-select');
    expect(selects.length).toBeGreaterThan(0);
    await selects[0].setValue('update-applied');

    const input = wrapper.find('input.v-text-field');
    await input.setValue('nginx');

    expect(wrapper.vm.filterAction).toBe('update-applied');
    expect(wrapper.vm.filterContainer).toBe('nginx');
  });

  it('clears active chips via click:close handlers', async () => {
    const customWrapper = mount(MonitoringHistoryView, {
      global: {
        stubs: {
          'v-chip': {
            template: '<span class="v-chip" @click="$emit(\'click:close\')"><slot /></span>',
            emits: ['click:close'],
          },
        },
      },
    });

    try {
      await customWrapper.setData({
        loading: false,
        entries: mockEntries,
        total: 2,
        filterAction: 'update-applied',
        filterContainer: 'nginx',
      });

      const chips = customWrapper.findAll('.v-chip');
      expect(chips.length).toBeGreaterThanOrEqual(2);
      await chips[0].trigger('click');
      await chips[1].trigger('click');

      expect(customWrapper.vm.filterAction).toBeNull();
      expect(customWrapper.vm.filterContainer).toBe('');
    } finally {
      customWrapper.unmount();
    }
  });

  it('renders fallback "-" versions when from/to are missing', async () => {
    (getAuditLog as any).mockResolvedValue({
      entries: [
        {
          id: 'missing-version',
          timestamp: '2025-01-15T10:30:00Z',
          action: 'update-available',
          containerName: 'redis',
          status: 'info',
        },
      ],
      total: 1,
    });

    wrapper = mount(MonitoringHistoryView);
    await new Promise((r) => setTimeout(r, 10));

    expect(wrapper.find('.audit-table').text()).toContain('-');
  });

  it('updates currentPage from pagination model event', async () => {
    (getAuditLog as any).mockResolvedValue({
      entries: mockEntries,
      total: 40,
    });

    const customWrapper = mount(MonitoringHistoryView, {
      global: {
        stubs: {
          'v-pagination': {
            template: '<div class="v-pagination" @click="$emit(\'update:modelValue\', 2)"></div>',
            props: ['modelValue', 'length'],
            emits: ['update:modelValue'],
          },
        },
      },
    });

    try {
      await new Promise((r) => setTimeout(r, 10));
      await customWrapper.vm.$nextTick();

      expect(customWrapper.find('.v-pagination').exists()).toBe(true);
      await customWrapper.find('.v-pagination').trigger('click');
      expect(customWrapper.vm.currentPage).toBe(2);
    } finally {
      customWrapper.unmount();
    }
  });

  it('passes action and container filters to audit API', async () => {
    (getAuditLog as any).mockResolvedValue({ entries: [], total: 0 });
    wrapper = mount(MonitoringHistoryView);
    await new Promise((r) => setTimeout(r, 10));
    (getAuditLog as any).mockClear();

    wrapper.vm.filterAction = 'update-applied';
    wrapper.vm.filterContainer = 'nginx';
    await wrapper.vm.fetchEntries();

    expect(getAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'update-applied',
        container: 'nginx',
      }),
    );
  });

  it('falls back to empty entries when API payload has no entries array', async () => {
    (getAuditLog as any).mockResolvedValueOnce({ total: 4 });
    wrapper = mount(MonitoringHistoryView);
    await new Promise((r) => setTimeout(r, 10));

    expect(wrapper.vm.entries).toEqual([]);
    expect(wrapper.vm.total).toBe(4);
  });

  it('uses fallback error message when fetch throws without message', async () => {
    (getAuditLog as any).mockRejectedValueOnce({});
    wrapper = mount(MonitoringHistoryView);
    await new Promise((r) => setTimeout(r, 10));

    expect(wrapper.vm.error).toBe('Failed to fetch audit log');
  });
});
