import { mount } from '@vue/test-utils';
import LogsView from '@/views/LogsView.vue';

vi.mock('@/services/log', () => ({
  getLog: vi.fn().mockResolvedValue({ level: 'info' }),
  getLogEntries: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/composables/useLogViewerBehavior', () => ({
  LOG_AUTO_FETCH_INTERVALS: [{ label: 'Off', value: 0 }],
  useAutoFetchLogs: () => ({ autoFetchInterval: { value: 0 } }),
  useLogViewport: () => ({
    logContainer: { value: null },
    scrollBlocked: { value: false },
    scrollToBottom: vi.fn(),
    handleLogScroll: vi.fn(),
    resumeAutoScroll: vi.fn(),
  }),
}));

describe('LogsView', () => {
  describe('layout spacing', () => {
    it('applies pr-[15px] on the root container for scrollbar centering', () => {
      const wrapper = mount(LogsView, {
        global: {
          stubs: {
            ConfigLogsTab: { template: '<div class="config-logs-stub" />' },
          },
        },
      });
      const root = wrapper.find('div');
      expect(root.classes()).toContain('sm:pr-[15px]');
    });

    it('prevents page-level scroll with overflow-hidden', () => {
      const wrapper = mount(LogsView, {
        global: {
          stubs: {
            ConfigLogsTab: { template: '<div class="config-logs-stub" />' },
          },
        },
      });
      const root = wrapper.find('div');
      expect(root.classes()).toContain('overflow-hidden');
    });

    it('stretches to fill available height with flex-1 and min-h-0', () => {
      const wrapper = mount(LogsView, {
        global: {
          stubs: {
            ConfigLogsTab: { template: '<div class="config-logs-stub" />' },
          },
        },
      });
      const root = wrapper.find('div');
      expect(root.classes()).toContain('flex-1');
      expect(root.classes()).toContain('min-h-0');
      expect(root.classes()).toContain('flex-col');
    });
  });
});
