import { defineComponent } from 'vue';
import { refreshAllContainers } from '@/services/container';

export default defineComponent({
  props: {
    registries: {
      type: Array,
      required: true,
    },
    registrySelectedInit: {
      type: String,
      required: true,
    },
    agents: {
      type: Array,
      required: true,
    },
    agentSelectedInit: {
      type: String,
      required: true,
    },
    watchers: {
      type: Array,
      required: true,
    },
    watcherSelectedInit: {
      type: String,
      required: true,
    },
    updateKinds: {
      type: Array,
      required: true,
    },
    updateKindSelectedInit: {
      type: String,
      required: true,
    },
    updateAvailable: {
      type: Boolean,
      required: true,
    },
    oldestFirst: {
      type: Boolean,
      required: true,
    },
    groupLabels: {
      type: Array,
      required: true,
    },
    groupByLabel: {
      type: String,
      required: false,
    },
  },

  data() {
    return {
      isRefreshing: false,
      showFilters: false,
      registrySelected: '',
      agentSelected: '',
      watcherSelected: '',
      updateKindSelected: '',
      updateAvailableLocal: this.updateAvailable,
      oldestFirstLocal: this.oldestFirst,
      groupByLabelLocal: this.groupByLabel,
    };
  },

  computed: {
    groupLabelItems(): Array<{ title: string; value: string } | string> {
      return [
        { title: 'Smart group', value: '__smart__' },
        ...(this.groupLabels as string[]),
      ];
    },
    activeFilterCount(): number {
      let count = 0;
      if (this.agentSelected) count++;
      if (this.watcherSelected) count++;
      if (this.registrySelected) count++;
      if (this.updateKindSelected) count++;
      if (this.groupByLabelLocal) count++;
      return count;
    },
    activeFilters(): Array<{ label: string; value: string; clear: () => void }> {
      const filters: Array<{ label: string; value: string; clear: () => void }> = [];
      if (this.agentSelected) {
        filters.push({
          label: 'Agent',
          value: this.agentSelected,
          clear: () => {
            this.agentSelected = '';
            this.emitAgentChanged();
          },
        });
      }
      if (this.watcherSelected) {
        filters.push({
          label: 'Watcher',
          value: this.watcherSelected,
          clear: () => {
            this.watcherSelected = '';
            this.emitWatcherChanged();
          },
        });
      }
      if (this.registrySelected) {
        filters.push({
          label: 'Registry',
          value: this.registrySelected,
          clear: () => {
            this.registrySelected = '';
            this.emitRegistryChanged();
          },
        });
      }
      if (this.updateKindSelected) {
        filters.push({
          label: 'Kind',
          value: this.updateKindSelected,
          clear: () => {
            this.updateKindSelected = '';
            this.emitUpdateKindChanged();
          },
        });
      }
      if (this.groupByLabelLocal) {
        filters.push({
          label: 'Group',
          value: this.groupByLabelLocal,
          clear: () => {
            this.groupByLabelLocal = '';
            this.emitGroupByLabelChanged('');
          },
        });
      }
      return filters;
    },
  },

  methods: {
    emitRegistryChanged() {
      this.$emit('registry-changed', this.registrySelected ?? '');
    },
    emitWatcherChanged() {
      this.$emit('watcher-changed', this.watcherSelected ?? '');
    },
    emitAgentChanged() {
      this.$emit('agent-changed', this.agentSelected ?? '');
    },
    emitUpdateKindChanged() {
      this.$emit('update-kind-changed', this.updateKindSelected ?? '');
    },
    emitUpdateAvailableChanged() {
      this.$emit('update-available-changed');
    },
    emitOldestFirstChanged() {
      this.$emit('oldest-first-changed');
    },
    emitGroupByLabelChanged(newLabel: string) {
      this.$emit('group-by-label-changed', newLabel ?? '');
    },
    async refreshAllContainers() {
      this.isRefreshing = true;
      try {
        const body = await refreshAllContainers();
        (this as any).$eventBus.emit('notify', 'All containers refreshed');
        this.$emit('refresh-all-containers', body);
      } catch (e: any) {
        (this as any).$eventBus.emit(
          'notify',
          `Error when trying to refresh all containers (${e.message})`,
          'error',
        );
      } finally {
        this.isRefreshing = false;
      }
    },
  },

  async beforeUpdate() {
    this.registrySelected = this.registrySelectedInit;
    this.agentSelected = this.agentSelectedInit;
    this.watcherSelected = this.watcherSelectedInit;
    this.updateKindSelected = this.updateKindSelectedInit;
    this.updateAvailableLocal = this.updateAvailable;
    this.oldestFirstLocal = this.oldestFirst;
    this.groupByLabelLocal = this.groupByLabel;
  },
});
