import { flushPromises } from '@vue/test-utils';
import { getAgents } from '@/services/agent';
import { getLogEntries } from '@/services/log';
import { getAllWatchers } from '@/services/watcher';
import { getAllTriggers } from '@/services/trigger';
import AgentsView from '@/views/AgentsView.vue';
import { dataViewStubs } from '../helpers/data-view-stubs';
import { mountWithPlugins } from '../helpers/mount';

const { mockRoute } = vi.hoisted(() => ({
  mockRoute: { query: {} as Record<string, unknown> },
}));

vi.mock('vue-router', () => ({
  useRoute: () => mockRoute,
}));

vi.mock('@/composables/useBreakpoints', () => ({
  useBreakpoints: () => ({
    isMobile: { value: false },
    windowNarrow: { value: false },
  }),
}));

vi.mock('@/services/agent', () => ({
  getAgents: vi.fn(),
}));

vi.mock('@/services/log', () => ({
  getLogEntries: vi.fn(),
}));

vi.mock('@/services/watcher', () => ({
  getAllWatchers: vi.fn(),
}));

vi.mock('@/services/trigger', () => ({
  getAllTriggers: vi.fn(),
}));

const mockGetAgents = getAgents as ReturnType<typeof vi.fn>;
const mockGetLogEntries = getLogEntries as ReturnType<typeof vi.fn>;
const mockGetAllWatchers = getAllWatchers as ReturnType<typeof vi.fn>;
const mockGetAllTriggers = getAllTriggers as ReturnType<typeof vi.fn>;
const mountedWrappers: Array<{ unmount: () => void }> = [];

function makeAgent(overrides: Record<string, any> = {}) {
  return {
    name: 'edge-1',
    host: '10.0.0.31',
    port: 2376,
    connected: true,
    dockerVersion: '27.0.0',
    os: 'linux',
    arch: 'amd64',
    cpus: 8,
    memoryGb: 16,
    containers: { total: 12, running: 10, stopped: 2 },
    images: 45,
    lastSeen: 'Just now',
    version: '1.4.0',
    uptime: '4d 3h',
    logLevel: 'info',
    pollInterval: '30s',
    ...overrides,
  };
}

async function mountAgentsView() {
  const wrapper = mountWithPlugins(AgentsView, {
    global: { stubs: dataViewStubs },
  });
  mountedWrappers.push(wrapper);
  await flushPromises();
  return wrapper;
}

describe('AgentsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRoute.query = {};
    mockGetAgents.mockResolvedValue([makeAgent()]);
    mockGetLogEntries.mockResolvedValue([]);
    mockGetAllWatchers.mockResolvedValue([]);
    mockGetAllTriggers.mockResolvedValue([]);
  });

  afterEach(() => {
    while (mountedWrappers.length > 0) {
      mountedWrappers.pop()?.unmount();
    }
  });

  it('successful load renders agent rows', async () => {
    mockGetAgents.mockResolvedValue([
      makeAgent({ name: 'edge-1' }),
      makeAgent({ name: 'edge-2', connected: false }),
    ]);

    const wrapper = await mountAgentsView();

    expect(mockGetAgents).toHaveBeenCalledTimes(1);
    expect(wrapper.find('.data-table').attributes('data-row-count')).toBe('2');
  });

  it('logs fetch is called only for connected agents', async () => {
    mockGetAgents.mockResolvedValue([
      makeAgent({ name: 'edge-1', connected: true }),
      makeAgent({ name: 'edge-2', connected: false }),
      makeAgent({ name: 'edge-3', connected: true }),
    ]);

    await mountAgentsView();

    expect(mockGetLogEntries).toHaveBeenCalledTimes(2);
    expect(mockGetLogEntries).toHaveBeenCalledWith({ agent: 'edge-1', tail: 50 });
    expect(mockGetLogEntries).toHaveBeenCalledWith({ agent: 'edge-3', tail: 50 });
    expect(mockGetLogEntries).not.toHaveBeenCalledWith({ agent: 'edge-2', tail: 50 });
  });

  it('route query q filters rows', async () => {
    mockRoute.query = { q: 'edge-2' };
    mockGetAgents.mockResolvedValue([
      makeAgent({ name: 'edge-1' }),
      makeAgent({ name: 'edge-2' }),
    ]);

    const wrapper = await mountAgentsView();

    expect((wrapper.find('input[type="text"]').element as HTMLInputElement).value).toBe('edge-2');
    expect(wrapper.find('.data-table').attributes('data-row-count')).toBe('1');
  });

  it('API failure shows inline error', async () => {
    mockGetAgents.mockRejectedValue(new Error('boom'));

    const wrapper = await mountAgentsView();

    expect(wrapper.text()).toContain('boom');
    expect(wrapper.find('.data-table').attributes('data-row-count')).toBe('0');
  });

  it('refreshes agents when agent status SSE event is received', async () => {
    await mountAgentsView();
    expect(mockGetAgents).toHaveBeenCalledTimes(1);

    globalThis.dispatchEvent(new CustomEvent('dd:sse-agent-status-changed'));
    await flushPromises();

    expect(mockGetAgents).toHaveBeenCalledTimes(2);
  });

  it('shows agent-specific watchers and triggers in detail panel', async () => {
    mockGetAgents.mockResolvedValue([makeAgent({ name: 'edge-1' })]);
    mockGetAllWatchers.mockResolvedValue([
      { id: 'edge-1.docker.remote', type: 'docker', name: 'remote', agent: 'edge-1' },
      { id: 'docker.local', type: 'docker', name: 'local' },
    ]);
    mockGetAllTriggers.mockResolvedValue([
      { id: 'edge-1.slack.ops', type: 'slack', name: 'ops', agent: 'edge-1' },
      { id: 'smtp.email', type: 'smtp', name: 'email' },
    ]);

    const wrapper = await mountAgentsView();
    await wrapper.find('.row-click-first').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Watchers');
    expect(wrapper.text()).toContain('docker.remote');
    expect(wrapper.text()).toContain('Triggers');
    expect(wrapper.text()).toContain('slack.ops');
    expect(wrapper.text()).not.toContain('docker.local');
    expect(wrapper.text()).not.toContain('smtp.email');
  });

  it('applies agent log filters and refreshes logs from the detail panel', async () => {
    mockGetAgents.mockResolvedValue([makeAgent({ name: 'edge-1', connected: true })]);
    mockGetLogEntries.mockResolvedValue([
      {
        timestamp: '2026-02-28T10:00:00.000Z',
        level: 'info',
        component: 'agent',
        msg: 'connected',
      },
    ]);

    const wrapper = await mountAgentsView();
    await wrapper.find('.row-click-first').trigger('click');
    await flushPromises();

    const logsTab = wrapper.findAll('button').find((button) => button.text().includes('Logs'));
    expect(logsTab).toBeDefined();
    await logsTab?.trigger('click');
    await flushPromises();

    const levelSelect = wrapper.find('[data-testid="agent-log-level-filter"]');
    const tailSelect = wrapper.find('[data-testid="agent-log-tail-filter"]');
    const componentInput = wrapper.find('[data-testid="agent-log-component-filter"]');
    const applyButton = wrapper.find('[data-testid="agent-log-apply"]');
    const refreshButton = wrapper.find('[data-testid="agent-log-refresh"]');

    expect(levelSelect.exists()).toBe(true);
    expect(tailSelect.exists()).toBe(true);
    expect(componentInput.exists()).toBe(true);
    expect(applyButton.exists()).toBe(true);
    expect(refreshButton.exists()).toBe(true);

    await levelSelect.setValue('warn');
    await tailSelect.setValue('500');
    await componentInput.setValue('api');
    await applyButton.trigger('click');
    await flushPromises();

    expect(mockGetLogEntries).toHaveBeenLastCalledWith({
      agent: 'edge-1',
      level: 'warn',
      component: 'api',
      tail: 500,
    });

    await refreshButton.trigger('click');
    await flushPromises();

    expect(mockGetLogEntries).toHaveBeenLastCalledWith({
      agent: 'edge-1',
      level: 'warn',
      component: 'api',
      tail: 500,
    });
  });

  it('hides unknown runtime fields when API only returns base agent connectivity fields', async () => {
    mockGetAgents.mockResolvedValue([
      {
        name: 'edge-1',
        host: '10.0.0.31',
        port: 2376,
        connected: true,
      },
    ]);

    const wrapper = await mountAgentsView();
    await wrapper.find('.row-click-first').trigger('click');
    await flushPromises();

    expect(wrapper.text()).not.toContain('CPUs');
    expect(wrapper.text()).not.toContain('Memory');
    expect(wrapper.text()).not.toContain('Architecture');
    expect(wrapper.text()).not.toContain('Docker');
  });
});
