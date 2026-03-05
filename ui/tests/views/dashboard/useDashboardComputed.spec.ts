import { ref } from 'vue';
import type { Container } from '@/types/container';
import type { DashboardAgent } from '@/views/dashboard/dashboardTypes';
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

describe('useDashboardComputed servers', () => {
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

    const state = useDashboardComputed({
      agents: ref(agents),
      containers: ref(containers),
      maintenanceCountdownNow: ref(Date.now()),
      recentStatusByContainer: ref({}),
      registries: ref([]),
      serverInfo: ref(null),
      watchers: ref([]),
    });

    const rows = state.servers.value;
    const totalContainers = rows.reduce((sum, row) => sum + row.containers.total, 0);

    expect(rows.length).toBe(agents.length + 1);
    expect(totalContainers).toBe(containers.length);
    expect(counters.serverReads).toBeLessThanOrEqual(containers.length * 4);
  });
});

describe('useDashboardComputed recent updates', () => {
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

    const state = useDashboardComputed({
      agents: ref([]),
      containers: ref(containers),
      maintenanceCountdownNow: ref(Date.now()),
      recentStatusByContainer: ref({}),
      registries: ref([]),
      serverInfo: ref(null),
      watchers: ref([]),
    });

    const rows = state.recentUpdates.value;

    expect(rows).toHaveLength(6);
    expect(counters.detectedAtReads).toBeLessThanOrEqual(containers.length * 3);
  });
});
