import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import { i18n, setI18nLocale } from '@/boot/i18n';
import ContainerStats from '@/components/containers/ContainerStats.vue';

const transport = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock('@/stores/eventStream', () => ({ createManagedEventSource: transport.connect }));

class StatsSource extends EventTarget {
  close = vi.fn();
  onerror?: () => void;

  emit(name: string, data?: unknown) {
    this.dispatchEvent(new MessageEvent(name, { data: JSON.stringify(data) }));
  }
}

function snapshot(containerId = 'c1', cpuPercent = 20) {
  return {
    containerId,
    cpuPercent,
    memoryUsageBytes: 200,
    memoryLimitBytes: 400,
    memoryPercent: 50,
    networkRxBytes: 1000,
    networkTxBytes: 2000,
    blockReadBytes: 500,
    blockWriteBytes: 700,
    timestamp: '2026-09-16T20:00:00Z',
  };
}

function response(containerId = 'c1') {
  return new Response(JSON.stringify({ data: snapshot(containerId), history: [] }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

function deferred() {
  let resolve!: (value: Response) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<Response>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe('ContainerStats stream lifecycle with real stats service', () => {
  let wrapper: VueWrapper | undefined;
  let sources: StatsSource[];
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    sources = [];
    fetchMock = vi.fn().mockResolvedValue(response());
    vi.stubGlobal('fetch', fetchMock);
    transport.connect.mockReset().mockImplementation(() => {
      const source = new StatsSource();
      sources.push(source);
      return source;
    });
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    vi.useRealTimers();
    vi.unstubAllGlobals();
    setI18nLocale('en');
  });

  function render() {
    wrapper = mount(ContainerStats, { props: { containerId: 'c1' } });
    return wrapper;
  }

  it('does not claim Live or enable Pause while the initial read is pending', async () => {
    const pending = deferred();
    fetchMock.mockReturnValue(pending.promise);
    const view = render();
    await nextTick();
    expect(view.text()).not.toContain('Live');
    expect(view.get<HTMLButtonElement>('[data-test="stats-toggle-stream"]').element.disabled).toBe(
      true,
    );
    pending.resolve(response());
    await flushPromises();
  });

  it('shows Disconnected and disables Pause after an initial read failure', async () => {
    fetchMock.mockRejectedValue(new Error('read failed'));
    const view = render();
    await flushPromises();
    expect(view.text()).toContain('Disconnected');
    expect(view.text()).not.toContain('Live');
    expect(view.get<HTMLButtonElement>('[data-test="stats-toggle-stream"]').element.disabled).toBe(
      true,
    );
    expect(sources).toHaveLength(0);
  });

  it('claims Live only after open and drops it during reconnect', async () => {
    const view = render();
    await flushPromises();
    expect(view.text()).not.toContain('Live');
    sources[0].emit('open');
    sources[0].emit('dd:heartbeat');
    await nextTick();
    expect(view.text()).toContain('Live');
    expect(view.text()).toContain('heartbeat active');
    sources[0].onerror?.();
    await nextTick();
    expect(view.text()).not.toContain('Live');
    expect(view.text()).not.toContain('heartbeat active');
    await vi.advanceTimersByTimeAsync(2000);
    expect(sources).toHaveLength(2);
    sources[1].emit('open');
    await nextTick();
    expect(view.text()).toContain('Live');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not reopen a stream when a pending read resolves after unmount', async () => {
    const pending = deferred();
    fetchMock.mockReturnValue(pending.promise);
    render().unmount();
    wrapper = undefined;
    pending.resolve(response());
    await flushPromises();
    expect(sources).toHaveLength(0);
  });

  it('retires the old stream immediately on container switch and ignores its callbacks', async () => {
    const view = render();
    await flushPromises();
    const old = sources[0];
    const pending = deferred();
    fetchMock.mockReturnValueOnce(pending.promise);
    await view.setProps({ containerId: 'c2' });
    expect(old.close).toHaveBeenCalledTimes(1);
    pending.resolve(response('c2'));
    await flushPromises();
    old.emit('dd:container-stats', snapshot('c1', 99));
    old.emit('dd:heartbeat');
    old.emit('open');
    old.onerror?.();
    await nextTick();
    expect(view.get('[data-test="metric-cpu-value"]').text()).toBe('20.0%');
    expect(view.text()).not.toContain('Live');
    expect(view.text()).not.toContain('heartbeat active');
    expect(transport.connect).toHaveBeenLastCalledWith('/api/v1/containers/c2/stats/stream');
  });

  it('keeps Paused despite queued events and waits for open after Resume', async () => {
    const view = render();
    await flushPromises();
    sources[0].emit('open');
    await view.get('[data-test="stats-toggle-stream"]').trigger('click');
    sources[0].emit('dd:container-stats', snapshot('c1', 99));
    sources[0].emit('open');
    sources[0].onerror?.();
    await nextTick();
    expect(view.text()).toContain('Paused');
    expect(view.get('[data-test="metric-cpu-value"]').text()).toBe('20.0%');
    await vi.advanceTimersByTimeAsync(2000);
    expect(sources).toHaveLength(1);
    await view.get('[data-test="stats-toggle-stream"]').trigger('click');
    expect(view.text()).not.toContain('Live');
    sources[1].emit('open');
    await nextTick();
    expect(view.text()).toContain('Live');
    view.unmount();
    wrapper = undefined;
    expect(sources[1].close).toHaveBeenCalledTimes(1);
  });

  it('does not open a stale read when a newer container read has completed', async () => {
    const pending = deferred();
    fetchMock.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(response('c2'));
    const view = render();
    await view.setProps({ containerId: 'c2' });
    await flushPromises();
    pending.resolve(response('c1'));
    await flushPromises();
    expect(sources).toHaveLength(1);
    expect(transport.connect).toHaveBeenCalledWith('/api/v1/containers/c2/stats/stream');
  });

  it('ignores a stale read rejection without disconnecting the current stream', async () => {
    const pending = deferred();
    fetchMock.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(response('c2'));
    const view = render();
    await view.setProps({ containerId: 'c2' });
    await flushPromises();
    sources[0].emit('open');
    pending.reject(new Error('old read failed'));
    await flushPromises();
    expect(view.text()).toContain('Live');
    expect(view.text()).not.toContain('old read failed');
    expect(sources[0].close).not.toHaveBeenCalled();
  });

  it('cancels a scheduled reconnect when unmounted', async () => {
    render();
    await flushPromises();
    sources[0].onerror?.();
    wrapper?.unmount();
    wrapper = undefined;
    await vi.advanceTimersByTimeAsync(2000);
    expect(sources).toHaveLength(1);
  });

  it.each(['fr', 'ar'] as const)('renders translated disconnected state in %s', async (locale) => {
    setI18nLocale(locale);
    fetchMock.mockRejectedValue(new Error('read failed'));
    const view = render();
    await flushPromises();
    expect(view.text()).toContain(i18n.global.t('dashboardView.hostStatus.disconnected'));
    expect(view.text()).not.toContain('Disconnected');
    expect(view.text()).not.toContain('Live');
  });

  it('has every reused status label in every supported locale', () => {
    for (const locale of i18n.global.availableLocales) {
      for (const key of [
        'common.loading',
        'dashboardView.hostStatus.disconnected',
        'containerComponents.stats.paused',
        'containerComponents.stats.live',
      ]) {
        expect(i18n.global.te(key, locale), `${locale}:${key}`).toBe(true);
      }
    }
  });
});
