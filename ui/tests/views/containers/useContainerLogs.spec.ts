import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent, h, nextTick, type Ref, ref } from 'vue';
import type { Container } from '@/types/container';
import { useContainerLogs } from '@/views/containers/useContainerLogs';

const mocks = vi.hoisted(() => ({
  getContainerLogs: vi.fn(),
}));

vi.mock('@/services/container', () => ({
  getContainerLogs: mocks.getContainerLogs,
}));

function makeContainer(overrides: Partial<Container> = {}): Container {
  return {
    id: 'container-1',
    name: 'web',
    image: 'nginx',
    icon: 'docker',
    currentTag: '1.0.0',
    newTag: null,
    status: 'running',
    registry: 'dockerhub',
    updateKind: null,
    updateMaturity: null,
    bouncer: 'safe',
    server: 'Local',
    details: { ports: [], volumes: [], env: [], labels: [] },
    ...overrides,
  };
}

const mountedWrappers: VueWrapper[] = [];

interface LogsHarnessState {
  activeDetailTab: Ref<string>;
  containerIdMap: Ref<Record<string, string>>;
  selectedContainer: Ref<Container | null>;
  composable: ReturnType<typeof useContainerLogs>;
}

async function mountLogsHarness(
  options: {
    activeDetailTab?: string;
    containerIdMap?: Record<string, string>;
    selectedContainer?: Container | null;
  } = {},
) {
  let state: LogsHarnessState | undefined;

  const Harness = defineComponent({
    setup() {
      const activeDetailTab = ref(options.activeDetailTab ?? 'overview');
      const containerIdMap = ref(options.containerIdMap ?? {});
      const selectedContainer = ref(options.selectedContainer ?? null);
      const composable = useContainerLogs({
        activeDetailTab,
        containerIdMap,
        selectedContainer,
      });
      state = {
        activeDetailTab,
        containerIdMap,
        selectedContainer,
        composable,
      };
      return () => h('div');
    },
  });

  const wrapper = mount(Harness);
  mountedWrappers.push(wrapper);
  await flushPromises();

  if (!state) {
    throw new Error('Logs harness did not initialize');
  }

  return state;
}

describe('useContainerLogs', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getContainerLogs.mockResolvedValue({ logs: 'line-1\nline-2\n' });
  });

  afterEach(() => {
    for (const wrapper of mountedWrappers.splice(0)) {
      wrapper.unmount();
    }
  });

  it('loads logs on first read and reuses cache on later reads', async () => {
    const { composable } = await mountLogsHarness({
      containerIdMap: { web: 'container-1' },
      selectedContainer: makeContainer(),
    });

    expect(composable.getContainerLogs('web')).toEqual(['Loading logs...']);
    await flushPromises();

    expect(mocks.getContainerLogs).toHaveBeenCalledWith('container-1', 100);
    expect(composable.getContainerLogs('web')).toEqual(['line-1', 'line-2']);
    expect(mocks.getContainerLogs).toHaveBeenCalledTimes(1);

    composable.getContainerLogs('web');
    await flushPromises();
    expect(mocks.getContainerLogs).toHaveBeenCalledTimes(1);
  });

  it('supports forced refresh and returns fallback line on fetch failure', async () => {
    const { composable } = await mountLogsHarness({
      containerIdMap: { web: 'container-1' },
      selectedContainer: makeContainer(),
    });

    await composable.loadContainerLogs('web');
    expect(composable.getContainerLogs('web')).toEqual(['line-1', 'line-2']);

    mocks.getContainerLogs.mockRejectedValueOnce(new Error('boom'));
    await composable.loadContainerLogs('web', true);

    expect(composable.getContainerLogs('web')).toEqual(['Failed to load container logs']);
  });

  it('uses empty-log fallback message when API does not return logs text', async () => {
    mocks.getContainerLogs.mockResolvedValueOnce({});
    const { composable } = await mountLogsHarness({
      containerIdMap: { web: 'container-1' },
      selectedContainer: makeContainer(),
    });

    await composable.loadContainerLogs('web', true);

    expect(composable.getContainerLogs('web')).toEqual(['No logs available for this container']);
  });

  it('does not fetch again when cache already exists and force is false', async () => {
    const { composable } = await mountLogsHarness({
      containerIdMap: { web: 'container-1' },
      selectedContainer: makeContainer(),
    });

    await composable.loadContainerLogs('web');
    expect(mocks.getContainerLogs).toHaveBeenCalledTimes(1);

    await composable.loadContainerLogs('web');
    expect(mocks.getContainerLogs).toHaveBeenCalledTimes(1);
  });

  it('returns no-op when container is not mapped to an id', async () => {
    const { composable } = await mountLogsHarness({
      containerIdMap: {},
      selectedContainer: makeContainer(),
    });

    await composable.loadContainerLogs('web');
    expect(mocks.getContainerLogs).not.toHaveBeenCalled();
    expect(composable.getContainerLogs('web')).toEqual(['Loading logs...']);
  });

  it('auto-fetch refreshes logs for the selected container when interval is enabled', async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: false,
    });
    const { composable } = await mountLogsHarness({
      containerIdMap: { web: 'container-1' },
      selectedContainer: makeContainer(),
      activeDetailTab: 'logs',
    });

    await composable.loadContainerLogs('web');
    mocks.getContainerLogs.mockResolvedValue({ logs: 'line-3\n' });

    composable.containerAutoFetchInterval.value = 2000;
    await nextTick();
    vi.advanceTimersByTime(2100);
    await flushPromises();

    expect(mocks.getContainerLogs).toHaveBeenCalledWith('container-1', 100);
    expect(composable.getContainerLogs('web')).toEqual(['line-3']);
    vi.useRealTimers();
  });

  it('no-ops auto-fetch refresh when there is no selected container', async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: false,
    });
    const { composable } = await mountLogsHarness({
      containerIdMap: { web: 'container-1' },
      selectedContainer: null,
      activeDetailTab: 'logs',
    });
    mocks.getContainerLogs.mockClear();

    composable.containerAutoFetchInterval.value = 2000;
    await nextTick();
    vi.advanceTimersByTime(2100);
    await flushPromises();

    expect(mocks.getContainerLogs).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('resets auto-fetch interval when selected container or tab changes', async () => {
    const { composable, selectedContainer, activeDetailTab } = await mountLogsHarness({
      containerIdMap: { web: 'container-1' },
      selectedContainer: makeContainer(),
      activeDetailTab: 'logs',
    });

    composable.containerAutoFetchInterval.value = 5000;
    selectedContainer.value = makeContainer({ id: 'container-2', name: 'api' });
    await nextTick();
    expect(composable.containerAutoFetchInterval.value).toBe(0);

    composable.containerAutoFetchInterval.value = 2000;
    activeDetailTab.value = 'actions';
    await nextTick();
    expect(composable.containerAutoFetchInterval.value).toBe(0);
  });
});
