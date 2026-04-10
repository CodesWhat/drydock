import { ref } from 'vue';
import type { Container } from '@/types/container';
import { daysToMs } from '@/utils/maturity-policy';
import type {
  DashboardAgent,
  DashboardContainerSummary,
  DashboardServerInfo,
  RecentAuditStatus,
} from '@/views/dashboard/dashboardTypes';
import { useDashboardComputed } from '@/views/dashboard/useDashboardComputed';
import { getWatcherConfiguration } from '@/views/dashboard/watcherConfiguration';

vi.mock('@/views/dashboard/watcherConfiguration', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/views/dashboard/watcherConfiguration')>();
  return { getWatcherConfiguration: vi.fn(original.getWatcherConfiguration) };
});

function makeContainer(
  id: number,
  server: string,
  status: 'running' | 'stopped',
  counters: { serverReads: number },
): Container {
  const container: Container = {
    id: `c-${id}`,
    identityKey: `::watcher-${server.toLowerCase()}::container-${id}`,
    name: `container-${id}`,
    image: `image-${id}`,
    icon: 'docker',
    currentTag: '1.0.0',
    newTag: null,
    updateKind: null,
    updateMaturity: null,
    bouncer: 'safe',
    registry: 'dockerhub',
    server,
    status,
    details: { ports: [], volumes: [], env: [], labels: [] },
  };

  Object.defineProperty(container, 'server', {
    configurable: true,
    enumerable: true,
    get() {
      counters.serverReads += 1;
      return server;
    },
  });

  Object.defineProperty(container, 'status', {
    configurable: true,
    enumerable: true,
    get() {
      return status;
    },
  });

  return container;
}

function makeBaseContainer(overrides: Partial<Container> = {}): Container {
  const defaultId = overrides.id ?? 'c-0';
  const defaultName = overrides.name ?? 'container-0';
  return {
    id: defaultId,
    identityKey: overrides.identityKey ?? `::local::${defaultName}`,
    name: defaultName,
    image: 'image-0',
    icon: 'docker',
    currentTag: '1.0.0',
    newTag: null,
    updateKind: null,
    updateMaturity: null,
    bouncer: 'safe',
    registry: 'dockerhub',
    server: 'Local',
    status: 'running',
    details: { ports: [], volumes: [], env: [], labels: [] },
    ...overrides,
  };
}

function makeAgents(count: number): DashboardAgent[] {
  return Array.from({ length: count }, (_, index) => ({
    name: `agent-${index}`,
    connected: index % 2 === 0,
    host: `10.0.0.${index + 1}`,
    port: 2375,
  }));
}

interface DashboardComputedOverrides {
  agents?: DashboardAgent[];
  containerSummary?: DashboardContainerSummary | null;
  containers?: Container[];
  hidePinned?: boolean;
  maintenanceCountdownNow?: number;
  recentStatusByContainer?: Record<string, RecentAuditStatus>;
  recentStatusByIdentity?: Record<string, RecentAuditStatus>;
  registries?: unknown[];
  serverInfo?: DashboardServerInfo | null;
  watchers?: unknown[];
}

function createState(overrides: DashboardComputedOverrides = {}) {
  return useDashboardComputed({
    agents: ref(overrides.agents ?? []),
    containerSummary: ref(overrides.containerSummary ?? null),
    containers: ref(overrides.containers ?? []),
    hidePinned: ref(overrides.hidePinned ?? false),
    maintenanceCountdownNow: ref(overrides.maintenanceCountdownNow ?? Date.now()),
    recentStatusByContainer: ref(overrides.recentStatusByContainer ?? {}),
    recentStatusByIdentity: ref(overrides.recentStatusByIdentity ?? {}),
    registries: ref(overrides.registries ?? []),
    serverInfo: ref(overrides.serverInfo ?? null),
    watchers: ref(overrides.watchers ?? []),
  });
}

describe('useDashboardComputed servers', () => {
  it('builds Local and agent rows with grouped counts and normalized agent hosts', () => {
    const agents: DashboardAgent[] = [
      { name: 'edge-a', connected: true, host: '10.0.0.10', port: 2375 },
      { name: 'edge-b', connected: false, host: ' edge-b.local ', port: ' 4243 ' },
      { name: '', connected: true, host: '   ', port: 1234 },
    ];
    const containers: Container[] = [
      makeBaseContainer({ id: 'l-1', name: 'local-running', server: 'Local', status: 'running' }),
      makeBaseContainer({ id: 'l-2', name: 'local-stopped', server: 'Local', status: 'stopped' }),
      makeBaseContainer({
        id: 'a-1',
        name: 'agent-a-running',
        server: 'edge-a',
        status: 'running',
      }),
      makeBaseContainer({
        id: 'a-2',
        name: 'agent-a-stopped',
        server: 'edge-a',
        status: 'stopped',
      }),
      makeBaseContainer({
        id: 'b-1',
        name: 'agent-b-running',
        server: 'edge-b',
        status: 'running',
      }),
    ];
    const state = createState({ agents, containers });

    expect(state.servers.value).toEqual([
      {
        name: 'Local',
        host: 'unix:///var/run/docker.sock',
        status: 'connected',
        containers: { running: 1, total: 2 },
      },
      {
        name: 'edge-a',
        host: '10.0.0.10:2375',
        status: 'connected',
        containers: { running: 1, total: 2 },
      },
      {
        name: 'edge-b',
        host: 'edge-b.local:4243',
        status: 'disconnected',
        containers: { running: 1, total: 1 },
      },
      {
        name: 'unknown-agent',
        host: undefined,
        status: 'connected',
        containers: { running: 0, total: 0 },
      },
    ]);
  });

  it('groups containers without re-scanning all containers for every agent', () => {
    const counters = { serverReads: 0 };
    const agents = makeAgents(20);
    const containers = Array.from({ length: 120 }, (_, index) => {
      if (index % 6 === 0) {
        return makeContainer(index, 'Local', 'running', counters);
      }
      return makeContainer(
        index,
        `agent-${index % agents.length}`,
        index % 4 === 0 ? 'stopped' : 'running',
        counters,
      );
    });

    const state = createState({ agents, containers });

    const rows = state.servers.value;
    const totalContainers = rows.reduce((sum, row) => sum + row.containers.total, 0);

    expect(rows.length).toBe(agents.length + 1);
    expect(totalContainers).toBe(containers.length);
    expect(counters.serverReads).toBeLessThanOrEqual(containers.length * 4);
  });

  it('keeps bare host when agent port is empty', () => {
    const state = createState({
      agents: [{ name: 'edge-c', connected: true, host: 'edge-c.local', port: '   ' }],
      containers: [],
    });

    expect(state.servers.value.find((row) => row.name === 'edge-c')?.host).toBe('edge-c.local');
  });

  it('keeps bare host when agent port is missing', () => {
    const state = createState({
      agents: [{ name: 'edge-d', connected: true, host: 'edge-d.local' }],
      containers: [],
    });

    expect(state.servers.value.find((row) => row.name === 'edge-d')?.host).toBe('edge-d.local');
  });

  it('includes non-agent remote watchers with correct container counts', () => {
    const watchers = [
      { name: 'local', configuration: { socket: '/var/run/docker.sock' } },
      { name: 'esk83', configuration: { host: '10.0.0.83', port: 2375 } },
      { name: 'esk00', configuration: { host: '10.0.0.100', port: 2375, protocol: 'https' } },
    ];
    const containers: Container[] = [
      makeBaseContainer({ id: 'l-1', server: 'Local', status: 'running' }),
      makeBaseContainer({ id: 'e83-1', server: 'Esk83', status: 'running' }),
      makeBaseContainer({ id: 'e83-2', server: 'Esk83', status: 'stopped' }),
      makeBaseContainer({ id: 'e00-1', server: 'Esk00', status: 'running' }),
    ];
    const state = createState({ watchers, containers });

    expect(state.servers.value).toEqual([
      {
        name: 'Local',
        host: 'unix:///var/run/docker.sock',
        status: 'connected',
        containers: { running: 1, total: 1 },
      },
      {
        name: 'Esk83',
        host: 'http://10.0.0.83:2375',
        status: 'connected',
        containers: { running: 1, total: 2 },
      },
      {
        name: 'Esk00',
        host: 'https://10.0.0.100:2375',
        status: 'connected',
        containers: { running: 1, total: 1 },
      },
    ]);
  });

  it('includes non-agent remote watchers alongside agents without double-counting', () => {
    const watchers = [
      { name: 'local', configuration: { socket: '/var/run/docker.sock' } },
      { name: 'remote1', configuration: { host: '10.0.0.50', port: 2375 } },
    ];
    const agents: DashboardAgent[] = [
      { name: 'edge-a', connected: true, host: '10.0.0.10', port: 2375 },
    ];
    const containers: Container[] = [
      makeBaseContainer({ id: 'l-1', server: 'Local', status: 'running' }),
      makeBaseContainer({ id: 'r-1', server: 'Remote1', status: 'running' }),
      makeBaseContainer({ id: 'a-1', server: 'edge-a', status: 'running' }),
    ];
    const state = createState({ watchers, agents, containers });

    const serverNames = state.servers.value.map((s) => s.name);
    expect(serverNames).toEqual(['Local', 'Remote1', 'edge-a']);
    expect(state.servers.value.reduce((sum, s) => sum + s.containers.total, 0)).toBe(3);
  });

  it('ignores only watchers with truthy agent while keeping falsy-agent watcher records', () => {
    const watchers = [
      null,
      123,
      { name: 'local', configuration: { socket: '/var/run/docker.sock' } },
      { name: 'with-agent', agent: 'edge-a', configuration: { host: '10.0.0.55', port: 2375 } },
      { name: 'empty-agent', agent: '', configuration: { host: '10.0.0.56', port: 2375 } },
    ];
    const state = createState({ watchers, containers: [] });

    expect(state.servers.value.map((row) => row.name)).toEqual(['Local', 'Empty-agent']);
  });

  it('uses socket host for local watcher and bare host when no port for remote watcher', () => {
    const watchers = [
      { name: 'local', configuration: { socket: '/var/run/docker.sock' } },
      { name: 'bare', configuration: { host: 'bare.local' } },
    ];
    const state = createState({ watchers, containers: [] });

    expect(state.servers.value.find((s) => s.name === 'Local')?.host).toBe(
      'unix:///var/run/docker.sock',
    );
    expect(state.servers.value.find((s) => s.name === 'Bare')?.host).toBe('bare.local');
  });
});

describe('useDashboardComputed update summary', () => {
  it('computes update breakdown buckets and total updates', () => {
    const containers: Container[] = [
      makeBaseContainer({ id: 'major-1', updateKind: 'major' }),
      makeBaseContainer({ id: 'major-2', updateKind: 'major' }),
      makeBaseContainer({ id: 'minor-1', updateKind: 'minor' }),
      makeBaseContainer({ id: 'patch-1', updateKind: 'patch' }),
      makeBaseContainer({ id: 'digest-1', updateKind: 'digest' }),
      makeBaseContainer({ id: 'none-1', updateKind: null }),
    ];
    const state = createState({ containers });

    expect(state.updateBreakdownBuckets.value.map(({ kind, count }) => ({ kind, count }))).toEqual([
      { kind: 'major', count: 2 },
      { kind: 'minor', count: 1 },
      { kind: 'patch', count: 1 },
      { kind: 'digest', count: 1 },
    ]);
    expect(state.totalUpdates.value).toBe(5);
  });

  it.each([
    {
      updates: 0,
      color: 'var(--dd-success)',
      colorMuted: 'var(--dd-success-muted)',
    },
    {
      updates: 1,
      color: 'var(--dd-caution)',
      colorMuted: 'var(--dd-caution-muted)',
    },
    {
      updates: 2,
      color: 'var(--dd-warning)',
      colorMuted: 'var(--dd-warning-muted)',
    },
    {
      updates: 3,
      color: 'var(--dd-danger)',
      colorMuted: 'var(--dd-danger-muted)',
    },
  ])('uses the expected updates stat colors when $updates of 4 containers have updates', ({
    updates,
    color,
    colorMuted,
  }) => {
    const containers = Array.from({ length: 4 }, (_, index) =>
      makeBaseContainer({
        id: `ratio-${index}`,
        updateKind: index < updates ? 'minor' : null,
      }),
    );
    const state = createState({ containers });
    const updateStat = state.stats.value.find((card) => card.id === 'stat-updates');

    expect(updateStat).toMatchObject({
      value: String(updates),
      color,
      colorMuted,
      route: { path: '/containers', query: { filterKind: 'any' } },
    });
  });

  it('shows new and mature counts in the updates stat detail when new updates exist', () => {
    const now = Date.now();
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const tenDaysAgo = new Date(now - daysToMs(10)).toISOString();
    const state = createState({
      containers: [
        makeBaseContainer({ id: 'fresh-1', updateKind: 'minor', updateDetectedAt: twoHoursAgo }),
        makeBaseContainer({ id: 'settled-1', updateKind: 'patch', updateDetectedAt: tenDaysAgo }),
        makeBaseContainer({ id: 'no-update', updateKind: null }),
      ],
    });
    const updateStat = state.stats.value.find((card) => card.id === 'stat-updates');

    expect(updateStat?.detail).toBe('1 new · 1 mature');
  });

  it('omits detail on updates stat when no fresh updates exist', () => {
    const tenDaysAgo = new Date(Date.now() - daysToMs(10)).toISOString();
    const state = createState({
      containers: [
        makeBaseContainer({ id: 'settled-1', updateKind: 'minor', updateDetectedAt: tenDaysAgo }),
      ],
    });
    const updateStat = state.stats.value.find((card) => card.id === 'stat-updates');

    expect(updateStat?.detail).toBeUndefined();
  });

  it('reports registry totals from loaded registries in the stat cards', () => {
    const state = createState({
      containers: [makeBaseContainer({ id: 'registry-stat' })],
      registries: [{ id: 'r-1' }, { id: 'r-2' }, { id: 'r-3' }],
    });
    const registryStat = state.stats.value.find((card) => card.id === 'stat-registries');

    expect(registryStat).toMatchObject({
      value: '3',
      route: '/registries',
      color: 'var(--dd-primary)',
      colorMuted: 'var(--dd-primary-muted)',
    });
  });

  it('falls back to caution update colors when summary total is zero but updates exist', () => {
    const state = createState({
      containerSummary: {
        containers: {
          total: 0,
          running: 0,
          stopped: 0,
        },
      } as DashboardContainerSummary,
      containers: [makeBaseContainer({ id: 'ratio-zero-total', updateKind: 'minor' })],
    });
    const updateStat = state.stats.value.find((card) => card.id === 'stat-updates');

    expect(updateStat).toMatchObject({
      value: '1',
      color: 'var(--dd-caution)',
      colorMuted: 'var(--dd-caution-muted)',
    });
  });

  it('exposes status and update-kind visual helpers for all supported values', () => {
    const state = createState();

    expect(state.getRecentUpdateStatusColor('updated')).toBe('var(--dd-success)');
    expect(state.getRecentUpdateStatusColor('pending')).toBe('var(--dd-warning)');
    expect(state.getRecentUpdateStatusColor('snoozed')).toBe('var(--dd-primary)');
    expect(state.getRecentUpdateStatusColor('maturity-blocked')).toBe('var(--dd-primary)');
    expect(state.getRecentUpdateStatusColor('skipped')).toBe('var(--dd-text-muted)');
    expect(state.getRecentUpdateStatusColor('failed')).toBe('var(--dd-danger)');
    expect(state.getRecentUpdateStatusColor('error')).toBe('var(--dd-danger)');

    expect(state.getRecentUpdateStatusMutedColor('updated')).toBe('var(--dd-success-muted)');
    expect(state.getRecentUpdateStatusMutedColor('pending')).toBe('var(--dd-warning-muted)');
    expect(state.getRecentUpdateStatusMutedColor('snoozed')).toBe('var(--dd-primary-muted)');
    expect(state.getRecentUpdateStatusMutedColor('maturity-blocked')).toBe(
      'var(--dd-primary-muted)',
    );
    expect(state.getRecentUpdateStatusMutedColor('skipped')).toBe('var(--dd-bg-elevated)');
    expect(state.getRecentUpdateStatusMutedColor('failed')).toBe('var(--dd-danger-muted)');
    expect(state.getRecentUpdateStatusMutedColor('error')).toBe('var(--dd-danger-muted)');

    expect(state.getRecentUpdateStatusIcon('updated')).toBe('check');
    expect(state.getRecentUpdateStatusIcon('pending')).toBe('pending');
    expect(state.getRecentUpdateStatusIcon('snoozed')).toBe('pending');
    expect(state.getRecentUpdateStatusIcon('maturity-blocked')).toBe('clock');
    expect(state.getRecentUpdateStatusIcon('skipped')).toBe('skip-forward');
    expect(state.getRecentUpdateStatusIcon('failed')).toBe('xmark');
    expect(state.getRecentUpdateStatusIcon('error')).toBe('xmark');

    expect(state.getUpdateKindColor('major')).toBe('var(--dd-danger)');
    expect(state.getUpdateKindColor('minor')).toBe('var(--dd-warning)');
    expect(state.getUpdateKindColor('patch')).toBe('var(--dd-primary)');
    expect(state.getUpdateKindColor('digest')).toBe('var(--dd-neutral)');
    expect(state.getUpdateKindColor(null)).toBe('var(--dd-text-muted)');

    expect(state.getUpdateKindMutedColor('major')).toBe('var(--dd-danger-muted)');
    expect(state.getUpdateKindMutedColor('minor')).toBe('var(--dd-warning-muted)');
    expect(state.getUpdateKindMutedColor('patch')).toBe('var(--dd-primary-muted)');
    expect(state.getUpdateKindMutedColor('digest')).toBe('var(--dd-neutral-muted)');
    expect(state.getUpdateKindMutedColor(null)).toBe('var(--dd-bg-elevated)');

    expect(state.getUpdateKindIcon('major')).toBe('chevrons-up');
    expect(state.getUpdateKindIcon('minor')).toBe('chevron-up');
    expect(state.getUpdateKindIcon('patch')).toBe('hashtag');
    expect(state.getUpdateKindIcon('digest')).toBe('fingerprint');
    expect(state.getUpdateKindIcon(null)).toBe('info');
  });
});

describe('useDashboardComputed maintenance countdown', () => {
  it('includes maintenance watchers from both configuration and config payloads', () => {
    const watchers = [
      { configuration: { maintenanceWindow: 'Sun 02:00-03:00 UTC' } },
      { config: { maintenancewindow: 'Mon 04:00-05:00 UTC' } },
      { configuration: { maintenanceWindow: '   ' } },
      { config: {} },
    ];

    const state = createState({ watchers });

    expect(state.maintenanceWindowWatchers.value).toHaveLength(2);
  });

  it('returns Open now when any maintenance window is currently open', () => {
    const watchers = [
      {
        configuration: {
          maintenanceWindow: 'Sun 02:00-03:00 UTC',
          maintenanceWindowOpen: true,
          maintenanceNextWindow: '2026-03-10T00:00:00.000Z',
        },
      },
    ];
    const state = createState({
      watchers,
      maintenanceCountdownNow: Date.parse('2026-03-01T00:00:00.000Z'),
    });

    expect(state.maintenanceCountdownLabel.value).toBe('Open now');
  });

  it('returns Scheduled when windows exist but no parseable next window is available', () => {
    const watchers = [{ configuration: { maintenanceWindow: 'Sun 02:00-03:00 UTC' } }];
    const state = createState({ watchers });

    expect(state.maintenanceCountdownLabel.value).toBe('Scheduled');
  });

  it('returns Opening soon when the next window timestamp has passed', () => {
    const watchers = [
      {
        configuration: {
          maintenanceWindow: 'Sun 02:00-03:00 UTC',
          maintenanceNextWindow: '2026-03-01T00:00:00.000Z',
        },
      },
    ];
    const state = createState({
      watchers,
      maintenanceCountdownNow: Date.parse('2026-03-01T00:01:00.000Z'),
    });

    expect(state.maintenanceCountdownLabel.value).toBe('Opening soon');
  });

  it('formats countdown labels for upcoming maintenance windows', () => {
    const now = Date.parse('2026-03-01T00:00:00.000Z');
    const ninetyMinutesLater = new Date(now + 90 * 60_000).toISOString();
    const twentySixHoursLater = new Date(now + 26 * 60 * 60_000).toISOString();

    const shortCountdown = createState({
      watchers: [
        {
          config: {
            maintenancewindow: 'Sun 02:00-03:00 UTC',
            maintenancenextwindow: ninetyMinutesLater,
          },
        },
      ],
      maintenanceCountdownNow: now,
    });

    const longCountdown = createState({
      watchers: [
        {
          configuration: {
            maintenanceWindow: 'Sun 02:00-03:00 UTC',
            maintenanceNextWindow: twentySixHoursLater,
          },
        },
      ],
      maintenanceCountdownNow: now,
    });

    expect(shortCountdown.maintenanceCountdownLabel.value).toBe('1h 30m');
    expect(longCountdown.maintenanceCountdownLabel.value).toBe('1d 2h');
  });

  it('formats short maintenance countdowns in minutes', () => {
    const now = Date.parse('2026-03-01T00:00:00.000Z');
    const thirtyMinutesLater = new Date(now + 30 * 60_000).toISOString();
    const state = createState({
      watchers: [
        {
          configuration: {
            maintenanceWindow: 'Sun 02:00-03:00 UTC',
            maintenanceNextWindow: thirtyMinutesLater,
          },
        },
      ],
      maintenanceCountdownNow: now,
    });

    expect(state.maintenanceCountdownLabel.value).toBe('30m');
  });

  it('returns an empty countdown label when no maintenance windows exist', () => {
    const state = createState({ watchers: [{ configuration: {} }] });

    expect(state.maintenanceCountdownLabel.value).toBe('');
  });

  it('ignores invalid maintenance next-window timestamps', () => {
    const now = Date.parse('2026-03-01T00:00:00.000Z');
    const state = createState({
      watchers: [
        {
          configuration: {
            maintenanceWindow: 'Sun 02:00-03:00 UTC',
            maintenanceNextWindow: 'invalid-date',
          },
        },
        {
          configuration: {
            maintenanceWindow: 'Sun 04:00-05:00 UTC',
            maintenanceNextWindow: new Date(now + 45 * 60_000).toISOString(),
          },
        },
      ],
      maintenanceCountdownNow: now,
    });

    expect(state.maintenanceCountdownLabel.value).toBe('45m');
  });

  it('exposes nextMaintenanceWindowByWatcher keyed by watcher name', () => {
    const now = Date.parse('2026-03-01T00:00:00.000Z');
    const thirtyMin = new Date(now + 30 * 60_000).toISOString();
    const sixtyMin = new Date(now + 60 * 60_000).toISOString();
    const watchers = [
      {
        name: 'docker-a',
        configuration: {
          maintenanceWindow: 'Sun 02:00-03:00 UTC',
          maintenanceNextWindow: thirtyMin,
        },
      },
      {
        name: 'docker-b',
        configuration: {
          maintenanceWindow: 'Mon 04:00-05:00 UTC',
          maintenanceNextWindow: sixtyMin,
        },
      },
      {
        name: 'no-window',
        configuration: {},
      },
    ];
    const state = createState({ watchers, maintenanceCountdownNow: now });
    const map = state.nextMaintenanceWindowByWatcher.value;

    expect(map.size).toBe(2);
    expect(map.get('docker-a')).toBe(Date.parse(thirtyMin));
    expect(map.get('docker-b')).toBe(Date.parse(sixtyMin));
    expect(map.has('no-window')).toBe(false);
  });

  it('falls back to local for unnamed watchers in nextMaintenanceWindowByWatcher', () => {
    const now = Date.parse('2026-03-01T00:00:00.000Z');
    const ts = new Date(now + 10 * 60_000).toISOString();
    const watchers = [
      {
        configuration: {
          maintenanceWindow: 'Sun 02:00-03:00 UTC',
          maintenanceNextWindow: ts,
        },
      },
    ];
    const state = createState({ watchers, maintenanceCountdownNow: now });
    const map = state.nextMaintenanceWindowByWatcher.value;

    expect(map.get('local')).toBe(Date.parse(ts));
  });

  it('omits watchers with invalid timestamps from nextMaintenanceWindowByWatcher', () => {
    const watchers = [
      {
        name: 'bad-ts',
        configuration: {
          maintenanceWindow: 'Sun 02:00-03:00 UTC',
          maintenanceNextWindow: 'not-a-date',
        },
      },
    ];
    const state = createState({ watchers });
    const map = state.nextMaintenanceWindowByWatcher.value;

    expect(map.size).toBe(0);
  });

  it('falls back to local key when watcher name is an empty string', () => {
    const now = Date.parse('2026-03-01T00:00:00.000Z');
    const ts = new Date(now + 20 * 60_000).toISOString();
    const watchers = [
      {
        name: '',
        configuration: {
          maintenanceWindow: 'Sun 02:00-03:00 UTC',
          maintenanceNextWindow: ts,
        },
      },
    ];
    const state = createState({ watchers, maintenanceCountdownNow: now });
    const map = state.nextMaintenanceWindowByWatcher.value;

    expect(map.get('local')).toBe(Date.parse(ts));
  });

  it('defaults watcher name to local when a non-object entry leaks into the filtered list', () => {
    const now = Date.parse('2026-03-01T00:00:00.000Z');
    const ts = new Date(now + 25 * 60_000).toISOString();
    const watchers = [
      {
        name: 'docker-a',
        configuration: {
          maintenanceWindow: 'Sun 02:00-03:00 UTC',
          maintenanceNextWindow: ts,
        },
      },
    ];
    const state = createState({ watchers, maintenanceCountdownNow: now });

    // Force the filtered maintenance-window watcher list to be computed and cached.
    const cached = state.maintenanceWindowWatchers.value;

    // Inject a non-object entry into the cached array to exercise the defensive
    // guard in getWatcherName (line 283 else-branch).
    cached.push(null as unknown as never);

    // Access nextMaintenanceWindowByWatcher for the first time so Vue computes
    // it using the (now mutated) cached maintenanceWindowWatchers array.
    const map = state.nextMaintenanceWindowByWatcher.value;

    // The valid watcher should still appear; the null entry is safely ignored
    // because parseMaintenanceWindowAt returns undefined for non-objects.
    expect(map.get('docker-a')).toBe(Date.parse(ts));
    expect(map.has('local')).toBe(false);
  });

  it('falls back to local when getWatcherName receives a non-object watcher with a parseable timestamp', () => {
    const now = Date.parse('2026-03-01T00:00:00.000Z');
    const ts = new Date(now + 40 * 60_000).toISOString();
    const nonObjectWatcher = 42;
    const watchers = [
      {
        name: 'docker-a',
        configuration: {
          maintenanceWindow: 'Sun 02:00-03:00 UTC',
          maintenanceNextWindow: ts,
        },
      },
    ];
    const state = createState({ watchers, maintenanceCountdownNow: now });

    // Cache the maintenanceWindowWatchers computed, then inject a non-object
    // entry that has getWatcherConfiguration mocked to return a valid timestamp.
    const cached = state.maintenanceWindowWatchers.value;
    cached.push(nonObjectWatcher as unknown as never);

    // Make getWatcherConfiguration return a configuration with a parseable
    // timestamp for the non-object entry so getWatcherName is actually reached.
    const mockedGetConfig = vi.mocked(getWatcherConfiguration);
    const originalImpl = mockedGetConfig.getMockImplementation()!;
    mockedGetConfig.mockImplementation((w: unknown) => {
      if (w === nonObjectWatcher) {
        return { maintenanceNextWindow: ts } as ReturnType<typeof getWatcherConfiguration>;
      }
      return originalImpl(w);
    });

    const map = state.nextMaintenanceWindowByWatcher.value;

    expect(map.get('docker-a')).toBe(Date.parse(ts));
    // The non-object watcher falls back to 'local' in getWatcherName.
    expect(map.get('local')).toBe(Date.parse(ts));

    mockedGetConfig.mockImplementation(originalImpl);
  });

  it('picks the earliest next window across multiple watchers for the countdown', () => {
    const now = Date.parse('2026-03-01T00:00:00.000Z');
    const earlyTs = new Date(now + 15 * 60_000).toISOString();
    const lateTs = new Date(now + 90 * 60_000).toISOString();
    const watchers = [
      {
        name: 'watcher-early',
        configuration: {
          maintenanceWindow: 'Sun 02:00-03:00 UTC',
          maintenanceNextWindow: earlyTs,
        },
      },
      {
        name: 'watcher-late',
        configuration: {
          maintenanceWindow: 'Mon 04:00-05:00 UTC',
          maintenanceNextWindow: lateTs,
        },
      },
    ];
    const state = createState({ watchers, maintenanceCountdownNow: now });

    expect(state.maintenanceCountdownLabel.value).toBe('15m');
    expect(state.nextMaintenanceWindowByWatcher.value.size).toBe(2);
  });

  it('skips non-minimum timestamps in the min-reduction loop when finding next window', () => {
    const now = Date.parse('2026-03-01T00:00:00.000Z');
    const earliest = new Date(now + 10 * 60_000).toISOString();
    const middle = new Date(now + 30 * 60_000).toISOString();
    const latest = new Date(now + 60 * 60_000).toISOString();
    const watchers = [
      {
        name: 'watcher-first',
        configuration: {
          maintenanceWindow: 'Sun 02:00-03:00 UTC',
          maintenanceNextWindow: earliest,
        },
      },
      {
        name: 'watcher-second',
        configuration: {
          maintenanceWindow: 'Mon 04:00-05:00 UTC',
          maintenanceNextWindow: middle,
        },
      },
      {
        name: 'watcher-third',
        configuration: {
          maintenanceWindow: 'Tue 06:00-07:00 UTC',
          maintenanceNextWindow: latest,
        },
      },
    ];
    const state = createState({ watchers, maintenanceCountdownNow: now });

    // The earliest timestamp should be selected as the countdown target.
    // The second and third entries exercise the ts < min false branch.
    expect(state.maintenanceCountdownLabel.value).toBe('10m');
    const map = state.nextMaintenanceWindowByWatcher.value;
    expect(map.size).toBe(3);
    expect(map.get('watcher-first')).toBe(Date.parse(earliest));
    expect(map.get('watcher-second')).toBe(Date.parse(middle));
    expect(map.get('watcher-third')).toBe(Date.parse(latest));
  });
});

describe('useDashboardComputed recent updates', () => {
  it('excludes registry errors and sorts pending updates by date with six-row limit', () => {
    const state = createState({
      containers: [
        makeBaseContainer({
          id: 'error-1',
          name: 'registry-error',
          newTag: null,
          registryError: 'registry auth failed',
          status: 'stopped',
        }),
        makeBaseContainer({
          id: 'pending-bravo',
          name: 'bravo',
          newTag: '2.2.0',
          updateKind: 'minor',
          updateDetectedAt: '2026-03-04T09:00:00.000Z',
        }),
        makeBaseContainer({
          id: 'pending-charlie',
          name: 'charlie',
          newTag: '2.1.0',
          updateKind: 'minor',
          updateDetectedAt: '2026-03-03T10:00:00.000Z',
        }),
        makeBaseContainer({
          id: 'pending-alpha',
          name: 'alpha',
          newTag: '2.1.1',
          updateKind: 'minor',
          updateDetectedAt: '2026-03-03T10:00:00.000Z',
          releaseLink: 'https://example.com/releases/alpha',
        }),
        makeBaseContainer({
          id: 'policy-skipped',
          name: 'skip-me',
          newTag: null,
          updatePolicyState: 'skipped',
          suppressedUpdateTag: '9.9.9',
          updateDetectedAt: '2026-03-02T10:00:00.000Z',
        }),
        makeBaseContainer({
          id: 'policy-snoozed',
          name: 'snooze-me',
          newTag: null,
          updatePolicyState: 'snoozed',
          suppressedUpdateTag: '8.8.8',
          updateDetectedAt: '2026-03-01T10:00:00.000Z',
        }),
        makeBaseContainer({
          id: 'pending-no-date',
          name: 'no-date',
          newTag: '2.0.0',
          updateKind: 'patch',
        }),
        makeBaseContainer({
          id: 'ignored',
          name: 'ignore-me',
          newTag: null,
          updateKind: null,
        }),
      ],
      recentStatusByContainer: {
        alpha: 'updated',
        charlie: 'failed',
      },
    });

    const rows = state.recentUpdates.value;
    const rowByName = new Map(rows.map((row) => [row.name, row]));

    // Registry error containers should NOT appear (#186)
    expect(rowByName.has('registry-error')).toBe(false);
    expect(rowByName.has('ignore-me')).toBe(false);

    expect(rows).toHaveLength(6);
    expect(rows.map((row) => row.name)).toEqual([
      'bravo',
      'alpha',
      'charlie',
      'skip-me',
      'snooze-me',
      'no-date',
    ]);
    expect(rowByName.get('bravo')).toMatchObject({ status: 'pending' });
    expect(rowByName.get('alpha')).toMatchObject({
      status: 'updated',
      newVer: '2.1.1',
      releaseLink: 'https://example.com/releases/alpha',
    });
    expect(rowByName.get('charlie')).toMatchObject({ status: 'failed' });
    expect(rowByName.get('skip-me')).toMatchObject({
      status: 'skipped',
      newVer: '9.9.9',
    });
    expect(rowByName.get('snooze-me')).toMatchObject({
      status: 'snoozed',
      newVer: '8.8.8',
    });
  });

  it('prefers identity-keyed recent status when duplicate container names exist', () => {
    const localApi = makeBaseContainer({
      id: 'local-api',
      identityKey: 'edge-a::docker-prod::api',
      name: 'api',
      newTag: '2.0.0',
      updateDetectedAt: '2026-03-04T09:00:00.000Z',
    });
    const remoteApi = makeBaseContainer({
      id: 'remote-api',
      identityKey: 'edge-b::docker-prod::api',
      name: 'api',
      newTag: '2.1.0',
      updateDetectedAt: '2026-03-04T08:00:00.000Z',
    });

    const state = createState({
      containers: [localApi, remoteApi],
      recentStatusByContainer: {
        api: 'failed',
      },
      recentStatusByIdentity: {
        'edge-a::docker-prod::api': 'updated',
        'edge-b::docker-prod::api': 'failed',
      },
    });

    const rows = state.recentUpdates.value;
    expect(rows.find((row) => row.id === 'local-api')).toMatchObject({ status: 'updated' });
    expect(rows.find((row) => row.id === 'remote-api')).toMatchObject({ status: 'failed' });
  });

  it('uses the container-name recent status when a container name is unique', () => {
    const state = createState({
      containers: [
        makeBaseContainer({
          id: 'solo-api',
          identityKey: 'edge-a::docker-prod::api',
          name: 'api',
          newTag: '2.0.0',
          updateDetectedAt: '2026-03-04T09:00:00.000Z',
        }),
      ],
      recentStatusByContainer: {
        api: 'updated',
      },
      recentStatusByIdentity: {},
    });

    expect(state.recentUpdates.value).toEqual([
      expect.objectContaining({
        id: 'solo-api',
        status: 'updated',
      }),
    ]);
  });

  it('falls back to pending when duplicate container names have no identity-keyed status', () => {
    const nodeA = makeBaseContainer({
      id: 'node-a',
      identityKey: 'edge-a::docker-prod::tdarr_node',
      name: 'tdarr_node',
      newTag: '2.0.0',
      updateDetectedAt: '2026-03-04T09:00:00.000Z',
    });
    const nodeB = makeBaseContainer({
      id: 'node-b',
      identityKey: 'edge-b::docker-prod::tdarr_node',
      name: 'tdarr_node',
      newTag: '2.0.0',
      updateDetectedAt: '2026-03-04T08:00:00.000Z',
    });

    const state = createState({
      containers: [nodeA, nodeB],
      recentStatusByContainer: {
        tdarr_node: 'updated',
      },
      recentStatusByIdentity: {},
    });

    const rows = state.recentUpdates.value;
    expect(rows.find((row) => row.id === 'node-a')).toMatchObject({ status: 'pending' });
    expect(rows.find((row) => row.id === 'node-b')).toMatchObject({ status: 'pending' });
  });

  it('falls back to pending when the precomputed name counts miss the rendered name', () => {
    const unstableNameContainer = makeBaseContainer({
      id: 'flaky-name',
      identityKey: 'edge-a::docker-prod::flaky-name',
      name: 'flaky-counted',
      newTag: '2.0.0',
      updateDetectedAt: '2026-03-04T09:00:00.000Z',
    });
    let nameReads = 0;
    Object.defineProperty(unstableNameContainer, 'name', {
      configurable: true,
      enumerable: true,
      get() {
        nameReads += 1;
        return nameReads === 1 ? 'flaky-counted' : 'flaky-rendered';
      },
    });

    const state = createState({
      containers: [unstableNameContainer],
      recentStatusByContainer: {
        'flaky-counted': 'updated',
        'flaky-rendered': 'failed',
      },
      recentStatusByIdentity: {},
    });

    expect(state.recentUpdates.value).toEqual([
      expect.objectContaining({
        id: 'flaky-name',
        status: 'pending',
      }),
    ]);
  });

  it('returns empty list when only registry failures exist', () => {
    const containers = Array.from({ length: 8 }, (_, index) =>
      makeBaseContainer({
        id: `registry-failure-${index}`,
        name: `registry-failure-${index}`,
        newTag: null,
        registryError: `error-${index}`,
        updateKind: null,
      }),
    );
    const state = createState({ containers });
    const rows = state.recentUpdates.value;

    // Registry failures should not appear in Updates Available (#186)
    expect(rows).toHaveLength(0);
  });

  it('returns all pending updates sorted by detection date', () => {
    const containers = Array.from({ length: 300 }, (_, index) => {
      const day = String((index % 28) + 1).padStart(2, '0');
      const hour = String(index % 24).padStart(2, '0');
      return {
        ...makeBaseContainer({
          id: `u-${index}`,
          name: `update-${String(index).padStart(3, '0')}`,
          newTag: `2.${index}.0`,
        }),
        updateDetectedAt: `2026-03-${day}T${hour}:00:00.000Z`,
      };
    });

    const state = createState({ containers });

    const rows = state.recentUpdates.value;

    expect(rows).toHaveLength(300);
    expect(rows.slice(0, 6).map((row) => row.name)).toEqual([
      'update-167',
      'update-139',
      'update-111',
      'update-279',
      'update-083',
      'update-251',
    ]);
  });

  it('hides pinned containers from dashboard update widgets when hidePinned is enabled', () => {
    const state = createState({
      hidePinned: true,
      containers: [
        makeBaseContainer({
          id: 'floating-major',
          name: 'floating-major',
          newTag: '2.0.0',
          updateKind: 'major',
          tagPrecision: 'floating',
          tagPinned: false,
          updateDetectedAt: '2026-03-04T10:00:00.000Z',
        }),
        makeBaseContainer({
          id: 'pinned-minor',
          name: 'pinned-minor',
          newTag: '1.2.4',
          updateKind: 'minor',
          currentTag: '16-alpine',
          tagPrecision: 'floating',
          tagPinned: true,
          updateDetectedAt: '2026-03-03T10:00:00.000Z',
        }),
      ],
    });

    expect(state.recentUpdates.value.map((row) => row.name)).toEqual(['floating-major']);
    expect(state.totalUpdates.value).toBe(1);
    expect(state.updateBreakdownBuckets.value.map(({ kind, count }) => ({ kind, count }))).toEqual([
      { kind: 'major', count: 1 },
      { kind: 'minor', count: 0 },
      { kind: 'patch', count: 0 },
      { kind: 'digest', count: 0 },
    ]);
    expect(state.stats.value.find((card) => card.id === 'stat-updates')).toMatchObject({
      value: '1',
    });
  });

  it('keeps later visible standalone queued rows queued when a hidden pinned predecessor is first', () => {
    const hiddenPinnedHead = makeBaseContainer({
      id: 'pinned-head',
      identityKey: '::local::pinned-head',
      name: 'pinned-head',
      tagPinned: true,
      updateOperation: {
        id: 'op-pinned-head',
        status: 'queued',
        phase: 'queued',
        updatedAt: '2026-04-04T10:00:00.000Z',
        fromVersion: '1.0.0',
        toVersion: '1.1.0',
      },
    });
    const visibleQueued = makeBaseContainer({
      id: 'visible-tail',
      identityKey: '::local::visible-tail',
      name: 'visible-tail',
      updateOperation: {
        id: 'op-visible-tail',
        status: 'queued',
        phase: 'queued',
        updatedAt: '2026-04-04T10:00:01.000Z',
        fromVersion: '2.0.0',
        toVersion: '2.1.0',
      },
    });

    const state = createState({
      hidePinned: true,
      containers: [hiddenPinnedHead, visibleQueued],
    });

    expect(state.recentUpdates.value).toEqual([
      expect.objectContaining({
        id: 'visible-tail',
        status: 'queued',
      }),
    ]);
  });

  it('falls back to suppressed update defaults when tags or timestamps are invalid', () => {
    const state = createState({
      containers: [
        makeBaseContainer({
          id: 'suppressed-empty',
          name: 'suppressed-empty',
          newTag: null,
          suppressedUpdateTag: undefined,
          updatePolicyState: 'skipped',
          updateDetectedAt: 'invalid-date',
        }),
      ],
    });

    expect(state.recentUpdates.value).toEqual([
      expect.objectContaining({
        name: 'suppressed-empty',
        newVer: '',
        status: 'skipped',
      }),
    ]);
  });

  it('treats a standalone queued update operation as updating when no other active update exists', () => {
    const state = createState({
      containers: [
        makeBaseContainer({
          id: 'queued-standalone',
          name: 'queued-standalone',
          newTag: null,
          updateOperation: {
            id: 'op-queued-standalone',
            status: 'queued',
            phase: 'queued',
            updatedAt: '2026-04-04T10:00:00.000Z',
            fromVersion: '1.0.0',
            toVersion: '1.1.0',
          },
        }),
      ],
    });

    expect(state.recentUpdates.value).toEqual([
      expect.objectContaining({
        name: 'queued-standalone',
        status: 'updating',
      }),
    ]);
  });

  it('keeps a standalone queued update operation queued when another container is already updating', () => {
    const state = createState({
      containers: [
        makeBaseContainer({
          id: 'updating-head',
          name: 'updating-head',
          newTag: null,
          updateOperation: {
            id: 'op-updating-head',
            status: 'in-progress',
            phase: 'pulling',
            updatedAt: '2026-04-04T10:00:00.000Z',
            fromVersion: '1.0.0',
            toVersion: '1.1.0',
          },
        }),
        makeBaseContainer({
          id: 'queued-tail',
          name: 'queued-tail',
          newTag: null,
          updateOperation: {
            id: 'op-queued-tail',
            status: 'queued',
            phase: 'queued',
            updatedAt: '2026-04-04T10:00:01.000Z',
            fromVersion: '2.0.0',
            toVersion: '2.1.0',
          },
        }),
      ],
    });

    expect(state.recentUpdates.value).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'updating-head',
          status: 'updating',
        }),
        expect.objectContaining({
          name: 'queued-tail',
          status: 'queued',
        }),
      ]),
    );
  });

  it('maps mature-only suppressed updates to maturity-blocked status', () => {
    const state = createState({
      containers: [
        makeBaseContainer({
          id: 'suppressed-maturity',
          name: 'suppressed-maturity',
          newTag: null,
          suppressedUpdateTag: '4.0.0',
          updatePolicyState: 'maturity-blocked',
          updateDetectedAt: '2026-03-04T10:00:00.000Z',
        }),
      ],
    });

    expect(state.recentUpdates.value).toEqual([
      expect.objectContaining({
        name: 'suppressed-maturity',
        newVer: '4.0.0',
        status: 'maturity-blocked',
      }),
    ]);
  });

  it('returns zero arc lengths when there are no security entries', () => {
    const state = createState({ containers: [] });

    expect(state.securityIssueArcLength.value).toBe(0);
    expect(state.securityNotScannedArcLength.value).toBe(0);
  });
});

describe('useDashboardComputed vulnerabilities', () => {
  it('sorts by total vulnerability count descending and limits to five', () => {
    const containers: Container[] = [
      makeBaseContainer({
        id: 'low-vulns',
        name: 'low-vulns',
        bouncer: 'unsafe',
        securitySummary: { critical: 0, high: 1, medium: 0, low: 0, unknown: 0 },
      }),
      makeBaseContainer({
        id: 'high-vulns',
        name: 'high-vulns',
        bouncer: 'blocked',
        securitySummary: { critical: 10, high: 20, medium: 5, low: 2, unknown: 0 },
      }),
      makeBaseContainer({
        id: 'mid-vulns',
        name: 'mid-vulns',
        bouncer: 'unsafe',
        securitySummary: { critical: 0, high: 3, medium: 2, low: 1, unknown: 0 },
      }),
    ];
    const state = createState({ containers });

    expect(state.vulnerabilities.value.map((v) => v.id)).toEqual([
      'high-vulns',
      'mid-vulns',
      'low-vulns',
    ]);
  });

  it('breaks ties by critical count descending', () => {
    const containers: Container[] = [
      makeBaseContainer({
        id: 'fewer-critical',
        name: 'fewer-critical',
        bouncer: 'blocked',
        securitySummary: { critical: 1, high: 4, medium: 0, low: 0, unknown: 0 },
      }),
      makeBaseContainer({
        id: 'more-critical',
        name: 'more-critical',
        bouncer: 'blocked',
        securitySummary: { critical: 3, high: 2, medium: 0, low: 0, unknown: 0 },
      }),
    ];
    const state = createState({ containers });

    expect(state.vulnerabilities.value.map((v) => v.id)).toEqual([
      'more-critical',
      'fewer-critical',
    ]);
  });

  it('excludes safe containers and limits to five entries', () => {
    const containers: Container[] = Array.from({ length: 7 }, (_, index) =>
      makeBaseContainer({
        id: `vuln-${index}`,
        name: `vuln-${index}`,
        bouncer: index % 2 === 0 ? 'blocked' : 'unsafe',
        securitySummary: { critical: 7 - index, high: 0, medium: 0, low: 0, unknown: 0 },
      }),
    );
    containers.push(makeBaseContainer({ id: 'safe-one', name: 'safe-one', bouncer: 'safe' }));
    const state = createState({ containers });

    expect(state.vulnerabilities.value).toHaveLength(5);
    expect(state.vulnerabilities.value.every((v) => v.id !== 'safe-one')).toBe(true);
  });

  it('handles containers without securitySummary', () => {
    const containers: Container[] = [
      makeBaseContainer({
        id: 'with-summary',
        name: 'with-summary',
        bouncer: 'blocked',
        securitySummary: { critical: 5, high: 0, medium: 0, low: 0, unknown: 0 },
      }),
      makeBaseContainer({
        id: 'no-summary',
        name: 'no-summary',
        bouncer: 'unsafe',
      }),
    ];
    const state = createState({ containers });

    expect(state.vulnerabilities.value.map((v) => v.id)).toEqual(['with-summary', 'no-summary']);
  });
});
