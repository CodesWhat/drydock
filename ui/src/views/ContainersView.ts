import { defineComponent } from 'vue';
import ContainerFilter from '@/components/ContainerFilter.vue';
import ContainerGroup from '@/components/ContainerGroup.vue';
import ContainerItem from '@/components/ContainerItem.vue';
import agentService from '@/services/agent';
import { deleteContainer, getAllContainers } from '@/services/container';

const stringCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function toComparableString(value: unknown): string {
  if (value == null) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }

  return '';
}

function compareStringLikeValues(a: unknown, b: unknown) {
  return stringCollator.compare(toComparableString(a), toComparableString(b));
}

function getImageTimestamp(item: any) {
  return new Date(item.image.created).getTime();
}

function compareLabelPresence(aLabel: string | undefined, bLabel: string | undefined) {
  if (aLabel && !bLabel) {
    return -1;
  }
  if (!aLabel && bLabel) {
    return 1;
  }
  return 0;
}

function parseQueryParams(query: any) {
  return {
    registrySelected: query.registry,
    agentSelected: query.agent,
    watcherSelected: query.watcher,
    updateKindSelected: query['update-kind'],
    updateAvailableSelected: query['update-available']?.toLowerCase() === 'true',
    oldestFirst: query['oldest-first']?.toLowerCase() === 'true',
    groupByLabel: query['group-by-label'],
  };
}

function applyQueryParamsToVm(vm: any, params: ReturnType<typeof parseQueryParams>) {
  if (params.registrySelected) vm.registrySelected = params.registrySelected;
  if (params.agentSelected) vm.agentSelected = params.agentSelected;
  if (params.watcherSelected) vm.watcherSelected = params.watcherSelected;
  if (params.updateKindSelected) vm.updateKindSelected = params.updateKindSelected;
  if (params.updateAvailableSelected) vm.updateAvailableSelected = params.updateAvailableSelected;
  if (params.oldestFirst) vm.oldestFirst = params.oldestFirst;
  if (params.groupByLabel) vm.groupByLabel = params.groupByLabel;
}

export default defineComponent({
  components: {
    ContainerItem,
    ContainerFilter,
    ContainerGroup,
  },

  data() {
    return {
      containers: [] as any[],
      agentsList: [] as any[],
      registrySelected: '',
      agentSelected: '',
      watcherSelected: '',
      updateKindSelected: '',
      updateAvailableSelected: false,
      groupByLabel: '',
      oldestFirst: false,
    };
  },
  watch: {},
  computed: {
    allContainerLabels() {
      const allLabels = this.containers.flatMap((container) => Object.keys(container.labels ?? {}));
      return [...new Set(allLabels)].sort(compareStringLikeValues);
    },
    registries() {
      return [
        ...new Set(
          this.containers
            .map((container) => container.image.registry.name)
            .sort(compareStringLikeValues),
        ),
      ];
    },
    watchers() {
      return [
        ...new Set(
          this.containers.map((container) => container.watcher).sort(compareStringLikeValues),
        ),
      ];
    },
    agents() {
      return [
        ...new Set(
          this.containers
            .map((container) => container.agent)
            .filter(Boolean)
            .sort(compareStringLikeValues),
        ),
      ];
    },
    updateKinds() {
      return [
        ...new Set(
          this.containers
            .filter((container) => container.updateAvailable)
            .filter((container) => container.updateKind.kind === 'tag')
            .filter((container) => container.updateKind.semverDiff)
            .map((container) => container.updateKind.semverDiff)
            .sort(compareStringLikeValues),
        ),
      ];
    },
    containersFiltered() {
      const byRegistry = (container: any) =>
        this.registrySelected ? this.registrySelected === container.image.registry.name : true;
      const byAgent = (container: any) =>
        this.agentSelected ? this.agentSelected === container.agent : true;
      const byWatcher = (container: any) =>
        this.watcherSelected ? this.watcherSelected === container.watcher : true;
      const byUpdateKind = (container: any) =>
        this.updateKindSelected
          ? this.updateKindSelected === container.updateKind?.semverDiff
          : true;
      const byUpdateAvailable = (container: any) =>
        this.updateAvailableSelected ? container.updateAvailable : true;

      const filtered = this.containers
        .filter(byRegistry)
        .filter(byAgent)
        .filter(byWatcher)
        .filter(byUpdateKind)
        .filter(byUpdateAvailable);

      return filtered.sort(this.sortContainers.bind(this));
    },
    isGrouped(): boolean {
      return Boolean(this.groupByLabel);
    },
    computedGroups(): Array<{ name: string | null; containers: any[] }> {
      const grouped = new Map<string | null, any[]>();

      for (const container of this.containersFiltered) {
        let labelValue: string | null = null;

        if (this.groupByLabel === '__smart__') {
          labelValue =
            container.labels?.['dd.group'] ??
            container.labels?.['wud.group'] ??
            container.labels?.['com.docker.compose.project'] ??
            null;
        } else {
          labelValue = container.labels?.[this.groupByLabel] ?? null;
        }

        if (!grouped.has(labelValue)) {
          grouped.set(labelValue, []);
        }
        grouped.get(labelValue).push(container);
      }

      const entries = [...grouped.entries()];
      entries.sort((a, b) => {
        if (a[0] === null && b[0] === null) return 0;
        if (a[0] === null) return 1;
        if (b[0] === null) return -1;
        return a[0].localeCompare(b[0]);
      });

      return entries.map(([name, containers]) => ({ name, containers }));
    },
  },

  methods: {
    sortContainers(a: any, b: any) {
      if (this.groupByLabel) {
        const aLabel = a.labels?.[this.groupByLabel];
        const bLabel = b.labels?.[this.groupByLabel];
        const labelPresenceComparison = compareLabelPresence(aLabel, bLabel);

        if (labelPresenceComparison !== 0) {
          return labelPresenceComparison;
        }

        if (aLabel && bLabel) {
          if (this.oldestFirst) {
            return getImageTimestamp(a) - getImageTimestamp(b);
          }
          return aLabel.localeCompare(bLabel);
        }
      }

      if (this.oldestFirst) {
        return getImageTimestamp(a) - getImageTimestamp(b);
      }
      return a.displayName.localeCompare(b.displayName);
    },
    onRegistryChanged(registrySelected: string) {
      this.registrySelected = registrySelected;
      this.updateQueryParams();
    },
    onWatcherChanged(watcherSelected: string) {
      this.watcherSelected = watcherSelected;
      this.updateQueryParams();
    },
    onAgentChanged(agentSelected: string) {
      this.agentSelected = agentSelected;
      this.updateQueryParams();
    },
    onUpdateAvailableChanged() {
      this.updateAvailableSelected = !this.updateAvailableSelected;
      this.updateQueryParams();
    },
    onOldestFirstChanged() {
      this.oldestFirst = !this.oldestFirst;
      this.updateQueryParams();
    },
    onGroupByLabelChanged(groupByLabel: string) {
      this.groupByLabel = groupByLabel;
      this.updateQueryParams();
    },
    onUpdateKindChanged(updateKindSelected: string) {
      this.updateKindSelected = updateKindSelected;
      this.updateQueryParams();
    },
    updateQueryParams() {
      const query: any = {};
      if (this.registrySelected) {
        query.registry = this.registrySelected;
      }
      if (this.agentSelected) {
        query.agent = this.agentSelected;
      }
      if (this.watcherSelected) {
        query.watcher = this.watcherSelected;
      }
      if (this.updateKindSelected) {
        query['update-kind'] = this.updateKindSelected;
      }
      if (this.updateAvailableSelected) {
        query['update-available'] = String(this.updateAvailableSelected);
      }
      if (this.oldestFirst) {
        query['oldest-first'] = String(this.oldestFirst);
      }
      if (this.groupByLabel) {
        query['group-by-label'] = this.groupByLabel;
      }
      this.$router.push({ query });
    },
    onRefreshAllContainers(containersRefreshed: any[]) {
      this.containers = containersRefreshed;
    },
    onContainerRefreshed(containerRefreshed: any) {
      this.containers = this.containers.map((container) =>
        container.id === containerRefreshed.id ? containerRefreshed : container,
      );
    },
    removeContainerFromList(container: any) {
      this.containers = this.containers.filter((c) => c.id !== container.id);
    },
    removeContainerFromListById(containerId: string) {
      this.containers = this.containers.filter((c) => c.id !== containerId);
    },
    async deleteContainer(container: any) {
      try {
        await deleteContainer(container.id);
        this.removeContainerFromList(container);
      } catch (e: any) {
        this.$eventBus.emit(
          'notify',
          `Error when trying to delete the container (${e.message})`,
          'error',
        );
      }
    },
  },

  async beforeRouteEnter(to, from, next) {
    const params = parseQueryParams(to.query);

    try {
      const [containers, agents] = await Promise.all([
        getAllContainers(),
        agentService.getAgents(),
      ]);
      next((vm: any) => {
        applyQueryParamsToVm(vm, params);
        vm.containers = containers;
        vm.agentsList = agents;
      });
    } catch (e: any) {
      next((vm: any) => {
        vm.$eventBus.emit(
          'notify',
          `Error when trying to get the containers (${e.message})`,
          'error',
        );
      });
    }
  },
});
