<template>
  <v-container class="dashboard-container">
    <!-- Row 1: Stat cards -->
    <v-row class="mb-2">
      <v-col cols="6" md="3">
        <v-card variant="flat" class="stat-card" to="/containers" rounded="lg">
          <div class="d-flex align-center pa-4" style="gap: 14px">
            <div class="stat-icon stat-icon--containers">
              <v-icon size="18" color="white">{{ containerIcon }}</v-icon>
            </div>
            <div>
              <div class="text-h5 font-weight-bold stat-number">{{ containersCount }}</div>
              <div class="text-caption text-medium-emphasis">Containers</div>
            </div>
            <v-spacer />
            <div v-if="containersWithUpdates.length > 0" class="text-right">
              <v-chip size="x-small" color="warning" variant="tonal" label>
                {{ containersWithUpdates.length }} update{{ containersWithUpdates.length === 1 ? '' : 's' }}
              </v-chip>
            </div>
            <div v-else class="text-right">
              <v-icon size="small" color="success">fas fa-circle-check</v-icon>
            </div>
          </div>
        </v-card>
      </v-col>
      <v-col cols="6" md="3">
        <v-card variant="flat" class="stat-card" to="/configuration/triggers" rounded="lg">
          <div class="d-flex align-center pa-4" style="gap: 14px">
            <div class="stat-icon stat-icon--triggers">
              <v-icon size="18" color="white">{{ triggerIcon }}</v-icon>
            </div>
            <div>
              <div class="text-h5 font-weight-bold stat-number">{{ triggersCount }}</div>
              <div class="text-caption text-medium-emphasis">Triggers</div>
            </div>
          </div>
        </v-card>
      </v-col>
      <v-col cols="6" md="3">
        <v-card variant="flat" class="stat-card" to="/configuration/watchers" rounded="lg">
          <div class="d-flex align-center pa-4" style="gap: 14px">
            <div class="stat-icon stat-icon--watchers">
              <v-icon size="18" color="white">{{ watcherIcon }}</v-icon>
            </div>
            <div>
              <div class="text-h5 font-weight-bold stat-number">{{ watchersCount }}</div>
              <div class="text-caption text-medium-emphasis">Watchers</div>
            </div>
          </div>
        </v-card>
      </v-col>
      <v-col cols="6" md="3">
        <v-card variant="flat" class="stat-card" to="/configuration/registries" rounded="lg">
          <div class="d-flex align-center pa-4" style="gap: 14px">
            <div class="stat-icon stat-icon--registries">
              <v-icon size="18" color="white">{{ registryIcon }}</v-icon>
            </div>
            <div>
              <div class="text-h5 font-weight-bold stat-number">{{ registriesCount }}</div>
              <div class="text-caption text-medium-emphasis">Registries</div>
            </div>
          </div>
        </v-card>
      </v-col>
    </v-row>

    <!-- Row 2: Container Updates -->
    <v-row class="mb-2">
      <v-col cols="12">
        <v-card variant="outlined" rounded="lg">
          <div class="d-flex align-center px-4 pt-3 pb-0">
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
              All
              <v-badge
                v-if="containersWithUpdates.length > 0"
                :content="containersWithUpdates.length"
                color="primary"
                inline
                class="ml-1"
              />
            </v-tab>
            <v-tab :disabled="majorUpdates.length === 0">
              Major
              <v-badge
                v-if="majorUpdates.length > 0"
                :content="majorUpdates.length"
                color="error"
                inline
                class="ml-1"
              />
            </v-tab>
            <v-tab :disabled="minorUpdates.length === 0">
              Minor
              <v-badge
                v-if="minorUpdates.length > 0"
                :content="minorUpdates.length"
                color="warning"
                inline
                class="ml-1"
              />
            </v-tab>
            <v-tab :disabled="patchUpdates.length === 0">
              Patch
              <v-badge
                v-if="patchUpdates.length > 0"
                :content="patchUpdates.length"
                color="success"
                inline
                class="ml-1"
              />
            </v-tab>
            <v-tab :disabled="digestUpdates.length === 0">
              Digest
              <v-badge
                v-if="digestUpdates.length > 0"
                :content="digestUpdates.length"
                color="info"
                inline
                class="ml-1"
              />
            </v-tab>
            <v-tab :disabled="unknownUpdates.length === 0">
              Other
              <v-badge
                v-if="unknownUpdates.length > 0"
                :content="unknownUpdates.length"
                color="grey"
                inline
                class="ml-1"
              />
            </v-tab>
          </v-tabs>

          <v-divider />

          <v-window v-model="updateTab">
            <v-window-item v-for="(list, idx) in [containersWithUpdates, majorUpdates, minorUpdates, patchUpdates, digestUpdates, unknownUpdates]" :key="idx">
              <div v-if="list.length === 0" class="text-center text-medium-emphasis py-8">
                <v-icon size="36" color="success">fas fa-circle-check</v-icon>
                <div class="mt-3 text-body-2">All containers are up to date</div>
              </div>
              <v-list v-else density="compact" class="py-0">
                <v-list-item
                  v-for="container in list"
                  :key="container.id"
                  to="/containers"
                  class="update-row"
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
                  <v-list-item-title class="text-body-2 d-flex align-center" style="gap: 8px">
                    <span class="font-weight-medium">{{ container.displayName }}</span>
                    <span class="text-medium-emphasis text-caption">{{ container.image.tag.value }}</span>
                    <v-icon size="x-small" class="text-medium-emphasis">fas fa-arrow-right</v-icon>
                    <v-chip
                      :color="updateKindColor(container)"
                      size="x-small"
                      label
                      variant="tonal"
                    >
                      {{ container.updateKind?.remoteValue || 'unknown' }}
                    </v-chip>
                    <v-chip
                      size="x-small"
                      variant="outlined"
                      :color="updateKindColor(container)"
                      class="text-uppercase"
                    >
                      {{ updateKindLabel(container) }}
                    </v-chip>
                  </v-list-item-title>
                </v-list-item>
              </v-list>
            </v-window-item>
          </v-window>
        </v-card>
      </v-col>
    </v-row>

    <!-- Row 3: Recent Activity + Maintenance Windows -->
    <v-row>
      <v-col cols="12" md="6">
        <v-card variant="outlined" rounded="lg" class="h-100">
          <div class="d-flex align-center px-4 pt-3 pb-2">
            <v-icon size="small" class="mr-2">fas fa-clock-rotate-left</v-icon>
            <span class="text-subtitle-2 font-weight-medium">Recent Activity</span>
          </div>
          <v-divider />
          <v-card-text v-if="recentActivity.length === 0" class="text-center text-medium-emphasis py-8">
            <v-icon size="36" color="grey">fas fa-clock-rotate-left</v-icon>
            <div class="mt-3 text-body-2">No activity recorded yet</div>
          </v-card-text>
          <v-list v-else density="compact" class="py-0">
            <v-list-item
              v-for="entry in recentActivity"
              :key="entry.id"
            >
              <template v-slot:prepend>
                <v-icon :color="actionColor(entry.action)" size="small">{{ actionIcon(entry.action) }}</v-icon>
              </template>
              <v-list-item-title class="text-body-2">
                {{ entry.containerName }}
                <v-chip :color="actionColor(entry.action)" size="x-small" label variant="tonal" class="ml-1">
                  {{ entry.action }}
                </v-chip>
              </v-list-item-title>
              <v-list-item-subtitle class="text-caption">
                {{ formatTime(entry.timestamp) }}
              </v-list-item-subtitle>
            </v-list-item>
          </v-list>
        </v-card>
      </v-col>
      <v-col cols="12" md="6">
        <v-card variant="outlined" rounded="lg" class="h-100">
          <div class="d-flex align-center px-4 pt-3 pb-2">
            <v-icon size="small" class="mr-2">fas fa-calendar-check</v-icon>
            <span class="text-subtitle-2 font-weight-medium">Maintenance Windows</span>
          </div>
          <v-divider />
          <v-card-text class="text-center text-medium-emphasis py-8">
            <v-icon size="36" color="grey">fas fa-calendar-check</v-icon>
            <div class="mt-3 text-body-2">No maintenance windows configured</div>
          </v-card-text>
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
  background: rgba(var(--v-theme-on-surface), 0.03);
  transition: background 0.15s ease;
  cursor: pointer;
  text-decoration: none;
}

.stat-card:hover {
  background: rgba(var(--v-theme-on-surface), 0.06);
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

.update-row {
  border-bottom: thin solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.update-row:last-child {
  border-bottom: none;
}
</style>
