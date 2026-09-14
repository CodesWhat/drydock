import { flushPromises, mount } from '@vue/test-utils';
import { i18n } from '@/boot/i18n';
import AppIcon from '@/components/AppIcon.vue';
import ConfigLogsTab from '@/components/config/ConfigLogsTab.vue';
import LogsView from '@/views/LogsView.vue';

class LogSocket {
  static instances: LogSocket[] = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  close = vi.fn();

  constructor(readonly url: string) {
    LogSocket.instances.push(this);
  }
}

describe('LogsView paused fetch recovery', () => {
  let wrapper: ReturnType<typeof mount<typeof LogsView>> | undefined;
  let previousLocale: typeof i18n.global.locale.value;
  let entriesResponse: () => Promise<Response>;

  beforeEach(() => {
    previousLocale = i18n.global.locale.value;
    i18n.global.locale.value = 'fr';
    LogSocket.instances = [];
    vi.stubGlobal('WebSocket', LogSocket);
    entriesResponse = async () => new Response('<html>Unavailable</html>', { status: 503 });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/v1/log') return Response.json({ level: 'info' });
        if (url === '/api/v1/log/components') return Response.json(['watcher']);
        if (url.startsWith('/api/v1/log/entries?')) return entriesResponse();
        throw new Error(`Unexpected request: ${url}`);
      }),
    );
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    i18n.global.locale.value = previousLocale;
    vi.unstubAllGlobals();
  });

  async function openLogs() {
    wrapper = mount(LogsView, { global: { components: { AppIcon } } });
    await flushPromises();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(LogSocket.instances).toHaveLength(1);
  }

  async function pause() {
    await wrapper!.get('input[type="checkbox"]').setValue(false);
    await flushPromises();
  }

  function retryButton() {
    const button = wrapper!
      .findAll('button')
      .find((candidate) => candidate.text() === i18n.global.t('common.retry'));
    expect(button, 'paused errors must provide an accessible Retry button').toBeDefined();
    return button!;
  }

  it('recovers the same mounted French view and resumes only on explicit request', async () => {
    await openLogs();
    const mounted = wrapper!.vm;
    LogSocket.instances[0].onopen?.(new Event('open'));
    await flushPromises();
    await wrapper!.get('[data-test="container-log-toggle-pause"]').trigger('click');
    await flushPromises();
    expect(wrapper!.text()).toContain(i18n.global.t('logsView.loadFailed'));
    expect(LogSocket.instances[0].close).toHaveBeenCalledExactlyOnceWith(1000, 'manual-close');
    entriesResponse = async () =>
      Response.json([
        { timestamp: 1789300000000, level: 'info', component: 'watcher', msg: 'Recovered logs' },
        {
          timestamp: '2026-09-13T23:00:00Z',
          level: 'warn',
          component: 'watcher',
          msg: 'Warning row',
        },
        { timestamp: 'invalid', level: 'error', component: 'watcher', msg: 'Error row' },
        { level: 'debug', message: 'Debug row' },
        { level: 'other', msg: 'Other row' },
        { timestamp: 1789300000000 },
      ]);
    await retryButton().trigger('click');
    await flushPromises();
    expect(wrapper!.vm).toBe(mounted);
    expect(wrapper!.text()).toContain('Recovered logs');
    expect(wrapper!.text()).not.toContain(i18n.global.t('logsView.loadFailed'));
    expect(fetch).toHaveBeenCalledTimes(6);
    expect(LogSocket.instances).toHaveLength(1);
    await wrapper!.get('input[type="checkbox"]').setValue(true);
    expect(LogSocket.instances).toHaveLength(2);
    expect(fetch).toHaveBeenCalledTimes(6);
    wrapper!.unmount();
    wrapper = undefined;
    expect(LogSocket.instances[1].close).toHaveBeenCalledExactlyOnceWith(1000, 'manual-close');
  });

  it('retains filters and genuine diagnostics across a failed retry and empty success', async () => {
    await openLogs();
    await wrapper!.findAll('select')[0].setValue('warn');
    await wrapper!.findAll('select')[1].setValue('50');
    await wrapper!.findAll('select')[2].setValue('watcher');
    expect(fetch).toHaveBeenCalledTimes(2);
    await pause();
    entriesResponse = async () =>
      Response.json({ error: 'Log storage unavailable' }, { status: 503 });
    await retryButton().trigger('click');
    await flushPromises();
    expect(wrapper!.text()).toContain('Log storage unavailable');
    entriesResponse = async () => Response.json([]);
    await retryButton().trigger('click');
    await flushPromises();
    expect(wrapper!.getComponent(ConfigLogsTab).props('error')).toBe('');
    expect(
      wrapper!.findAll('select').map((select) => (select.element as HTMLSelectElement).value),
    ).toEqual(['warn', '50', 'watcher']);
    const reads = vi
      .mocked(fetch)
      .mock.calls.map(([url]) => url)
      .filter((url) => String(url).includes('/entries?'));
    expect(reads).toEqual(
      Array(3).fill('/api/v1/log/entries?level=warn&component=watcher&tail=50'),
    );
  });

  it('accepts only one retry while the request is pending', async () => {
    await openLogs();
    await pause();
    const response = Promise.withResolvers<Response>();
    entriesResponse = () => response.promise;
    try {
      const button = retryButton().element as HTMLButtonElement;
      button.click();
      button.click();
      await flushPromises();
      wrapper!.getComponent(ConfigLogsTab).vm.$emit('retry');
      await flushPromises();
      expect(fetch).toHaveBeenCalledTimes(6);
      expect(wrapper!.getComponent(ConfigLogsTab).props('loading')).toBe(true);
      expect(
        wrapper!
          .findAll('button')
          .some((button) => button.text() === i18n.global.t('common.retry')),
      ).toBe(false);
    } finally {
      response.resolve(Response.json([]));
      await flushPromises();
    }
  });

  it('ignores retry while live and preserves stream-only filter changes', async () => {
    await openLogs();
    wrapper!.getComponent(ConfigLogsTab).vm.$emit('retry');
    await flushPromises();
    await wrapper!.findAll('select')[0].setValue('error');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(LogSocket.instances).toHaveLength(2);
    expect(LogSocket.instances[0].close).toHaveBeenCalledExactlyOnceWith(1000, 'reconnect');
    expect(LogSocket.instances[1].url).toContain('level=error');
  });
});
