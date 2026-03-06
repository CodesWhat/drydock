import { ref } from 'vue';
import type { Container } from '@/types/container';
import type {
  DashboardAgent,
  DashboardContainerSummary,
  DashboardServerInfo,
  RecentAuditStatus,
} from '@/views/dashboard/dashboardTypes';
import { useDashboardComputed } from '@/views/dashboard/useDashboardComputed';

function makeContainer(
  id: number,
  server: string,
  status: 'running' | 'stopped',
  counters: { serverReads: number },
): Container {
  const container: Record<string, unknown> = {
    id: `c-${id}`,
    name: `container-${id}`,
    image: `image-${id}`,
    icon: 'docker',
    currentTag: '1.0.0',
    newTag: null,
    updateKind: null,
    bouncer: 'safe',
    registry: 'dockerhub',
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

  return container as Container;
}

function makeBaseContainer(overrides: Partial<Container> = {}): Container {
  return {
    id: 'c-0',
    name: 'container-0',
    image: 'image-0',
    icon: 'docker',
    currentTag: '1.0.0',
    newTag: null,
    updateKind: null,
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
  maintenanceCountdownNow?: number;
  recentStatusByContainer?: Record<string, RecentAuditStatus>;
  registries?: unknown[];
  serverInfo?: DashboardServerInfo | null;
  watchers?: unknown[];
}

function createState(overrides: DashboardComputedOverrides = {}) {
  return useDashboardComputed({
    agents: ref(overrides.agents ?? []),
    containerSummary: ref(overrides.containerSummary ?? null),
    containers: ref(overrides.containers ?? []),
    maintenanceCountdownNow: ref(overrides.maintenanceCountdownNow ?? Date.now()),
    recentStatusByContainer: ref(overrides.recentStatusByContainer ?? {}),
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

  it('returns an empty countdown label when no maintenance windows exist', () => {
    const state = createState({ watchers: [{ configuration: {} }] });

    expect(state.maintenanceCountdownLabel.value).toBe('');
  });
});

describe('useDashboardComputed recent updates', () => {
  it('prioritizes registry errors, sorts pending updates, and enforces the six-row limit', () => {
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

    expect(rows).toHaveLength(6);
    expect(rows.map((row) => row.name)).toEqual([
      'registry-error',
      'bravo',
      'alpha',
      'charlie',
      'skip-me',
      'snooze-me',
    ]);
    expect(rowByName.get('registry-error')).toMatchObject({
      status: 'error',
      newVer: 'check failed',
      registryError: 'registry auth failed',
      running: false,
    });
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
    expect(rowByName.has('no-date')).toBe(false);
    expect(rowByName.has('ignore-me')).toBe(false);
  });

  it('returns only registry failures when they already fill the recent update limit', () => {
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

    expect(rows).toHaveLength(6);
    expect(rows.every((row) => row.status === 'error')).toBe(true);
    expect(rows.map((row) => row.name)).toEqual([
      'registry-failure-0',
      'registry-failure-1',
      'registry-failure-2',
      'registry-failure-3',
      'registry-failure-4',
      'registry-failure-5',
    ]);
  });

  it('selects top rows without repeatedly reading updateDetectedAt during sort', () => {
    const counters = { detectedAtReads: 0 };
    const containers = Array.from({ length: 300 }, (_, index) => {
      const container = makeBaseContainer({
        id: `u-${index}`,
        name: `update-${String(index).padStart(3, '0')}`,
        newTag: `2.${index}.0`,
      }) as Record<string, unknown>;

      Object.defineProperty(container, 'updateDetectedAt', {
        configurable: true,
        enumerable: true,
        get() {
          counters.detectedAtReads += 1;
          const day = String((index % 28) + 1).padStart(2, '0');
          const hour = String(index % 24).padStart(2, '0');
          return `2026-03-${day}T${hour}:00:00.000Z`;
        },
      });

      return container as Container;
    });

    const state = createState({ containers });

    const rows = state.recentUpdates.value;

    expect(rows).toHaveLength(6);
    expect(counters.detectedAtReads).toBeLessThanOrEqual(containers.length * 3);
  });
});
