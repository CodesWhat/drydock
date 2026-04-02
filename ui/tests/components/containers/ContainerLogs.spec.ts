import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import ContainerLogs from '@/components/containers/ContainerLogs.vue';

const mocks = vi.hoisted(() => {
  type StreamOptions = {
    onMessage: (frame: {
      type: 'stdout' | 'stderr';
      ts: string;
      displayTs: string;
      line: string;
    }) => void;
    onStatus?: (status: 'connected' | 'disconnected') => void;
    query?: Record<string, unknown>;
    containerId: string;
  };

  let latestOptions: StreamOptions | null = null;
  const handle = {
    update: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    close: vi.fn(),
    isPaused: vi.fn(() => false),
  };

  return {
    handle,
    createConnection: vi.fn((options: StreamOptions) => {
      latestOptions = options;
      return handle;
    }),
    downloadLogs: vi.fn(async () => new Blob(['downloaded'], { type: 'text/plain' })),
    getLatestOptions: () => latestOptions,
  };
});

vi.mock('@/services/logs', () => ({
  createContainerLogStreamConnection: mocks.createConnection,
  downloadContainerLogs: mocks.downloadLogs,
  toLogTailValue: (value: number | 'all') => (value === 'all' ? 2147483647 : value),
}));

describe('ContainerLogs', () => {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  beforeEach(() => {
    vi.clearAllMocks();
    URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  function mountComponent(props: Record<string, unknown> = {}) {
    return mount(ContainerLogs, {
      props: {
        containerId: 'container-1',
        containerName: 'web-app',
        ...props,
      },
      attachTo: document.body,
      global: {
        stubs: {
          AppIcon: {
            template: '<span class="app-icon-stub" />',
            props: ['name', 'size'],
          },
        },
      },
    });
  }

  it('creates a stream connection and renders incoming log frames', async () => {
    const wrapper = mountComponent();

    expect(mocks.createConnection).toHaveBeenCalledTimes(1);
    const latestOptions = mocks.getLatestOptions();
    if (!latestOptions) {
      throw new Error('Missing stream options');
    }

    latestOptions.onMessage({
      type: 'stdout',
      ts: '2026-03-15T00:00:00Z',
      displayTs: '[00:00:00.000]',
      line: 'plain line',
    });
    latestOptions.onMessage({
      type: 'stderr',
      ts: '2026-03-15T00:00:01Z',
      displayTs: '[00:00:01.000]',
      line: '{"level":"error","msg":"boom"}',
    });
    await nextTick();

    expect(wrapper.text()).toContain('plain line');
    expect(wrapper.text()).toContain('boom');
    expect(wrapper.text()).toContain('[00:00:00.000]');
    expect(wrapper.text()).toContain('[00:00:01.000]');
    expect(wrapper.findAll('[data-test="container-log-row"]').length).toBe(2);
  });

  it('filters stream types and updates stream query when toggles change', async () => {
    const wrapper = mountComponent();
    const latestOptions = mocks.getLatestOptions();
    if (!latestOptions) {
      throw new Error('Missing stream options');
    }

    latestOptions.onMessage({
      type: 'stdout',
      ts: '2026-03-15T00:00:00Z',
      displayTs: '[00:00:00.000]',
      line: 'stdout line',
    });
    latestOptions.onMessage({
      type: 'stderr',
      ts: '2026-03-15T00:00:01Z',
      displayTs: '[00:00:01.000]',
      line: 'stderr line',
    });
    await nextTick();

    expect(wrapper.text()).toContain('stdout line');
    expect(wrapper.text()).toContain('stderr line');

    const stderrToggle = wrapper.find('[data-test="container-log-toggle-stderr"]');
    await stderrToggle.trigger('click');

    expect(wrapper.text()).toContain('stdout line');
    expect(wrapper.text()).not.toContain('stderr line');
    expect(mocks.handle.update).toHaveBeenCalled();
  });

  it('supports regex search, match navigation, and pause/resume controls', async () => {
    const wrapper = mountComponent();
    const latestOptions = mocks.getLatestOptions();
    if (!latestOptions) {
      throw new Error('Missing stream options');
    }

    latestOptions.onMessage({
      type: 'stdout',
      ts: '2026-03-15T00:00:00Z',
      displayTs: '[00:00:00.000]',
      line: 'alpha',
    });
    latestOptions.onMessage({
      type: 'stdout',
      ts: '2026-03-15T00:00:01Z',
      displayTs: '[00:00:01.000]',
      line: 'beta',
    });
    latestOptions.onMessage({
      type: 'stdout',
      ts: '2026-03-15T00:00:02Z',
      displayTs: '[00:00:02.000]',
      line: 'alpha-2',
    });
    await nextTick();

    await wrapper.find('[data-test="container-log-search-input"]').setValue('alpha');
    await wrapper.find('[data-test="container-log-regex-toggle"]').trigger('click');
    await nextTick();

    const rows = wrapper.findAll('[data-test="container-log-row"]');
    const highlightedRows = rows.filter((row) => row.classes().includes('ring-1'));
    expect(highlightedRows.length).toBe(2);

    await wrapper.find('[data-test="container-log-next-match"]').trigger('click');
    expect(wrapper.find('[data-test="container-log-match-index"]').text()).toContain('2 / 2');

    const pauseButton = wrapper.find('[data-test="container-log-toggle-pause"]');
    await pauseButton.trigger('click');
    expect(mocks.handle.pause).toHaveBeenCalledTimes(1);

    await pauseButton.trigger('click');
    expect(mocks.handle.resume).toHaveBeenCalledTimes(1);
  });

  it('downloads current log selection as a .log file', async () => {
    const appendSpy = vi.spyOn(document.body, 'appendChild');
    const removeSpy = vi.spyOn(document.body, 'removeChild');

    try {
      const wrapper = mountComponent();

      await wrapper.find('[data-test="container-log-download"]').trigger('click');

      expect(mocks.downloadLogs).toHaveBeenCalledWith('container-1', expect.any(Object));
      expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
      expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
      expect(appendSpy).toHaveBeenCalled();
      expect(removeSpy).toHaveBeenCalled();
    } finally {
      appendSpy.mockRestore();
      removeSpy.mockRestore();
    }
  });
});
