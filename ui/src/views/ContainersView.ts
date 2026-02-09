import ContainerItem from '@/components/ContainerItem.vue';
import ContainerFilter from '@/components/ContainerFilter.vue';
import { deleteContainer, getAllContainers } from '@/services/container';
import agentService from '@/services/agent';
import { defineComponent } from 'vue';

export default defineComponent({
  components: {
    ContainerItem,
    ContainerFilter,
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
      const allLabels = this.containers.reduce((acc, container) => {
        return [...acc, ...Object.keys(container.labels ?? {})];
      }, []);
      return [...new Set(allLabels)].sort();
    },
    registries() {
      return [...new Set(this.containers.map((container) => container.image.registry.name).sort())];
    },
    watchers() {
      return [...new Set(this.containers.map((container) => container.watcher).sort())];
    },
    agents() {
      return [
        ...new Set(
          this.containers
            .map((container) => container.agent)
            .filter((agent) => agent)
            .sort(),
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
            .sort(),
        ),
      ];
    },
    containersFiltered() {
      const filteredContainers = this.containers
        .filter((container) =>
          this.registrySelected ? this.registrySelected === container.image.registry.name : true,
        )
        .filter((container) =>
          this.agentSelected ? this.agentSelected === container.agent : true,
        )
        .filter((container) =>
          this.watcherSelected ? this.watcherSelected === container.watcher : true,
        )
        .filter((container) =>
          this.updateKindSelected
            ? this.updateKindSelected === (container.updateKind && container.updateKind.semverDiff)
            : true,
        )
        .filter((container) => (this.updateAvailableSelected ? container.updateAvailable : true))
        .sort((a, b) => {
          const getImageDate = (item: any) => new Date(item.image.created);

          if (this.groupByLabel) {
            const aLabel = a.labels?.[this.groupByLabel];
            const bLabel = b.labels?.[this.groupByLabel];

            if (aLabel && !bLabel) return -1;
            if (!aLabel && bLabel) return 1;

            if (aLabel && bLabel) {
              if (this.oldestFirst) return (getImageDate(a) as any) - (getImageDate(b) as any);

              return aLabel.localeCompare(bLabel);
            }
          }

          if (this.oldestFirst) return (getImageDate(a) as any) - (getImageDate(b) as any);
          return a.displayName.localeCompare(b.displayName);
        });
      return filteredContainers;
    },
  },

  methods: {
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
        query['registry'] = this.registrySelected;
      }
      if (this.agentSelected) {
        query['agent'] = this.agentSelected;
      }
      if (this.watcherSelected) {
        query['watcher'] = this.watcherSelected;
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
        (this as any).$eventBus.emit(
          'notify',
          `Error when trying to delete the container (${e.message})`,
          'error',
        );
      }
    },
  },

  async beforeRouteEnter(to, from, next) {
    const registrySelected = to.query['registry'];
    const agentSelected = to.query['agent'];
    const watcherSelected = to.query['watcher'];
    const updateKindSelected = to.query['update-kind'];
    const updateAvailable = to.query['update-available'];
    const oldestFirst = to.query['oldest-first'];
    const groupByLabel = to.query['group-by-label'];
    try {
      const [containers, agents] = await Promise.all([
        getAllContainers(),
        agentService.getAgents(),
      ]);
      next((vm: any) => {
        if (registrySelected) {
          vm.registrySelected = registrySelected;
        }
        if (agentSelected) {
          vm.agentSelected = agentSelected;
        }
        if (watcherSelected) {
          vm.watcherSelected = watcherSelected;
        }
        if (updateKindSelected) {
          vm.updateKindSelected = updateKindSelected;
        }
        if (updateAvailable) {
          vm.updateAvailableSelected = (updateAvailable as string).toLowerCase() === 'true';
        }
        if (oldestFirst) {
          vm.oldestFirst = (oldestFirst as string).toLowerCase() === 'true';
        }
        if (groupByLabel) {
          vm.groupByLabel = groupByLabel;
        }
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
