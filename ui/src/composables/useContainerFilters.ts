import { computed, type Ref, ref, watch } from 'vue';
import { preferences } from '../preferences/store';
import type { Container } from '../types/container';
import { matchesHidePinnedFilter } from '../utils/hide-pinned';

const DEFAULT_FILTER_VALUE = 'all';

interface ContainerFilterCriteria {
  search: string;
  status: string;
  registry: string;
  bouncer: string;
  server: string;
  kind: string;
  hidePinned: boolean;
}

type ContainerFilterMatcher = (container: Container, criteria: ContainerFilterCriteria) => boolean;

interface PersistedFilterRefs {
  status: Ref<string>;
  registry: Ref<string>;
  bouncer: Ref<string>;
  server: Ref<string>;
  kind: Ref<string>;
}

interface PersistedFilterValues {
  status: string;
  registry: string;
  bouncer: string;
  server: string;
  kind: string;
}

function getPersistedFilterValues(filters: PersistedFilterRefs): PersistedFilterValues {
  return {
    status: filters.status.value,
    registry: filters.registry.value,
    bouncer: filters.bouncer.value,
    server: filters.server.value,
    kind: filters.kind.value,
  };
}

function persistFilterValues(values: PersistedFilterValues): void {
  preferences.containers.filters.status = values.status;
  preferences.containers.filters.registry = values.registry;
  preferences.containers.filters.bouncer = values.bouncer;
  preferences.containers.filters.server = values.server;
  preferences.containers.filters.kind = values.kind;
}

function clearPersistedFilterRefs(filters: PersistedFilterRefs): void {
  filters.status.value = DEFAULT_FILTER_VALUE;
  filters.registry.value = DEFAULT_FILTER_VALUE;
  filters.bouncer.value = DEFAULT_FILTER_VALUE;
  filters.server.value = DEFAULT_FILTER_VALUE;
  filters.kind.value = DEFAULT_FILTER_VALUE;
}

function matchesSearchFilter(container: Container, search: string): boolean {
  if (!search) {
    return true;
  }
  const query = search.toLowerCase();
  return (
    container.name.toLowerCase().includes(query) || container.image.toLowerCase().includes(query)
  );
}

function matchesExactFilter(selected: string, candidate: string): boolean {
  return selected === DEFAULT_FILTER_VALUE || selected === candidate;
}

function matchesKindFilter(container: Container, selectedKind: string): boolean {
  if (selectedKind === DEFAULT_FILTER_VALUE) {
    return true;
  }
  if (selectedKind === 'any') {
    return Boolean(container.newTag);
  }
  return container.updateKind === selectedKind;
}

const CONTAINER_FILTER_MATCHERS: readonly ContainerFilterMatcher[] = [
  (container, criteria) => matchesSearchFilter(container, criteria.search),
  (container, criteria) => matchesExactFilter(criteria.status, container.status),
  (container, criteria) => matchesExactFilter(criteria.registry, container.registry),
  (container, criteria) => matchesExactFilter(criteria.bouncer, container.bouncer),
  (container, criteria) => matchesExactFilter(criteria.server, container.server),
  (container, criteria) => matchesKindFilter(container, criteria.kind),
  (container, criteria) => matchesHidePinnedFilter(container, criteria.hidePinned),
];

function matchesContainerFilters(container: Container, criteria: ContainerFilterCriteria): boolean {
  return CONTAINER_FILTER_MATCHERS.every((matcher) => matcher(container, criteria));
}

export function useContainerFilters(containers: Ref<Container[]>) {
  const filterSearch = ref('');
  const filterStatus = ref(preferences.containers.filters.status);
  const filterRegistry = ref(preferences.containers.filters.registry);
  const filterBouncer = ref(preferences.containers.filters.bouncer);
  const filterServer = ref(preferences.containers.filters.server);
  const filterKind = ref(preferences.containers.filters.kind);
  const filterHidePinned = ref(preferences.containers.filters.hidePinned);
  const showFilters = ref(false);
  const persistedFilterRefs: PersistedFilterRefs = {
    status: filterStatus,
    registry: filterRegistry,
    bouncer: filterBouncer,
    server: filterServer,
    kind: filterKind,
  };

  watch([filterStatus, filterRegistry, filterBouncer, filterServer, filterKind], () => {
    persistFilterValues(getPersistedFilterValues(persistedFilterRefs));
  });

  watch(filterHidePinned, (value) => {
    preferences.containers.filters.hidePinned = value;
  });

  const activeFilterCount = computed(() => {
    const dropdownCount = [
      filterStatus,
      filterBouncer,
      filterRegistry,
      filterServer,
      filterKind,
    ].filter((f) => f.value !== DEFAULT_FILTER_VALUE).length;
    return dropdownCount + (filterHidePinned.value ? 1 : 0);
  });

  const filteredContainers = computed(() => {
    const criteria: ContainerFilterCriteria = {
      search: filterSearch.value,
      status: filterStatus.value,
      registry: filterRegistry.value,
      bouncer: filterBouncer.value,
      server: filterServer.value,
      kind: filterKind.value,
      hidePinned: filterHidePinned.value,
    };
    return containers.value.filter((container) => matchesContainerFilters(container, criteria));
  });

  function clearFilters() {
    filterSearch.value = '';
    filterHidePinned.value = false;
    clearPersistedFilterRefs(persistedFilterRefs);
  }

  return {
    filterSearch,
    filterStatus,
    filterRegistry,
    filterBouncer,
    filterServer,
    filterKind,
    filterHidePinned,
    showFilters,
    activeFilterCount,
    filteredContainers,
    clearFilters,
  };
}
