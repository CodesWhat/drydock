<template>
  <v-container fluid class="history-container d-flex flex-column pa-4">
    <!-- Header + Filters -->
    <div class="flex-shrink-0 mb-3">
      <h2 class="text-h5 mb-3">Update History</h2>
      <div class="d-flex flex-wrap" style="gap: 12px">
        <v-select
          v-model="filterAction"
          :items="actionOptions"
          label="Filter by action"
          clearable
          density="compact"
          variant="outlined"
          hide-details
          style="max-width: 220px; min-width: 180px"
        />
        <v-text-field
          v-model="filterContainer"
          label="Filter by container"
          clearable
          density="compact"
          variant="outlined"
          hide-details
          style="max-width: 220px; min-width: 180px"
        />
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
      <v-card variant="outlined" rounded="lg" class="flex-grow-1 d-flex flex-column" style="min-height: 300px; overflow: hidden">
        <div class="flex-grow-1" style="overflow-y: auto; overflow-x: auto">
          <table class="audit-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Action</th>
                <th>Container</th>
                <th v-if="mdAndUp">From</th>
                <th v-if="mdAndUp">To</th>
                <th>Status</th>
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
                <td>{{ entry.containerName }}</td>
                <td v-if="mdAndUp">{{ entry.fromVersion || '-' }}</td>
                <td v-if="mdAndUp">{{ entry.toVersion || '-' }}</td>
                <td>
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
</style>
