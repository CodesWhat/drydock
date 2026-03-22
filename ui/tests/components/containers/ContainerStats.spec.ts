import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import ContainerStats from '@/components/containers/ContainerStats.vue';

const mocks = vi.hoisted(() => ({
  getContainerStats: vi.fn(),
  connectContainerStatsStream: vi.fn(),
}));

vi.mock('@/services/stats', () => ({
  getContainerStats: mocks.getContainerStats,
  connectContainerStatsStream: mocks.connectContainerStatsStream,
}));

function makeSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    containerId: 'c1',
    cpuPercent: 20,
    memoryUsageBytes: 200,
    memoryLimitBytes: 400,
    memoryPercent: 50,
    networkRxBytes: 1_000,
    networkTxBytes: 2_000,
    blockReadBytes: 500,
    blockWriteBytes: 700,
    timestamp: '2026-03-14T10:00:00.000Z',
    ...overrides,
  };
}

describe('ContainerStats', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('loads initial stats and updates from SSE snapshots', async () => {
    let streamHandlers: Record<string, (payload?: unknown) => void> = {};
    const streamController = {
      pause: vi.fn(),
      resume: vi.fn(),
      disconnect: vi.fn(),
      isPaused: vi.fn(() => false),
    };

    mocks.getContainerStats.mockResolvedValue({
      data: makeSnapshot(),
      history: [
        makeSnapshot({ cpuPercent: 10, timestamp: '2026-03-14T09:59:50.000Z' }),
        makeSnapshot(),
      ],
    });
    mocks.connectContainerStatsStream.mockImplementation(
      (_containerId: string, handlers: Record<string, (payload?: unknown) => void>) => {
        streamHandlers = handlers;
        return streamController;
      },
    );

    const wrapper = mount(ContainerStats, {
      props: {
        containerId: 'c1',
      },
      global: {
        stubs: {
          AppIcon: true,
        },
      },
    });

    await flushPromises();

    expect(mocks.getContainerStats).toHaveBeenCalledWith('c1');
    expect(mocks.connectContainerStatsStream).toHaveBeenCalledWith(
      'c1',
      expect.any(Object),
      expect.any(Object),
    );

    expect(wrapper.get('[data-test="metric-cpu-value"]').text()).toContain('20');
    expect(wrapper.get('[data-test="metric-memory-value"]').text()).toContain('50');

    streamHandlers.onSnapshot?.(
      makeSnapshot({
        cpuPercent: 72,
        memoryPercent: 80,
        memoryUsageBytes: 320,
        timestamp: '2026-03-14T10:00:10.000Z',
      }),
    );
    await nextTick();

    expect(wrapper.get('[data-test="metric-cpu-value"]').text()).toContain('72');
    expect(wrapper.get('[data-test="metric-memory-value"]').text()).toContain('80');
    expect(wrapper.get('[data-test="sparkline-cpu"]').attributes('points')).not.toBe('');

    wrapper.unmount();
    expect(streamController.disconnect).toHaveBeenCalledTimes(1);
  });

  it('supports pause and resume controls', async () => {
    const streamController = {
      pause: vi.fn(),
      resume: vi.fn(),
      disconnect: vi.fn(),
      isPaused: vi.fn(() => false),
    };

    mocks.getContainerStats.mockResolvedValue({
      data: makeSnapshot(),
      history: [makeSnapshot()],
    });
    mocks.connectContainerStatsStream.mockReturnValue(streamController);

    const wrapper = mount(ContainerStats, {
      props: {
        containerId: 'c1',
      },
      global: {
        stubs: {
          AppIcon: true,
        },
      },
    });

    await flushPromises();

    const toggleButton = wrapper.get('[data-test="stats-toggle-stream"]');
    expect(toggleButton.text()).toContain('Pause');

    await toggleButton.trigger('click');
    await nextTick();
    expect(streamController.pause).toHaveBeenCalledTimes(1);
    expect(wrapper.get('[data-test="stats-toggle-stream"]').text()).toContain('Resume');

    await wrapper.get('[data-test="stats-toggle-stream"]').trigger('click');
    await nextTick();
    expect(streamController.resume).toHaveBeenCalledTimes(1);
    expect(wrapper.get('[data-test="stats-toggle-stream"]').text()).toContain('Pause');
  });
});
