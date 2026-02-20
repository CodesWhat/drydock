import { computed, ref } from 'vue';
import type { Container } from '../types/container';

export function useContainerFilters(containers: { value: Container[] }) {
  const filterSearch = ref('');
  const filterStatus = ref('all');
  const filterRegistry = ref('all');
  const filterBouncer = ref('all');
  const filterServer = ref('all');
  const filterKind = ref('all');
  const showFilters = ref(false);

  const activeFilterCount = computed(
    () =>
      [filterStatus, filterBouncer, filterRegistry, filterServer, filterKind].filter(
        (f) => f.value !== 'all',
      ).length,
  );

  const filteredContainers = computed(() => {
    return containers.value.filter((c) => {
      if (filterSearch.value) {
        const q = filterSearch.value.toLowerCase();
        if (!c.name.toLowerCase().includes(q) && !c.image.toLowerCase().includes(q)) return false;
      }
      if (filterStatus.value !== 'all' && c.status !== filterStatus.value) return false;
      if (filterRegistry.value !== 'all' && c.registry !== filterRegistry.value) return false;
      if (filterBouncer.value !== 'all' && c.bouncer !== filterBouncer.value) return false;
      if (filterServer.value !== 'all' && c.server !== filterServer.value) return false;
      if (filterKind.value !== 'all') {
        if (filterKind.value === 'any' && !c.newTag) return false;
        if (filterKind.value !== 'any' && c.updateKind !== filterKind.value) return false;
      }
      return true;
    });
  });

  function clearFilters() {
    filterSearch.value = '';
    filterStatus.value = 'all';
    filterRegistry.value = 'all';
    filterBouncer.value = 'all';
    filterServer.value = 'all';
    filterKind.value = 'all';
  }

  return {
    filterSearch,
    filterStatus,
    filterRegistry,
    filterBouncer,
    filterServer,
    filterKind,
    showFilters,
    activeFilterCount,
    filteredContainers,
    clearFilters,
  };
}
