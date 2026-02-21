import { ref } from 'vue';
import { useContainerFilters } from '@/composables/useContainerFilters';
import type { Container } from '@/types/container';

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

  let filters: ReturnType<typeof useContainerFilters>;

  beforeEach(() => {
    filters = useContainerFilters(containers);
  });

  describe('initial state', () => {
    it('should return all containers with no filters', () => {
      expect(filters.filteredContainers.value).toHaveLength(3);
    });

    it('should have zero active filters', () => {
      expect(filters.activeFilterCount.value).toBe(0);
    });

    it('should default showFilters to false', () => {
      expect(filters.showFilters.value).toBe(false);
    });
  });

  describe('search', () => {
    it('should filter by container name (case-insensitive)', () => {
      filters.filterSearch.value = 'NGINX';
      expect(filters.filteredContainers.value).toHaveLength(1);
      expect(filters.filteredContainers.value[0].name).toBe('nginx');
    });

    it('should filter by image name', () => {
      filters.filterSearch.value = 'postgres:16';
      expect(filters.filteredContainers.value).toHaveLength(1);
      expect(filters.filteredContainers.value[0].id).toBe('c2');
    });

    it('should return empty when no match', () => {
      filters.filterSearch.value = 'nonexistent';
      expect(filters.filteredContainers.value).toHaveLength(0);
    });
  });

  describe('filter by status', () => {
    it('should filter running containers', () => {
      filters.filterStatus.value = 'running';
      expect(filters.filteredContainers.value).toHaveLength(2);
    });

    it('should filter stopped containers', () => {
      filters.filterStatus.value = 'stopped';
      expect(filters.filteredContainers.value).toHaveLength(1);
      expect(filters.filteredContainers.value[0].name).toBe('postgres');
    });
  });

  describe('filter by registry', () => {
    it('should filter by dockerhub', () => {
      filters.filterRegistry.value = 'dockerhub';
      expect(filters.filteredContainers.value).toHaveLength(1);
      expect(filters.filteredContainers.value[0].name).toBe('nginx');
    });

    it('should filter by ghcr', () => {
      filters.filterRegistry.value = 'ghcr';
      expect(filters.filteredContainers.value).toHaveLength(1);
      expect(filters.filteredContainers.value[0].name).toBe('postgres');
    });
  });

  describe('filter by bouncer', () => {
    it('should filter by safe', () => {
      filters.filterBouncer.value = 'safe';
      expect(filters.filteredContainers.value).toHaveLength(1);
      expect(filters.filteredContainers.value[0].name).toBe('nginx');
    });

    it('should filter by blocked', () => {
      filters.filterBouncer.value = 'blocked';
      expect(filters.filteredContainers.value).toHaveLength(1);
      expect(filters.filteredContainers.value[0].name).toBe('redis');
    });
  });

  describe('filter by server', () => {
    it('should filter by local', () => {
      filters.filterServer.value = 'local';
      expect(filters.filteredContainers.value).toHaveLength(2);
    });

    it('should filter by remote', () => {
      filters.filterServer.value = 'remote';
      expect(filters.filteredContainers.value).toHaveLength(1);
      expect(filters.filteredContainers.value[0].name).toBe('postgres');
    });
  });

  describe('filter by kind', () => {
    it('should filter by specific updateKind', () => {
      filters.filterKind.value = 'minor';
      expect(filters.filteredContainers.value).toHaveLength(1);
      expect(filters.filteredContainers.value[0].name).toBe('nginx');
    });

    it('should filter by major', () => {
      filters.filterKind.value = 'major';
      expect(filters.filteredContainers.value).toHaveLength(1);
      expect(filters.filteredContainers.value[0].name).toBe('postgres');
    });

    it('should filter "any" to containers with a newTag', () => {
      filters.filterKind.value = 'any';
      expect(filters.filteredContainers.value).toHaveLength(2);
      expect(filters.filteredContainers.value.map((c) => c.name).sort()).toEqual([
        'nginx',
        'postgres',
      ]);
    });
  });

  describe('activeFilterCount', () => {
    it('should count each non-default filter', () => {
      filters.filterStatus.value = 'running';
      expect(filters.activeFilterCount.value).toBe(1);
      filters.filterRegistry.value = 'ghcr';
      expect(filters.activeFilterCount.value).toBe(2);
      filters.filterBouncer.value = 'safe';
      filters.filterServer.value = 'local';
      filters.filterKind.value = 'major';
      expect(filters.activeFilterCount.value).toBe(5);
    });

    it('should not count search in activeFilterCount', () => {
      filters.filterSearch.value = 'nginx';
      expect(filters.activeFilterCount.value).toBe(0);
    });
  });

  describe('clearFilters', () => {
    it('should reset all filters to defaults', () => {
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
    it('should apply search and status together', () => {
      filters.filterSearch.value = 'nginx';
      filters.filterStatus.value = 'stopped';
      expect(filters.filteredContainers.value).toHaveLength(0);
    });

    it('should apply multiple dropdown filters', () => {
      filters.filterStatus.value = 'running';
      filters.filterServer.value = 'local';
      expect(filters.filteredContainers.value).toHaveLength(2);
    });
  });
});
