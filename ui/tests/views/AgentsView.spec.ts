import { flushPromises } from '@vue/test-utils';
import { getAgents } from '@/services/agent';
import { getLogEntries } from '@/services/log';
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

const mockGetAgents = getAgents as ReturnType<typeof vi.fn>;
const mockGetLogEntries = getLogEntries as ReturnType<typeof vi.fn>;

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
  await flushPromises();
  return wrapper;
}

describe('AgentsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRoute.query = {};
    mockGetAgents.mockResolvedValue([makeAgent()]);
    mockGetLogEntries.mockResolvedValue([]);
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
});
