import { flushPromises, mount } from '@vue/test-utils';
import { i18n } from '@/boot/i18n';
import AppIcon from '@/components/AppIcon.vue';
import ConfigLogsTab from '@/components/config/ConfigLogsTab.vue';
import { getLog, getLogComponents, getLogEntries } from '@/services/log';
import LogsView from '@/views/LogsView.vue';

vi.mock('@/services/log', () => ({
  getLog: vi.fn().mockResolvedValue({ level: 'info' }),
  getLogEntries: vi.fn().mockResolvedValue([]),
  getLogComponents: vi.fn().mockResolvedValue([]),
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
  describe('localized real-service failures', () => {
    let wrapper: ReturnType<typeof mount> | undefined;
    let previousLocale: typeof i18n.global.locale.value;

    beforeEach(async () => {
      previousLocale = i18n.global.locale.value;
      i18n.global.locale.value = 'fr';
      const service = await vi.importActual<typeof import('@/services/log')>('@/services/log');
      vi.mocked(getLog).mockImplementation(service.getLog);
      vi.mocked(getLogComponents).mockImplementation(service.getLogComponents);
      vi.mocked(getLogEntries).mockImplementation(service.getLogEntries);
      vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
      wrapper?.unmount();
      wrapper = undefined;
      i18n.global.locale.value = previousLocale;
      vi.unstubAllGlobals();
      vi.mocked(getLog).mockResolvedValue({ level: 'info' });
      vi.mocked(getLogComponents).mockResolvedValue([]);
      vi.mocked(getLogEntries).mockResolvedValue([]);
    });

    function mockReads(entries: () => Promise<Response>) {
      vi.mocked(fetch).mockImplementation(async (url) => {
        if (url === '/api/v1/log') return Response.json({ level: 'info' });
        if (url === '/api/v1/log/components') return Response.json(['watcher']);
        if (String(url).startsWith('/api/v1/log/entries?')) return entries();
        throw new Error(`Unexpected request: ${url}`);
      });
    }

    async function pauseStream() {
      wrapper = mount(LogsView, { global: { components: { AppIcon } } });
      await flushPromises();
      expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual([
        '/api/v1/log',
        '/api/v1/log/components',
      ]);
      await wrapper.get('input[type="checkbox"]').setValue(false);
    }

    it.each([
      '{}',
      '{"error":""}',
      '{"error":"  "}',
      '{"error":42}',
      'null',
      '42',
      '{broken',
      '<html>proxy failure</html>',
    ])('localizes an HTTP failure without a usable diagnostic: %s', async (body) => {
      const response = Promise.withResolvers<Response>();
      mockReads(() => response.promise);
      try {
        await pauseStream();
        expect(wrapper!.getComponent(ConfigLogsTab).props('loading')).toBe(true);
        response.resolve(new Response(body, { status: 503, statusText: 'Service Unavailable' }));
        await flushPromises();
        expect(wrapper!.text()).toContain(i18n.global.t('logsView.loadFailed'));
        expect(wrapper!.text()).not.toContain('Failed to fetch log entries');
        expect(wrapper!.getComponent(ConfigLogsTab).props('loading')).toBe(false);
        expect(vi.mocked(fetch).mock.calls).toEqual([
          ['/api/v1/log', { credentials: 'include' }],
          ['/api/v1/log/components', { credentials: 'include' }],
          ['/api/v1/log', { credentials: 'include' }],
          ['/api/v1/log/entries?tail=100', { credentials: 'include' }],
        ]);
      } finally {
        response.resolve(Response.json([]));
        await flushPromises();
      }
    });

    it('preserves a genuine server diagnostic in French', async () => {
      mockReads(async () =>
        Response.json({ error: 'Invalid tail query parameter' }, { status: 400 }),
      );
      await pauseStream();
      await flushPromises();
      expect(wrapper!.text()).toContain('Invalid tail query parameter');
      expect(wrapper!.text()).not.toContain(i18n.global.t('logsView.loadFailed'));
    });

    it('preserves network diagnostics', async () => {
      mockReads(async () => {
        throw new Error('Network unavailable');
      });
      await pauseStream();
      await flushPromises();
      expect(wrapper!.text()).toContain('Network unavailable');
    });

    it('renders successful rows and refreshes filters only while streaming is off', async () => {
      mockReads(async () =>
        Response.json([
          { timestamp: 1789300000000, level: 'info', component: 'watcher', msg: 'Inventory ready' },
        ]),
      );
      await pauseStream();
      await flushPromises();
      expect(wrapper!.text()).toContain('Inventory ready');
      expect(wrapper!.getComponent(ConfigLogsTab).props('error')).toBe('');
      await wrapper!.findAll('select')[0].setValue('warn');
      await flushPromises();
      expect(fetch).toHaveBeenLastCalledWith('/api/v1/log/entries?level=warn&tail=100', {
        credentials: 'include',
      });
      const calls = vi.mocked(fetch).mock.calls.length;
      await wrapper!.get('input[type="checkbox"]').setValue(true);
      await wrapper!.findAll('select')[0].setValue('error');
      await flushPromises();
      expect(fetch).toHaveBeenCalledTimes(calls);
    });
  });

  describe('layout spacing', () => {
    it('clips overflow on the root container so only the log viewport scrolls', () => {
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
