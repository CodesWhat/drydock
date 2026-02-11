<template>
  <div class="filter-bar">
    <!-- Action row: always visible -->
    <div class="filter-toolbar">
      <div class="d-flex align-center" style="gap: 6px; flex-wrap: wrap">
        <v-btn
          variant="tonal"
          size="small"
          @click="showFilters = !showFilters"
        >
          <v-icon start size="small">fas fa-filter</v-icon>
          Filters
          <v-badge
            v-if="activeFilterCount > 0"
            :content="activeFilterCount"
            color="primary"
            inline
            class="ml-1"
          />
          <v-icon end size="x-small">{{ showFilters ? 'fas fa-chevron-up' : 'fas fa-chevron-down' }}</v-icon>
        </v-btn>

        <!-- Active filter chips -->
        <v-chip
          v-for="filter in activeFilters"
          :key="filter.label"
          size="small"
          variant="tonal"
          color="primary"
          closable
          @click:close="filter.clear()"
        >
          {{ filter.label }}: {{ filter.value }}
        </v-chip>

        <v-divider vertical class="mx-1" style="height: 24px" />

        <v-checkbox
          v-model="updateAvailableLocal"
          @update:modelValue="emitUpdateAvailableChanged()"
          label="Updates available"
          density="compact"
          hide-details
          class="flex-shrink-0"
        />

        <v-divider vertical class="mx-1" style="height: 24px" />

        <v-btn
          variant="text"
          size="small"
          @click="oldestFirstLocal = !oldestFirstLocal; emitOldestFirstChanged()"
        >
          <v-icon start size="small">{{ oldestFirstLocal ? 'fas fa-arrow-up-1-9' : 'fas fa-arrow-down-9-1' }}</v-icon>
          {{ oldestFirstLocal ? 'Oldest first' : 'Newest first' }}
        </v-btn>
      </div>

      <v-btn
        variant="outlined"
        size="small"
        @click.stop="refreshAllContainers"
        :loading="isRefreshing"
      >
        <v-icon start size="small">fas fa-arrows-rotate</v-icon>
        Check updates
      </v-btn>
    </div>

    <!-- Collapsible filter panel -->
    <v-expand-transition>
      <div v-show="showFilters" class="filter-panel">
        <v-select
          v-model="agentSelected"
          :items="agents"
          @update:modelValue="emitAgentChanged"
          label="Agent"
          variant="outlined"
          density="compact"
          hide-details
        />
        <v-select
          v-model="watcherSelected"
          :items="watchers"
          @update:modelValue="emitWatcherChanged"
          label="Watcher"
          variant="outlined"
          density="compact"
          hide-details
        />
        <v-select
          v-model="registrySelected"
          :items="registries"
          @update:modelValue="emitRegistryChanged"
          label="Registry"
          variant="outlined"
          density="compact"
          hide-details
        />
        <v-select
          v-model="updateKindSelected"
          :items="updateKinds"
          @update:modelValue="emitUpdateKindChanged"
          label="Update kind"
          variant="outlined"
          density="compact"
          hide-details
        />
        <v-autocomplete
          v-model="groupByLabelLocal"
          :items="groupLabelItems"
          @update:modelValue="emitGroupByLabelChanged"
          label="Group by label"
          variant="outlined"
          density="compact"
          hide-details
        />
      </div>
    </v-expand-transition>
  </div>
</template>

<script lang="ts" src="./ContainerFilter.ts"></script>

<style scoped>
.filter-bar {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.filter-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}

.filter-panel {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px;
  border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.04);
}

.filter-panel > * {
  flex: 1 1 180px;
  max-width: 240px;
}
</style>
