import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { i18n } from '@/boot/i18n';
import ContainerStats from '@/components/containers/ContainerStats.vue';
import { connectContainerStatsStream } from '@/services/stats';

vi.mock('@/services/stats', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/stats')>()),
  connectContainerStatsStream: vi.fn(),
}));

const snapshot = {
  containerId: 'c1',
  cpuPercent: 20,
  memoryUsageBytes: 200,
  memoryLimitBytes: 400,
  memoryPercent: 50,
  networkRxBytes: 1000,
  networkTxBytes: 2000,
  blockReadBytes: 500,
  blockWriteBytes: 700,
  timestamp: '2026-09-16T12:00:00Z',
};
const originalLocale = i18n.global.locale.value;
let wrapper: VueWrapper | undefined;
const disconnect = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  vi.mocked(connectContainerStatsStream).mockReturnValue({
    pause() {},
    resume() {},
    disconnect,
    isPaused: () => false,
  });
});
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  i18n.global.locale.value = originalLocale;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe.each(['fr', 'ar'] as const)('Stats HTTP recovery in %s', (locale) => {
  it('shows the real service error without opening a stream', async () => {
    i18n.global.locale.value = locale;
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 503 }));
    wrapper = mount(ContainerStats, {
      props: { containerId: 'c1' },
      global: { stubs: { AppIcon: true } },
    });
    await flushPromises();
    expect(wrapper.text()).toContain(
      `${i18n.global.t('containerComponents.stats.loadFailed')} (c1) (HTTP 503)`,
    );
    expect(connectContainerStatsStream).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retries once on click, shows loading, then connects one stream on the same mount', async () => {
    i18n.global.locale.value = locale;
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 503 }));
    wrapper = mount(ContainerStats, {
      props: { containerId: 'c1' },
      global: { stubs: { AppIcon: true } },
    });
    await flushPromises();
    const retry = wrapper.get('[data-test="stats-retry"]');
    expect(retry.text()).toBe(i18n.global.t('common.retry'));
    expect(connectContainerStatsStream).not.toHaveBeenCalled();
    let resolve!: (response: Response) => void;
    vi.mocked(fetch).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    await retry.trigger('click');
    expect(wrapper.find('[data-test="stats-retry"]').exists()).toBe(false);
    expect(wrapper.text()).toContain(i18n.global.t('containerComponents.stats.loadingStats'));
    expect(fetch).toHaveBeenCalledTimes(2);
    resolve(Response.json({ data: snapshot, history: [snapshot] }));
    await flushPromises();
    expect(wrapper.text()).not.toContain('(HTTP 503)');
    expect(wrapper.get('[data-test="metric-cpu-value"]').text()).toContain('20');
    expect(connectContainerStatsStream).toHaveBeenCalledExactlyOnceWith('c1', expect.any(Object), {
      reconnectDelayMs: 2000,
    });
    expect(
      vi
        .mocked(fetch)
        .mock.calls.every(([, options]) => !options?.method || options.method === 'GET'),
    ).toBe(true);
    wrapper.unmount();
    wrapper = undefined;
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});

it('ignores an obsolete failure after switching containers', async () => {
  let resolve!: (response: Response) => void;
  vi.mocked(fetch).mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  wrapper = mount(ContainerStats, {
    props: { containerId: 'old' },
    global: { stubs: { AppIcon: true } },
  });
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ data: snapshot, history: [] }));
  await wrapper.setProps({ containerId: 'c1' });
  await flushPromises();
  resolve(new Response(null, { status: 503 }));
  await flushPromises();
  expect(wrapper.get('[data-test="metric-cpu-value"]').text()).toContain('20');
  expect(wrapper.find('[data-test="stats-retry"]').exists()).toBe(false);
  expect(connectContainerStatsStream).toHaveBeenCalledTimes(1);
  expect(disconnect).not.toHaveBeenCalled();
});
