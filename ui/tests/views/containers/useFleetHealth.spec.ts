import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, ref } from 'vue';
import FleetHealthBar from '@/components/containers/FleetHealthBar.vue';
import { getAgentRoster, getAgents } from '@/services/agent';
import { getAllWatchers, refreshWatcherInventory } from '@/services/watcher';
import type { ApiAgent, ApiComponent } from '@/types/api';
import { mapApiContainer } from '@/utils/container-mapper';
import { useFleetHealth } from '@/views/containers/useFleetHealth';

vi.mock('@/services/agent', () => ({ getAgents: vi.fn(), getAgentRoster: vi.fn() }));
vi.mock('@/services/watcher', () => ({
  getAllWatchers: vi.fn(),
  refreshWatcherInventory: vi.fn(),
}));

const watcher = (id: string, agent?: string, supported = true) =>
  ({
    id,
    name: id,
    type: 'docker',
    agent,
    configuration: {},
    metadata: { inventoryRefreshSupported: supported },
  }) satisfies ApiComponent;
const agent = (name: string, connected = true, total = 0) =>
  ({
    name,
    host: '127.0.0.1',
    connected,
    containers: { total, running: total, stopped: 0 },
    lastSeen: '2026-09-08T20:00:00Z',
  }) satisfies ApiAgent;
const result = (overrides = {}) => ({
  context: { origin: 'inventory', operationId: 'op', source: { type: 'docker', name: 'one' } },
  authoritative: true,
  containers: [],
  removedIds: [],
  errors: [],
  ...overrides,
});
const key = (name?: string) => JSON.stringify(name ? ['agent', name] : ['local']);
const wrappers: ReturnType<typeof mount>[] = [];
function harness() {
  const input = {
    containers: ref([
      mapApiContainer({ id: 'local', name: 'local' }),
      mapApiContainer({ id: 'remote', name: 'remote', agent: 'Local' }),
    ]),
    inventoryAvailable: ref(true),
    busy: ref(false),
    loadContainers: vi.fn().mockResolvedValue(undefined),
  };
  let health: ReturnType<typeof useFleetHealth>;
  const wrapper = mount(
    defineComponent({
      setup() {
        health = useFleetHealth(input);
        return () => h(FleetHealthBar, { health });
      },
    }),
  );
  wrappers.push(wrapper);
  return { input, health: health!, wrapper };
}

describe('useFleetHealth', () => {
  it('retains known identities through both failures and removes them on fresh successful reads', async () => {
    vi.mocked(getAgentRoster).mockResolvedValue([{ name: 'cold' }]);
    const { health, wrapper } = harness();
    await flushPromises();
    expect(health.rows.value.some((row) => row.agent === 'cold')).toBe(true);
    vi.mocked(getAgents).mockRejectedValue(new Error('offline'));
    vi.mocked(getAgentRoster).mockRejectedValue(new Error('offline'));
    await health.load();
    expect(health.rows.value.filter((row) => row.agent)).toHaveLength(4);
    expect(wrapper.text()).toContain('Agent roster unavailable');
    expect(health.rows.value.find((row) => row.agent === 'edge')!.total).toBe(4);
    expect(health.rows.value.find((row) => row.agent === 'edge')!.lastKnown).toBe(true);
    vi.mocked(getAgentRoster).mockResolvedValue([{ name: 'edge' }, { name: 'new' }]);
    await health.load();
    expect(health.rows.value.filter((row) => row.agent).map((row) => row.agent)).toEqual([
      'edge',
      'new',
    ]);
    expect(health.rows.value.find((row) => row.agent === 'new')!.total).toBeUndefined();
    vi.mocked(getAgents).mockResolvedValue([agent('Local')]);
    vi.mocked(getAgentRoster).mockRejectedValue(new Error('older controller'));
    await health.load();
    const remote = health.rows.value.filter((row) => row.agent);
    expect(remote).toHaveLength(1);
    expect(remote[0]!.agent).toBe('Local');
    expect(remote[0]!.canRefresh).toBe(true);
    expect(health.agentError.value).toBe(false);
    expect(health.rosterError.value).toBe(true);
    vi.mocked(getAgents).mockResolvedValue([]);
    vi.mocked(getAgentRoster).mockResolvedValue([]);
    await health.load();
    expect(health.rows.value.filter((row) => row.agent)).toEqual([]);
  });

  it('does not infer identities from watchers when both initial reads fail and recovers explicitly', async () => {
    vi.mocked(getAgents).mockRejectedValue(new Error('offline'));
    vi.mocked(getAgentRoster).mockRejectedValue(new Error('offline'));
    const { health, wrapper } = harness();
    await flushPromises();
    expect(health.rows.value.map((row) => row.agent)).toEqual([undefined]);
    expect(wrapper.text()).toContain('Agent roster unavailable');
    expect(wrapper.text()).toContain('Agent status unavailable');
    vi.mocked(getAgents).mockResolvedValue([agent('Local')]);
    vi.mocked(getAgentRoster).mockResolvedValue([{ name: 'Local' }, { name: 'Local' }]);
    await wrapper.get('[data-test="fleet-health-reload"]').trigger('click');
    await flushPromises();
    expect(health.rows.value.map((row) => row.agent)).toEqual([undefined, 'Local']);
    expect(health.rows.value[1]!.canRefresh).toBe(true);
    expect(wrapper.text()).not.toContain('Agent roster unavailable');
  });

  it('retains cold identities when a later real HTTP roster is malformed', async () => {
    const actual = await vi.importActual<typeof import('@/services/agent')>('@/services/agent');
    vi.mocked(getAgentRoster).mockImplementation(actual.getAgentRoster);
    vi.mocked(getAgents).mockRejectedValue(new Error('offline'));
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ data: [{ name: 'cold' }], total: 1 }));
    const { health } = harness();
    await flushPromises();
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ data: [{ name: null }] }));
    await health.load();
    expect(health.rosterError.value).toBe(true);
    expect(health.rows.value.filter((row) => row.agent).map((row) => row.agent)).toEqual(['cold']);
  });
  it('shows exact roster identities on a cold status failure without registered watchers', async () => {
    vi.mocked(getAgents).mockRejectedValue(new Error('status unavailable'));
    vi.mocked(getAgentRoster).mockResolvedValue([{ name: 'Local' }, { name: 'local' }]);
    vi.mocked(getAllWatchers).mockResolvedValue([]);
    const { health, wrapper } = harness();
    await flushPromises();
    expect(health.rows.value.map((row) => row.agent).sort()).toEqual(['Local', 'local']);
    for (const row of health.rows.value) {
      expect(row.status).toBe('unavailable');
      expect(row.total).toBeUndefined();
      expect(row.lastKnown).toBe(false);
      expect(row.canRefresh).toBe(false);
      await health.refresh(row.key);
    }
    expect(wrapper.text()).toContain('Agent status unavailable');
    expect(refreshWatcherInventory).not.toHaveBeenCalled();
  });

  it('does not refresh roster-only identities even when their watcher advertises support', async () => {
    vi.mocked(getAgents).mockResolvedValue([]);
    vi.mocked(getAgentRoster).mockResolvedValue([{ name: 'Local' }]);
    const { health } = harness();
    await flushPromises();
    const row = health.rows.value.find((item) => item.agent === 'Local')!;
    expect(row.supported).toBe(true);
    expect(row.status).toBe('unavailable');
    expect(row.canRefresh).toBe(false);
    await health.refresh(row.key);
    expect(refreshWatcherInventory).not.toHaveBeenCalled();
  });
  it('reloads idle agent-status events and keeps invalid statistics unavailable', async () => {
    vi.mocked(getAgents).mockResolvedValue([
      agent('negative', true, -1),
      agent('infinite', true, Infinity),
    ]);
    const { health } = harness();
    await flushPromises();
    globalThis.dispatchEvent(new Event('dd:sse-agent-status-changed'));
    await flushPromises();
    expect(getAgents).toHaveBeenCalledTimes(2);
    expect(
      health.rows.value.filter((row) => row.agent).every((row) => row.total === undefined),
    ).toBe(true);
  });
  it('renders configured, connected, offline and unavailable states without a fabricated healthy local status', async () => {
    const { wrapper } = harness();
    await flushPromises();
    const tiles = wrapper.findAll('[data-test="fleet-health-row"]');
    expect(tiles).toHaveLength(4);
    expect(tiles[0]!.text()).toContain('Local watchers');
    expect(tiles[0]!.text()).toContain('Configured');
    expect(tiles[0]!.text()).not.toContain('Connected');
    const online = tiles.find((tile) => tile.attributes('data-source') === key('Local'))!;
    expect(online.text()).toContain('0 containers');
    expect(online.text()).toContain('one');
    expect(online.text()).toContain('two');
    expect(tiles.find((tile) => tile.attributes('data-source') === key('edge'))!.text()).toContain(
      'Last known',
    );
    expect(tiles.find((tile) => tile.attributes('data-source') === key('local'))!.text()).toContain(
      'Unavailable',
    );
    await online.get('[data-test="fleet-inventory-refresh"]').trigger('click');
    await flushPromises();
    expect(online.text()).toContain('Inventory complete');
    expect(online.text()).not.toContain('2 containers refreshed');
    const before = vi.mocked(getAgents).mock.calls.length;
    await wrapper.get('[data-test="fleet-health-reload"]').trigger('click');
    await flushPromises();
    expect(getAgents).toHaveBeenCalledTimes(before + 1);
  });

  it('renders independent stale-data warnings and watcher error detail', async () => {
    const { health, input, wrapper } = harness();
    await flushPromises();
    vi.mocked(refreshWatcherInventory).mockResolvedValueOnce(
      result({
        authoritative: false,
        errors: [{ phase: 'inspect', id: 'bad-id', message: 'inspect failed' }],
      }) as any,
    );
    input.loadContainers.mockRejectedValueOnce(new Error('read failed'));
    await health.refresh(key('Local'));
    expect(wrapper.text()).toContain('Inventory incomplete');
    expect(wrapper.text()).toContain('inspect · bad-id: inspect failed');
    expect(wrapper.text()).toContain('Container list reload failed');
    vi.mocked(getAgents).mockRejectedValueOnce(new Error('down'));
    vi.mocked(getAllWatchers).mockRejectedValueOnce(new Error('down'));
    await health.load();
    expect(wrapper.text()).toContain('Agent status unavailable');
    expect(wrapper.text()).toContain('Watcher metadata unavailable');
  });
  beforeEach(async () => {
    const actualAgentService =
      await vi.importActual<typeof import('@/services/agent')>('@/services/agent');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () =>
        Response.json({
          data: [
            agent('Local'),
            agent('edge', false, 4),
            { name: 'local', host: '127.0.0.1', connected: true },
          ],
          total: 3,
        }),
      ),
    );
    vi.mocked(getAgents).mockReset().mockImplementation(actualAgentService.getAgents);
    vi.mocked(getAgentRoster).mockReset().mockResolvedValue([]);
    vi.mocked(getAllWatchers)
      .mockReset()
      .mockResolvedValue([
        watcher('controller'),
        watcher('one', 'Local'),
        watcher('two', 'Local'),
        watcher('offline', 'edge'),
        watcher('old', 'local', false),
      ]);
    vi.mocked(refreshWatcherInventory)
      .mockReset()
      .mockResolvedValue(result() as any);
  });
  afterEach(() => {
    for (const wrapper of wrappers.splice(0)) wrapper.unmount();
    vi.unstubAllGlobals();
  });

  it('keeps missing HTTP container statistics unavailable until a complete response arrives', async () => {
    const { health, wrapper } = harness();
    await flushPromises();
    expect(fetch).toHaveBeenCalledWith('/api/v1/agents', { credentials: 'include' });
    const tile = () => wrapper.get(`[data-source='${key('local')}']`);
    expect(health.rows.value.find((row) => row.agent === 'local')!.total).toBeUndefined();
    expect(tile().text()).toContain('Unavailable');
    expect(tile().text()).not.toContain('0 containers');

    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ data: [agent('local')], total: 1 }));
    await health.load();
    expect(health.rows.value.find((row) => row.agent === 'local')!.total).toBe(0);
    expect(tile().text()).toContain('0 containers');
  });

  it('keeps exact configured identities, zero/offline/missing counts and separate watcher children', async () => {
    const { health, input } = harness();
    await flushPromises();
    const rows = health.rows.value;
    expect(rows.map((r) => r.key)).toEqual(
      [key(), key('local'), key('Local'), key('edge')].sort((a, b) =>
        a === key() ? -1 : b === key() ? 1 : a.localeCompare(b),
      ),
    );
    expect(rows.find((r) => r.key === key())).toMatchObject({ status: 'configured', total: 1 });
    expect(rows.find((r) => r.key === key('Local'))).toMatchObject({
      status: 'connected',
      total: 0,
      canRefresh: true,
    });
    expect(rows.find((r) => r.key === key('Local'))!.watchers.map((w) => w.id)).toEqual([
      'one',
      'two',
    ]);
    expect(rows.find((r) => r.key === key('edge'))).toMatchObject({
      status: 'disconnected',
      total: 4,
      lastKnown: true,
      canRefresh: false,
    });
    expect(rows.find((r) => r.key === key('local'))).toMatchObject({
      total: undefined,
      canRefresh: false,
    });
    input.inventoryAvailable.value = false;
    expect(health.rows.value[0]!.total).toBeUndefined();
  });

  it('retains stale agents and watchers independently and disables actions on either fetch failure', async () => {
    vi.mocked(getAgentRoster).mockResolvedValue([{ name: 'Local' }]);
    const { health } = harness();
    await flushPromises();
    vi.mocked(getAgents).mockRejectedValueOnce(new Error('agents down'));
    await health.load();
    expect(health.agentError.value).toBe(true);
    expect(health.watcherError.value).toBe(false);
    expect(health.rows.value.find((r) => r.key === key('Local'))).toMatchObject({
      status: 'unavailable',
      total: 0,
      lastKnown: true,
      canRefresh: false,
    });
    vi.mocked(getAllWatchers).mockRejectedValueOnce(new Error('watchers down'));
    await health.load();
    expect(health.agentError.value).toBe(false);
    expect(health.watcherError.value).toBe(true);
    expect(health.rows.value[0]!.watchers).toHaveLength(1);
    expect(health.rows.value.every((r) => !r.canRefresh)).toBe(true);
  });

  it('keeps configured zero-container agents even without watchers, never fabricating a local tile', async () => {
    vi.mocked(getAllWatchers).mockResolvedValue([]);
    const { health } = harness();
    await flushPromises();
    expect(health.rows.value).toHaveLength(3);
    expect(health.rows.value.every((r) => r.agent && !r.canRefresh)).toBe(true);
  });

  it('treats missing capability and non-Docker watchers as unsupported', async () => {
    vi.mocked(getAllWatchers).mockResolvedValue([
      { ...watcher('one', 'Local'), metadata: {} },
      { ...watcher('two', 'local'), type: 'other' },
    ]);
    const { health } = harness();
    await flushPromises();
    await health.refresh(key('Local'));
    await health.refresh(key('local'));
    await health.refresh('absent');
    expect(refreshWatcherInventory).not.toHaveBeenCalled();
  });

  it('snapshots all exact agent watchers, accepts authoritative empty results and reloads once', async () => {
    let resolve!: (value: any) => void;
    vi.mocked(refreshWatcherInventory).mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const { health, input } = harness();
    await flushPromises();
    const work = health.refresh(key('Local'));
    expect(health.refreshing.value).toBe(key('Local'));
    await health.refresh(key('Local'));
    vi.mocked(getAllWatchers).mockResolvedValue([watcher('new', 'Local')]);
    await health.load();
    resolve(result());
    await work;
    expect(vi.mocked(refreshWatcherInventory).mock.calls.map(([w]) => w.name)).toEqual([
      'one',
      'two',
    ]);
    expect(input.loadContainers).toHaveBeenCalledTimes(1);
    expect(health.outcomes.value[key('Local')]).toMatchObject({
      complete: true,
      reloadFailed: false,
      results: [
        { id: 'one', authoritative: true },
        { id: 'two', authoritative: true },
      ],
    });
    expect(health.refreshing.value).toBeNull();
  });

  it('keeps partial watcher phases and IDs separate from HTTP and final reload failures', async () => {
    vi.mocked(refreshWatcherInventory)
      .mockResolvedValueOnce(
        result({
          authoritative: false,
          errors: [{ phase: 'inspect', id: 'bad', message: 'inspect failed' }],
        }) as any,
      )
      .mockRejectedValueOnce(new Error('503 unavailable'));
    const { health, input } = harness();
    input.loadContainers.mockRejectedValueOnce(new Error('read failed'));
    await flushPromises();
    await health.refresh(key('Local'));
    expect(health.outcomes.value[key('Local')]).toEqual({
      complete: false,
      reloadFailed: true,
      results: [
        {
          id: 'one',
          name: 'one',
          authoritative: false,
          errors: [{ phase: 'inspect', id: 'bad', message: 'inspect failed' }],
        },
        {
          id: 'two',
          name: 'two',
          authoritative: false,
          errors: [{ phase: 'request', message: '503 unavailable' }],
        },
      ],
    });
    expect(input.loadContainers).toHaveBeenCalledTimes(1);
    expect(health.refreshing.value).toBeNull();
  });

  it('does not call incomplete stale results complete, even when they contain no errors', async () => {
    vi.mocked(refreshWatcherInventory).mockResolvedValue(result({ authoritative: false }) as any);
    const { health } = harness();
    await flushPromises();
    await health.refresh(key('Local'));
    expect(health.outcomes.value[key('Local')]!.complete).toBe(false);
  });

  it('blocks while the existing container actions are busy', async () => {
    const { health, input } = harness();
    await flushPromises();
    input.busy.value = true;
    await health.refresh(key('Local'));
    expect(refreshWatcherInventory).not.toHaveBeenCalled();
  });

  it('coalesces status/reconnect/resync events with one trailing load and removes listeners on disposal', async () => {
    let resolve!: (value: any) => void;
    vi.mocked(getAgents).mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const { health, wrapper } = harness();
    const first = health.load();
    for (const event of [
      'dd:sse-agent-status-changed',
      'dd:sse-connected',
      'dd:sse-resync-required',
    ])
      globalThis.dispatchEvent(new Event(event));
    expect(getAgents).toHaveBeenCalledTimes(1);
    expect(getAgentRoster).toHaveBeenCalledTimes(1);
    resolve([agent('Local')]);
    await first;
    await flushPromises();
    expect(getAgents).toHaveBeenCalledTimes(2);
    wrapper.unmount();
    expect(getAgentRoster).toHaveBeenCalledTimes(2);
    globalThis.dispatchEvent(new Event('dd:sse-agent-status-changed'));
    await health.load();
    expect(getAgents).toHaveBeenCalledTimes(2);
    expect(getAgentRoster).toHaveBeenCalledTimes(2);
  });
});
