<template>
  <v-container class="dashboard-container">
    <!-- Row 1: Stat cards -->
    <v-row class="mb-2">
      <v-col cols="6" md="3">
        <v-card elevation="1" class="stat-card" to="/containers" rounded="lg">
          <div class="d-flex align-center pa-4" style="gap: 14px">
            <div class="stat-icon stat-icon--containers">
              <v-icon size="18" color="white">{{ containerIcon }}</v-icon>
            </div>
            <div class="flex-grow-1 overflow-hidden">
              <div class="text-h5 font-weight-bold stat-number">{{ containersCount }}</div>
              <div class="text-caption text-medium-emphasis stat-label">Containers</div>
            </div>
            <div v-if="containersWithUpdates.length > 0" class="d-flex flex-shrink-0" style="gap: 4px">
              <span v-if="majorUpdates.length > 0" class="stat-badge stat-badge--error">{{ majorUpdates.length }}</span>
              <span v-if="minorUpdates.length > 0" class="stat-badge stat-badge--warning">{{ minorUpdates.length }}</span>
              <span v-if="patchUpdates.length > 0" class="stat-badge stat-badge--success">{{ patchUpdates.length }}</span>
              <span v-if="digestUpdates.length > 0" class="stat-badge stat-badge--info">{{ digestUpdates.length }}</span>
              <span v-if="unknownUpdates.length > 0" class="stat-badge stat-badge--grey">{{ unknownUpdates.length }}</span>
            </div>
            <div v-else class="flex-shrink-0">
              <v-icon size="small" color="success">fas fa-circle-check</v-icon>
            </div>
          </div>
        </v-card>
      </v-col>
      <v-col cols="6" md="3">
        <v-card elevation="1" class="stat-card" to="/configuration/triggers" rounded="lg">
          <div class="d-flex align-center pa-4" style="gap: 14px">
            <div class="stat-icon stat-icon--triggers">
              <v-icon size="18" color="white">{{ triggerIcon }}</v-icon>
            </div>
            <div>
              <div class="text-h5 font-weight-bold stat-number">{{ triggersCount }}</div>
              <div class="text-caption text-medium-emphasis stat-label">Triggers</div>
            </div>
          </div>
        </v-card>
      </v-col>
      <v-col cols="6" md="3">
        <v-card elevation="1" class="stat-card" to="/configuration/watchers" rounded="lg">
          <div class="d-flex align-center pa-4" style="gap: 14px">
            <div class="stat-icon stat-icon--watchers">
              <v-icon size="18" color="white">{{ watcherIcon }}</v-icon>
            </div>
            <div class="flex-grow-1 overflow-hidden">
              <div class="text-h5 font-weight-bold stat-number">{{ watchersCount }}</div>
              <div class="text-caption text-medium-emphasis stat-label">Watchers</div>
            </div>
            <div v-if="maintenanceCountdownLabel" class="flex-shrink-0">
              <v-chip
                size="x-small"
                :color="maintenanceWindowOpenCount > 0 ? 'success' : 'warning'"
                variant="tonal"
                label
              >
                <v-icon start size="x-small">fas fa-clock</v-icon>
                {{ maintenanceCountdownLabel }}
              </v-chip>
            </div>
          </div>
        </v-card>
      </v-col>
      <v-col cols="6" md="3">
        <v-card elevation="1" class="stat-card" to="/configuration/registries" rounded="lg">
          <div class="d-flex align-center pa-4" style="gap: 14px">
            <div class="stat-icon stat-icon--registries">
              <v-icon size="18" color="white">{{ registryIcon }}</v-icon>
            </div>
            <div>
              <div class="text-h5 font-weight-bold stat-number">{{ registriesCount }}</div>
              <div class="text-caption text-medium-emphasis stat-label">Registries</div>
            </div>
          </div>
        </v-card>
      </v-col>
    </v-row>

    <!-- Row 2: Container Updates -->
    <v-row class="mb-2">
      <v-col cols="12">
        <v-card rounded="lg" elevation="1">
          <div class="d-flex align-center px-4 pt-3 pb-2">
            <v-icon size="small" class="mr-2">fas fa-code-compare</v-icon>
            <span class="text-subtitle-2 font-weight-medium">Container Updates</span>
            <v-spacer />
            <v-chip v-if="containersWithUpdates.length === 0" size="small" variant="tonal" color="success" label>
              All up to date
            </v-chip>
          </div>

          <v-tabs
            v-model="updateTab"
            density="compact"
            color="primary"
            class="mt-1"
          >
            <v-tab>
              <v-icon size="small" class="tab-icon" color="primary">fas fa-layer-group</v-icon>
              <span class="tab-text">All</span>
              <span v-if="containersWithUpdates.length > 0" class="tab-count tab-count--primary ml-2">{{ containersWithUpdates.length }}</span>
            </v-tab>
            <v-tab :disabled="majorUpdates.length === 0">
              <v-icon size="small" class="tab-icon" color="error">fas fa-angles-up</v-icon>
              <span class="tab-text">Major</span>
              <span v-if="majorUpdates.length > 0" class="tab-count tab-count--error ml-2">{{ majorUpdates.length }}</span>
            </v-tab>
            <v-tab :disabled="minorUpdates.length === 0">
              <v-icon size="small" class="tab-icon" color="warning">fas fa-angle-up</v-icon>
              <span class="tab-text">Minor</span>
              <span v-if="minorUpdates.length > 0" class="tab-count tab-count--warning ml-2">{{ minorUpdates.length }}</span>
            </v-tab>
            <v-tab :disabled="patchUpdates.length === 0">
              <v-icon size="small" class="tab-icon" color="success">fas fa-wrench</v-icon>
              <span class="tab-text">Patch</span>
              <span v-if="patchUpdates.length > 0" class="tab-count tab-count--success ml-2">{{ patchUpdates.length }}</span>
            </v-tab>
            <v-tab :disabled="digestUpdates.length === 0">
              <v-icon size="small" class="tab-icon" color="info">fas fa-fingerprint</v-icon>
              <span class="tab-text">Digest</span>
              <span v-if="digestUpdates.length > 0" class="tab-count tab-count--info ml-2">{{ digestUpdates.length }}</span>
            </v-tab>
            <v-tab :disabled="unknownUpdates.length === 0">
              <v-icon size="small" class="tab-icon" color="grey">fas fa-question</v-icon>
              <span class="tab-text">Other</span>
              <span v-if="unknownUpdates.length > 0" class="tab-count tab-count--grey ml-2">{{ unknownUpdates.length }}</span>
            </v-tab>
          </v-tabs>

          <v-divider />

          <v-window v-model="updateTab">
            <v-window-item v-for="(list, idx) in [containersWithUpdates, majorUpdates, minorUpdates, patchUpdates, digestUpdates, unknownUpdates]" :key="idx">
              <div v-if="list.length === 0" class="text-center text-medium-emphasis py-8">
                <v-icon size="36" color="success">fas fa-circle-check</v-icon>
                <div class="mt-3 text-body-2">All containers are up to date</div>
              </div>
              <v-list v-else class="py-0">
                <v-list-item
                  v-for="container in list"
                  :key="container.id"
                  to="/containers"
                  class="update-row py-2"
                >
                  <template v-slot:prepend>
                    <div class="d-flex align-center justify-center flex-shrink-0" style="width: 32px; margin-right: 8px">
                      <IconRenderer
                        :icon="getEffectiveDisplayIcon(container.displayIcon, container.image.name)"
                        :size="24"
                        :margin-right="0"
                      />
                    </div>
                  </template>
                  <v-list-item-title class="text-body-2 d-flex align-center update-row-content">
                    <span class="font-weight-medium text-truncate">{{ container.displayName }}</span>
                    <span class="text-medium-emphasis text-caption flex-shrink-0">{{ container.image.tag.value }}</span>
                    <v-icon size="x-small" class="text-medium-emphasis flex-shrink-0">fas fa-arrow-right</v-icon>
                    <v-chip
                      :color="updateKindColor(container)"
                      size="x-small"
                      label
                      variant="tonal"
                      class="flex-shrink-0"
                    >
                      {{ container.updateKind?.remoteValue || 'unknown' }}
                    </v-chip>
                  </v-list-item-title>
                </v-list-item>
              </v-list>
            </v-window-item>
          </v-window>
        </v-card>
      </v-col>
    </v-row>

    <!-- Row 3: Recent Activity -->
    <v-row>
      <v-col cols="12">
        <v-card rounded="lg" elevation="1">
          <div class="d-flex align-center px-4 pt-3 pb-2">
            <v-icon size="small" class="mr-2">fas fa-clock-rotate-left</v-icon>
            <span class="text-subtitle-2 font-weight-medium">Recent Activity</span>
          </div>
          <v-divider />
          <v-card-text v-if="recentActivity.length === 0" class="text-center text-medium-emphasis py-8">
            <v-icon size="36" color="grey">fas fa-clock-rotate-left</v-icon>
            <div class="mt-3 text-body-2">No activity recorded yet</div>
          </v-card-text>
          <v-list v-else class="py-0">
            <v-list-item
              v-for="entry in recentActivity"
              :key="entry.id"
              class="activity-row py-2"
            >
              <template v-slot:prepend>
                <div class="d-flex align-center justify-center flex-shrink-0" style="width: 32px; margin-right: 8px">
                  <v-icon :color="actionColor(entry.action)" size="small">{{ actionIcon(entry.action) }}</v-icon>
                </div>
              </template>
              <v-list-item-title class="text-body-2 d-flex align-center activity-row-content">
                <span class="activity-name text-truncate">{{ entry.containerName }}</span>
                <v-chip :color="actionColor(entry.action)" size="x-small" label variant="tonal" class="flex-shrink-0">
                  {{ entry.action }}
                </v-chip>
                <v-spacer />
                <span class="text-caption text-medium-emphasis flex-shrink-0 activity-time">{{ formatTime(entry.timestamp) }}</span>
              </v-list-item-title>
            </v-list-item>
          </v-list>
        </v-card>
      </v-col>
    </v-row>
  </v-container>
</template>

<script lang="ts" src="./HomeView.ts"></script>
<style scoped>
.dashboard-container {
  max-width: 1200px;
}

.stat-card {
  background: rgb(var(--v-theme-surface));
  transition: background 0.15s ease, box-shadow 0.15s ease;
  cursor: pointer;
  text-decoration: none;
}

.stat-card:hover {
  background: rgba(var(--v-theme-on-surface), 0.04);
}

.stat-number {
  line-height: 1.1;
  letter-spacing: -0.02em;
}

.stat-icon {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.stat-icon--containers {
  background: linear-gradient(135deg, #1565c0, #1e88e5);
}

.stat-icon--triggers {
  background: linear-gradient(135deg, #e65100, #fb8c00);
}

.stat-icon--watchers {
  background: linear-gradient(135deg, #2e7d32, #43a047);
}

.stat-icon--registries {
  background: linear-gradient(135deg, #6a1b9a, #8e24aa);
}

.update-row,
.activity-row {
  border-bottom: thin solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.update-row:last-child,
.activity-row:last-child {
  border-bottom: none;
}

/* Stat card update badge (circle with count) */
.stat-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  border-radius: 11px;
  font-size: 0.7rem;
  font-weight: 700;
  color: white;
  padding: 0 5px;
  line-height: 1;
}

.stat-badge--error { background: rgb(var(--v-theme-error)); }
.stat-badge--warning { background: rgb(var(--v-theme-warning)); }
.stat-badge--success { background: rgb(var(--v-theme-success)); }
.stat-badge--info { background: rgb(var(--v-theme-info)); }
.stat-badge--grey { background: #9e9e9e; }

/* Tab count circles */
.tab-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  border-radius: 9px;
  font-size: 0.65rem;
  font-weight: 700;
  color: white;
  padding: 0 4px;
  line-height: 1;
}

.tab-count--primary { background: rgb(var(--v-theme-primary)); }
.tab-count--error { background: rgb(var(--v-theme-error)); }
.tab-count--warning { background: rgb(var(--v-theme-warning)); }
.tab-count--success { background: rgb(var(--v-theme-success)); }
.tab-count--info { background: rgb(var(--v-theme-info)); }
.tab-count--grey { background: #9e9e9e; }

/* Update row content */
.update-row-content {
  gap: 8px;
  flex-wrap: nowrap;
  overflow: hidden;
}

/* Activity row content */
.activity-row-content {
  gap: 8px;
  flex-wrap: nowrap;
  overflow: hidden;
}

/* Container name column for alignment */
.activity-name {
  display: inline-block;
  min-width: 120px;
  flex-shrink: 1;
}

/* Tab icons hidden on desktop, shown on mobile */
.tab-icon {
  display: none;
}

/* Mobile: icon-only tabs, hide activity timestamps */
@media (max-width: 599px) {
  .tab-text {
    display: none;
  }

  .tab-icon {
    display: inline-flex;
  }

  .activity-name {
    min-width: 80px;
  }

  .activity-time {
    display: none;
  }
}
</style>
