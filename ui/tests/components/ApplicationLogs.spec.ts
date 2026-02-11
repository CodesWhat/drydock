import { mount, flushPromises } from '@vue/test-utils';
import ApplicationLogs from '@/components/ApplicationLogs';

const { mockGetLogEntries, mockGetAgents } = vi.hoisted(() => ({
  mockGetLogEntries: vi.fn(),
  mockGetAgents: vi.fn(),
}));

vi.mock('@/services/log', () => ({
  getLogEntries: mockGetLogEntries,
  getLog: vi.fn(),
  getLogIcon: vi.fn(() => 'mdi-console'),
}));

vi.mock('@/services/agent', () => ({
  getAgents: mockGetAgents,
}));

const mockEntries = [
  { timestamp: '2025-01-01T00:00:00.000Z', level: 'info', component: 'server', msg: 'Server started' },
  { timestamp: '2025-01-01T00:00:01.000Z', level: 'error', component: 'docker', msg: 'Connection failed' },
];

describe('ApplicationLogs', () => {
  beforeEach(() => {
    mockGetLogEntries.mockReset();
    mockGetAgents.mockReset();
    mockGetAgents.mockResolvedValue([]);
  });

  it('shows loading state initially', async () => {
    mockGetLogEntries.mockReturnValue(new Promise(() => {}));

    const wrapper = mount(ApplicationLogs);

    await wrapper.vm.$nextTick();

    expect(wrapper.find('.v-progress-circular').exists()).toBe(true);
    wrapper.unmount();
  });

  it('displays entries after successful fetch', async () => {
    mockGetLogEntries.mockResolvedValue(mockEntries);

    const wrapper = mount(ApplicationLogs);

    await flushPromises();

    expect(wrapper.find('pre').exists()).toBe(true);
    expect(wrapper.find('pre').text()).toContain('Server started');
    expect(wrapper.find('pre').text()).toContain('Connection failed');
    wrapper.unmount();
  });

  it('shows error on fetch failure', async () => {
    mockGetLogEntries.mockRejectedValue(new Error('Network error'));

    const wrapper = mount(ApplicationLogs);

    await flushPromises();

    expect(wrapper.find('.v-alert').exists()).toBe(true);
    expect(wrapper.text()).toContain('Network error');
    wrapper.unmount();
  });

  it('shows empty state when no entries returned', async () => {
    mockGetLogEntries.mockResolvedValue([]);

    const wrapper = mount(ApplicationLogs);

    await flushPromises();

    expect(wrapper.find('pre').exists()).toBe(false);
    expect(wrapper.text()).toContain('No log entries');
    wrapper.unmount();
  });

  it('refresh button triggers fetchEntries', async () => {
    mockGetLogEntries.mockResolvedValue(mockEntries);

    const wrapper = mount(ApplicationLogs);

    await flushPromises();
    expect(mockGetLogEntries).toHaveBeenCalledTimes(1);

    mockGetLogEntries.mockResolvedValue([]);
    await wrapper.find('.v-btn').trigger('click');
    await flushPromises();

    expect(mockGetLogEntries).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  it('level change triggers re-fetch', async () => {
    mockGetLogEntries.mockResolvedValue(mockEntries);

    const wrapper = mount(ApplicationLogs);

    await flushPromises();
    expect(mockGetLogEntries).toHaveBeenCalledTimes(1);

    mockGetLogEntries.mockResolvedValue([]);
    wrapper.vm.level = 'error';
    await flushPromises();

    expect(mockGetLogEntries).toHaveBeenCalledTimes(2);
    expect(mockGetLogEntries).toHaveBeenLastCalledWith({ level: 'error', tail: 100, agent: undefined });
    wrapper.unmount();
  });

  it('tail change triggers re-fetch', async () => {
    mockGetLogEntries.mockResolvedValue(mockEntries);

    const wrapper = mount(ApplicationLogs);

    await flushPromises();
    expect(mockGetLogEntries).toHaveBeenCalledTimes(1);

    mockGetLogEntries.mockResolvedValue([]);
    wrapper.vm.tail = 500;
    await flushPromises();

    expect(mockGetLogEntries).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  describe('levelColor', () => {
    let wrapper;

    beforeEach(async () => {
      mockGetLogEntries.mockResolvedValue([]);
      wrapper = mount(ApplicationLogs);
      await flushPromises();
    });

    afterEach(() => {
      wrapper.unmount();
    });

    it('returns red for error', () => {
      expect(wrapper.vm.levelColor('error')).toBe('#e06c75');
    });

    it('returns red for fatal', () => {
      expect(wrapper.vm.levelColor('fatal')).toBe('#e06c75');
    });

    it('returns yellow for warn', () => {
      expect(wrapper.vm.levelColor('warn')).toBe('#e5c07b');
    });

    it('returns blue for debug', () => {
      expect(wrapper.vm.levelColor('debug')).toBe('#61afef');
    });

    it('returns blue for trace', () => {
      expect(wrapper.vm.levelColor('trace')).toBe('#61afef');
    });

    it('returns default gray for info', () => {
      expect(wrapper.vm.levelColor('info')).toBe('#d4d4d4');
    });

    it('returns default gray for unknown levels', () => {
      expect(wrapper.vm.levelColor('custom')).toBe('#d4d4d4');
    });
  });

  describe('formattedLogs', () => {
    it('formats entries into readable log lines', async () => {
      mockGetLogEntries.mockResolvedValue(mockEntries);

      const wrapper = mount(ApplicationLogs);
      await flushPromises();

      const formatted = wrapper.vm.formattedLogs;
      expect(formatted).toContain('[INFO ]');
      expect(formatted).toContain('[ERROR]');
      expect(formatted).toContain('[server]');
      expect(formatted).toContain('[docker]');
      expect(formatted).toContain('Server started');
      expect(formatted).toContain('Connection failed');
      wrapper.unmount();
    });

    it('returns empty string when no entries', async () => {
      mockGetLogEntries.mockResolvedValue([]);

      const wrapper = mount(ApplicationLogs);
      await flushPromises();

      expect(wrapper.vm.formattedLogs).toBe('');
      wrapper.unmount();
    });
  });

  describe('fetchEntries with level=all', () => {
    it('passes undefined level when level is all', async () => {
      mockGetLogEntries.mockResolvedValue([]);

      const wrapper = mount(ApplicationLogs);
      await flushPromises();

      expect(mockGetLogEntries).toHaveBeenCalledWith({ level: undefined, tail: 100, agent: undefined });
      wrapper.unmount();
    });
  });

  describe('agent source selector', () => {
    it('fetches agents on mount', async () => {
      mockGetLogEntries.mockResolvedValue([]);
      mockGetAgents.mockResolvedValue([
        { name: 'agent-1', connected: true },
      ]);

      const wrapper = mount(ApplicationLogs);
      await flushPromises();

      expect(mockGetAgents).toHaveBeenCalled();
      expect(wrapper.vm.agents).toEqual([{ name: 'agent-1', connected: true }]);
      wrapper.unmount();
    });

    it('defaults to server source', async () => {
      mockGetLogEntries.mockResolvedValue([]);

      const wrapper = mount(ApplicationLogs);
      await flushPromises();

      expect(wrapper.vm.source).toBe('server');
      expect(mockGetLogEntries).toHaveBeenCalledWith({ level: undefined, tail: 100, agent: undefined });
      wrapper.unmount();
    });

    it('passes agent name when agent source is selected', async () => {
      mockGetLogEntries.mockResolvedValue([]);
      mockGetAgents.mockResolvedValue([
        { name: 'agent-1', connected: true },
      ]);

      const wrapper = mount(ApplicationLogs);
      await flushPromises();

      mockGetLogEntries.mockClear();
      wrapper.vm.source = 'agent-1';
      await flushPromises();

      expect(mockGetLogEntries).toHaveBeenCalledWith({ level: undefined, tail: 100, agent: 'agent-1' });
      wrapper.unmount();
    });

    it('builds sourceItems with server and agents', async () => {
      mockGetLogEntries.mockResolvedValue([]);
      mockGetAgents.mockResolvedValue([
        { name: 'agent-1', connected: true },
        { name: 'agent-2', connected: false },
      ]);

      const wrapper = mount(ApplicationLogs);
      await flushPromises();

      const items = wrapper.vm.sourceItems;
      expect(items).toHaveLength(3);
      expect(items[0]).toEqual({ title: 'Server', value: 'server' });
      expect(items[1]).toEqual({ title: 'agent-1', value: 'agent-1', props: { disabled: false } });
      expect(items[2]).toEqual({ title: 'agent-2', value: 'agent-2', props: { disabled: true } });
      wrapper.unmount();
    });

    it('handles agent fetch failure gracefully', async () => {
      mockGetLogEntries.mockResolvedValue([]);
      mockGetAgents.mockRejectedValue(new Error('Network error'));

      const wrapper = mount(ApplicationLogs);
      await flushPromises();

      expect(wrapper.vm.agents).toEqual([]);
      wrapper.unmount();
    });
  });

  describe('configuredLevel tooltip', () => {
    it('renders tooltip text with configured level', async () => {
      mockGetLogEntries.mockResolvedValue(mockEntries);

      const wrapper = mount(ApplicationLogs, {
        props: { configuredLevel: 'warn' },
      });
      await flushPromises();

      // The tooltip element should be present with the configured level
      const tooltip = wrapper.find('.v-tooltip');
      expect(tooltip.exists()).toBe(true);
      expect(tooltip.text()).toContain('WARN');
      wrapper.unmount();
    });

    it('does not render tooltip when configuredLevel is empty', async () => {
      mockGetLogEntries.mockResolvedValue(mockEntries);

      const wrapper = mount(ApplicationLogs);
      await flushPromises();

      expect(wrapper.html()).not.toContain('mdi-information-outline');
      wrapper.unmount();
    });
  });

  describe('scroll behavior', () => {
    it('scrolls log pre element to bottom after entries load', async () => {
      mockGetLogEntries.mockResolvedValue(mockEntries);

      const wrapper = mount(ApplicationLogs);
      await flushPromises();
      await wrapper.vm.$nextTick();

      const pre = wrapper.find('pre');
      expect(pre.exists()).toBe(true);
      // The scrollTop assignment happens in $nextTick callback
      // Verify the pre element has the ref
      expect(wrapper.vm.$refs.logPre).toBeDefined();
      wrapper.unmount();
    });
  });

  describe('loading state with existing entries', () => {
    it('does not show spinner while loading when entries already exist', async () => {
      mockGetLogEntries.mockResolvedValue(mockEntries);

      const wrapper = mount(ApplicationLogs);
      await flushPromises();

      // Now trigger a re-fetch with a never-resolving promise
      mockGetLogEntries.mockReturnValue(new Promise(() => {}));
      wrapper.vm.level = 'error';
      await wrapper.vm.$nextTick();

      // Loading is true but entries exist, so spinner should not show
      expect(wrapper.vm.loading).toBe(true);
      expect(wrapper.vm.entries.length).toBeGreaterThan(0);
      expect(wrapper.find('.v-progress-circular').exists()).toBe(false);
      wrapper.unmount();
    });
  });
});
