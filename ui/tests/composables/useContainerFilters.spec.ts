import { nextTick, ref } from 'vue';
import type { Container } from '@/types/container';
import { setTestPreferences } from '../helpers/preferences';

function makeContainer(overrides: Partial<Container> = {}): Container {
  return {
    id: 'c1',
    name: 'nginx',
    image: 'nginx:latest',
    icon: '',
    currentTag: 'latest',
    newTag: null,
    status: 'running',
    registry: 'dockerhub',
    updateKind: null,
    updateMaturity: null,
    bouncer: 'safe',
    server: 'local',
    details: { ports: [], volumes: [], env: [], labels: [] },
    ...overrides,
  };
}

describe('useContainerFilters', () => {
  const containers = ref<Container[]>([
    makeContainer({
      id: 'c1',
      name: 'nginx',
      image: 'nginx:latest',
      status: 'running',
      registry: 'dockerhub',
      bouncer: 'safe',
      server: 'local',
      updateKind: 'minor',
      newTag: '1.26',
    }),
    makeContainer({
      id: 'c2',
      name: 'postgres',
      image: 'postgres:16',
      status: 'stopped',
      registry: 'ghcr',
      bouncer: 'unsafe',
      server: 'remote',
      updateKind: 'major',
      newTag: '17.0',
    }),
    makeContainer({
      id: 'c3',
      name: 'redis',
      image: 'redis:7',
      status: 'running',
      registry: 'custom',
      bouncer: 'blocked',
      server: 'local',
      updateKind: null,
      newTag: null,
    }),
  ]);

  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  async function loadFilters() {
    const mod = await import('@/composables/useContainerFilters');
    return mod.useContainerFilters(containers);
  }

  describe('initial state', () => {
    it('should return all containers with no filters', async () => {
      const filters = await loadFilters();
      expect(filters.filteredContainers.value).toHaveLength(3);
    });

    it('should have zero active filters', async () => {
      const filters = await loadFilters();
      expect(filters.activeFilterCount.value).toBe(0);
    });

    it('should default showFilters to false', async () => {
      const filters = await loadFilters();
      expect(filters.showFilters.value).toBe(false);
    });
  });

  describe('search', () => {
    it('should filter by container name (case-insensitive)', async () => {
      const filters = await loadFilters();
      filters.filterSearch.value = 'NGINX';
      expect(filters.filteredContainers.value).toHaveLength(1);
      expect(filters.filteredContainers.value[0].name).toBe('nginx');
    });

    it('should filter by image name', async () => {
      const filters = await loadFilters();
      filters.filterSearch.value = 'postgres:16';
      expect(filters.filteredContainers.value).toHaveLength(1);
      expect(filters.filteredContainers.value[0].id).toBe('c2');
    });

    it('should return empty when no match', async () => {
      const filters = await loadFilters();
      filters.filterSearch.value = 'nonexistent';
      expect(filters.filteredContainers.value).toHaveLength(0);
    });
  });

  describe('filter by status', () => {
    it('should filter running containers', async () => {
      const filters = await loadFilters();
      filters.filterStatus.value = 'running';
      expect(filters.filteredContainers.value).toHaveLength(2);
    });

    it('should filter stopped containers', async () => {
      const filters = await loadFilters();
      filters.filterStatus.value = 'stopped';
      expect(filters.filteredContainers.value).toHaveLength(1);
      expect(filters.filteredContainers.value[0].name).toBe('postgres');
    });
  });

  describe('filter by registry', () => {
    it('should filter by dockerhub', async () => {
      const filters = await loadFilters();
      filters.filterRegistry.value = 'dockerhub';
      expect(filters.filteredContainers.value).toHaveLength(1);
      expect(filters.filteredContainers.value[0].name).toBe('nginx');
    });

    it('should filter by ghcr', async () => {
      const filters = await loadFilters();
      filters.filterRegistry.value = 'ghcr';
      expect(filters.filteredContainers.value).toHaveLength(1);
      expect(filters.filteredContainers.value[0].name).toBe('postgres');
    });
  });

  describe('filter by bouncer', () => {
    it('should filter by safe', async () => {
      const filters = await loadFilters();
      filters.filterBouncer.value = 'safe';
      expect(filters.filteredContainers.value).toHaveLength(1);
      expect(filters.filteredContainers.value[0].name).toBe('nginx');
    });

    it('should filter by blocked', async () => {
      const filters = await loadFilters();
      filters.filterBouncer.value = 'blocked';
      expect(filters.filteredContainers.value).toHaveLength(1);
      expect(filters.filteredContainers.value[0].name).toBe('redis');
    });
  });

  describe('filter by server', () => {
    it('should filter by local', async () => {
      const filters = await loadFilters();
      filters.filterServer.value = 'local';
      expect(filters.filteredContainers.value).toHaveLength(2);
    });

    it('should filter by remote', async () => {
      const filters = await loadFilters();
      filters.filterServer.value = 'remote';
      expect(filters.filteredContainers.value).toHaveLength(1);
      expect(filters.filteredContainers.value[0].name).toBe('postgres');
    });
  });

  describe('filter by kind', () => {
    it('should filter by specific updateKind', async () => {
      const filters = await loadFilters();
      filters.filterKind.value = 'minor';
      expect(filters.filteredContainers.value).toHaveLength(1);
      expect(filters.filteredContainers.value[0].name).toBe('nginx');
    });

    it('should filter by major', async () => {
      const filters = await loadFilters();
      filters.filterKind.value = 'major';
      expect(filters.filteredContainers.value).toHaveLength(1);
      expect(filters.filteredContainers.value[0].name).toBe('postgres');
    });

    it('should filter "any" to containers with a newTag', async () => {
      const filters = await loadFilters();
      filters.filterKind.value = 'any';
      expect(filters.filteredContainers.value).toHaveLength(2);
      expect(filters.filteredContainers.value.map((c) => c.name).sort()).toEqual([
        'nginx',
        'postgres',
      ]);
    });
  });

  describe('activeFilterCount', () => {
    it('should count each non-default filter', async () => {
      const filters = await loadFilters();
      filters.filterStatus.value = 'running';
      expect(filters.activeFilterCount.value).toBe(1);
      filters.filterRegistry.value = 'ghcr';
      expect(filters.activeFilterCount.value).toBe(2);
      filters.filterBouncer.value = 'safe';
      filters.filterServer.value = 'local';
      filters.filterKind.value = 'major';
      expect(filters.activeFilterCount.value).toBe(5);
    });

    it('should not count search in activeFilterCount', async () => {
      const filters = await loadFilters();
      filters.filterSearch.value = 'nginx';
      expect(filters.activeFilterCount.value).toBe(0);
    });
  });

  describe('clearFilters', () => {
    it('should reset all filters to defaults', async () => {
      const filters = await loadFilters();
      filters.filterSearch.value = 'test';
      filters.filterStatus.value = 'running';
      filters.filterRegistry.value = 'ghcr';
      filters.filterBouncer.value = 'safe';
      filters.filterServer.value = 'remote';
      filters.filterKind.value = 'major';

      filters.clearFilters();

      expect(filters.filterSearch.value).toBe('');
      expect(filters.filterStatus.value).toBe('all');
      expect(filters.filterRegistry.value).toBe('all');
      expect(filters.filterBouncer.value).toBe('all');
      expect(filters.filterServer.value).toBe('all');
      expect(filters.filterKind.value).toBe('all');
      expect(filters.filteredContainers.value).toHaveLength(3);
    });
  });

  describe('combined filters', () => {
    it('should apply search and status together', async () => {
      const filters = await loadFilters();
      filters.filterSearch.value = 'nginx';
      filters.filterStatus.value = 'stopped';
      expect(filters.filteredContainers.value).toHaveLength(0);
    });

    it('should apply multiple dropdown filters', async () => {
      const filters = await loadFilters();
      filters.filterStatus.value = 'running';
      filters.filterServer.value = 'local';
      expect(filters.filteredContainers.value).toHaveLength(2);
    });
  });

  describe('preferences persistence', () => {
    it('should persist filter selections to preferences', async () => {
      const filters = await loadFilters();
      const { flushPreferences } = await import('@/preferences/store');
      filters.filterStatus.value = 'running';
      filters.filterRegistry.value = 'ghcr';
      await nextTick();
      flushPreferences();
      const raw = JSON.parse(localStorage.getItem('dd-preferences') ?? '{}');
      expect(raw.containers.filters.status).toBe('running');
      expect(raw.containers.filters.registry).toBe('ghcr');
      expect(raw.containers.filters.bouncer).toBe('all');
    });

    it('should restore filter selections from preferences', async () => {
      setTestPreferences({
        containers: {
          filters: {
            status: 'stopped',
            registry: 'ghcr',
            bouncer: 'all',
            server: 'remote',
            kind: 'major',
          },
        },
      });
      const filters = await loadFilters();
      expect(filters.filterStatus.value).toBe('stopped');
      expect(filters.filterRegistry.value).toBe('ghcr');
      expect(filters.filterServer.value).toBe('remote');
      expect(filters.filterKind.value).toBe('major');
    });

    it('should not persist search text', async () => {
      const filters = await loadFilters();
      const { flushPreferences } = await import('@/preferences/store');
      filters.filterSearch.value = 'nginx';
      await nextTick();
      flushPreferences();
      const raw = JSON.parse(localStorage.getItem('dd-preferences') ?? '{}');
      expect(raw.containers.filters.search).toBeUndefined();
    });

    it('should handle corrupt localStorage gracefully', async () => {
      localStorage.setItem('dd-preferences', 'bad-json');
      const filters = await loadFilters();
      expect(filters.filterStatus.value).toBe('all');
      expect(filters.filterRegistry.value).toBe('all');
    });

    it('should clear persisted filters when clearFilters is called', async () => {
      const filters = await loadFilters();
      const { flushPreferences } = await import('@/preferences/store');
      filters.filterStatus.value = 'running';
      filters.filterRegistry.value = 'ghcr';
      await nextTick();
      filters.clearFilters();
      await nextTick();
      flushPreferences();
      const raw = JSON.parse(localStorage.getItem('dd-preferences') ?? '{}');
      expect(raw.containers.filters.status).toBe('all');
      expect(raw.containers.filters.registry).toBe('all');
    });
  });

  describe('hidePinned filter', () => {
    it('hides pinned containers even when they use floating version aliases', async () => {
      const mixed = ref<Container[]>([
        makeContainer({ id: 'c1', name: 'floating', currentTag: 'latest', tagPinned: false }),
        makeContainer({
          id: 'c2',
          name: 'pinned',
          currentTag: '16-alpine',
          tagPrecision: 'floating',
          tagPinned: true,
        }),
        makeContainer({ id: 'c3', name: 'unset' }),
      ]);
      const mod = await import('@/composables/useContainerFilters');
      const filters = mod.useContainerFilters(mixed);

      filters.filterHidePinned.value = true;
      await nextTick();

      expect(filters.filteredContainers.value.map((c) => c.name)).toEqual(['floating', 'unset']);
    });

    it('persists hidePinned to preferences', async () => {
      const filters = await loadFilters();
      const { flushPreferences, preferences } = await import('@/preferences/store');

      expect(preferences.containers.filters.hidePinned).toBe(false);

      filters.filterHidePinned.value = true;
      await nextTick();

      expect(preferences.containers.filters.hidePinned).toBe(true);

      flushPreferences();
      const raw = JSON.parse(localStorage.getItem('dd-preferences') ?? '{}');
      expect(raw.containers.filters.hidePinned).toBe(true);
    });

    it('counts hidePinned in active filter count', async () => {
      const filters = await loadFilters();
      expect(filters.activeFilterCount.value).toBe(0);

      filters.filterHidePinned.value = true;
      await nextTick();

      expect(filters.activeFilterCount.value).toBe(1);
    });

    it('resets hidePinned on clearFilters', async () => {
      const filters = await loadFilters();
      filters.filterHidePinned.value = true;
      await nextTick();

      filters.clearFilters();
      await nextTick();

      expect(filters.filterHidePinned.value).toBe(false);
    });
  });
});
