<template>
  <v-container fluid class="history-container d-flex flex-column pa-4">
    <!-- Filters -->
    <div class="flex-shrink-0 mb-3">
      <div class="filter-bar">
        <div class="filter-toolbar">
          <div class="d-flex align-center" style="gap: 6px; flex-wrap: wrap">
            <v-btn variant="tonal" size="small" @click="showFilters = !showFilters">
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
              v-if="filterAction"
              size="small"
              variant="tonal"
              color="primary"
              closable
              @click:close="filterAction = null"
            >
              Action: {{ filterAction }}
            </v-chip>
            <v-chip
              v-if="filterContainer"
              size="small"
              variant="tonal"
              color="primary"
              closable
              @click:close="filterContainer = ''"
            >
              Container: {{ filterContainer }}
            </v-chip>
          </div>
        </div>

        <v-expand-transition>
          <div v-show="showFilters" class="filter-panel">
            <v-select
              v-model="filterAction"
              :items="actionOptions"
              label="Filter by action"
              clearable
              density="compact"
              variant="outlined"
              hide-details
            />
            <v-text-field
              v-model="filterContainer"
              label="Filter by container"
              clearable
              density="compact"
              variant="outlined"
              hide-details
            />
          </div>
        </v-expand-transition>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex-grow-1 d-flex align-center justify-center">
      <div class="text-center">
        <v-progress-circular indeterminate color="primary" size="48" />
        <div class="mt-4 text-medium-emphasis">Loading history...</div>
      </div>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="flex-grow-1 d-flex align-center justify-center">
      <div class="text-center">
        <v-icon size="48" color="error">fas fa-triangle-exclamation</v-icon>
        <div class="mt-4 text-error">{{ error }}</div>
        <v-btn variant="outlined" class="mt-4" @click="fetchEntries">Retry</v-btn>
      </div>
    </div>

    <!-- Empty state -->
    <div v-else-if="entries.length === 0" class="flex-grow-1 d-flex align-center justify-center">
      <div class="text-center text-medium-emphasis">
        <v-icon size="48" color="grey">fas fa-clock-rotate-left</v-icon>
        <div class="mt-4">No update history yet</div>
      </div>
    </div>

    <!-- Table + Pagination -->
    <template v-else>
      <v-card rounded="lg" elevation="1" class="flex-grow-1 d-flex flex-column" style="min-height: 300px; overflow: hidden">
        <div class="flex-grow-1" style="overflow-y: auto; overflow-x: auto">
          <table class="audit-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Action</th>
                <th>Container</th>
                <th v-if="mdAndUp">From</th>
                <th v-if="mdAndUp">To</th>
                <th v-if="smAndUp">Status</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="entry in entries" :key="entry.id">
                <td class="text-no-wrap">{{ formatTimestamp(entry.timestamp) }}</td>
                <td>
                  <v-chip :color="actionColor(entry.action)" size="small" label variant="tonal">
                    {{ entry.action }}
                  </v-chip>
                </td>
                <td class="text-truncate" style="max-width: 120px">{{ entry.containerName }}</td>
                <td v-if="mdAndUp">{{ entry.fromVersion || '-' }}</td>
                <td v-if="mdAndUp">{{ entry.toVersion || '-' }}</td>
                <td v-if="smAndUp">
                  <v-chip :color="statusColor(entry.status)" size="small" label variant="tonal">
                    {{ entry.status }}
                  </v-chip>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Pagination fixed at bottom of card -->
        <div v-if="totalPages > 1" class="flex-shrink-0 d-flex justify-center align-center py-2" style="border-top: thin solid rgba(var(--v-border-color), var(--v-border-opacity));">
          <v-pagination
            v-model="currentPage"
            :length="totalPages"
            :total-visible="5"
            density="compact"
          />
        </div>
      </v-card>
    </template>
  </v-container>
</template>

<script lang="ts" src="./MonitoringHistoryView.ts"></script>

<style scoped>
.history-container {
  height: 100%;
  max-height: calc(100vh - 64px);
}

.audit-table {
  width: 100%;
  border-collapse: collapse;
}

.audit-table th,
.audit-table td {
  padding: 10px 16px;
  text-align: left;
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.audit-table th {
  font-weight: 600;
  font-size: 0.875rem;
  color: rgba(var(--v-theme-on-surface), 0.7);
  position: sticky;
  top: 0;
  background: rgb(var(--v-theme-surface));
  z-index: 1;
}

.audit-table tbody tr:hover {
  background-color: rgba(var(--v-theme-on-surface), 0.04);
}

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

@media (max-width: 599px) {
  .audit-table th,
  .audit-table td {
    padding: 8px 8px;
    font-size: 0.8rem;
  }
}
</style>
