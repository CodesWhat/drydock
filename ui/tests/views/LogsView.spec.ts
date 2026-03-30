import { mount } from '@vue/test-utils';
import LogsView from '@/views/LogsView.vue';

vi.mock('@/services/log', () => ({
  getLog: vi.fn().mockResolvedValue({ level: 'info' }),
  getLogEntries: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/composables/useSystemLogStream', () => ({
  useSystemLogStream: () => ({
    entries: { value: [] },
    status: { value: 'disconnected' },
    connect: vi.fn(),
    disconnect: vi.fn(),
    updateFilters: vi.fn(),
    clear: vi.fn(),
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

    it('uses the standard vertical scroll container', () => {
      const wrapper = mount(LogsView, {
        global: {
          stubs: {
            ConfigLogsTab: { template: '<div class="config-logs-stub" />' },
          },
        },
      });
      const root = wrapper.find('div');
      expect(root.classes()).toContain('overflow-y-auto');
    });

    it('stretches to fill available height with flex-1/min-h-0/min-w-0', () => {
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
      expect(root.classes()).toContain('min-w-0');
    });
  });
});
