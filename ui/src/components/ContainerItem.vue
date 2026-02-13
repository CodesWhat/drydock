<template>
  <div>
    <div
      v-if="
        this.groupingLabel &&
        this.previousContainer?.labels?.[this.groupingLabel] !==
          this.container.labels?.[this.groupingLabel]
      "
    >
      <div class="text-h6">
        {{ this.groupingLabel }} =
        {{ this.container.labels?.[this.groupingLabel] ?? "(empty)" }}
      </div>
      <v-divider class="pb-3"></v-divider>
    </div>
    <v-card rounded="lg" elevation="1">
      <v-card-title
        @click="collapseDetail()"
        style="cursor: pointer"
        class="pa-4 d-flex align-center bg-surface"
      >
        <div class="d-flex align-center" style="gap: 16px">
          <div class="d-flex align-center justify-center flex-shrink-0" :style="{ width: smAndUp ? '40px' : '28px' }">
            <IconRenderer
              :icon="effectiveDisplayIcon"
              :size="smAndUp ? 32 : 24"
              :margin-right="0"
            />
          </div>
          <div class="d-flex flex-column" style="min-width: 0">
            <div class="d-flex align-center" style="gap: 6px">
              <span class="text-body-2 font-weight-medium text-truncate">
                {{ container.displayName }}
              </span>
              <v-chip label size="x-small" variant="tonal" color="info" class="flex-shrink-0">
                {{ container.image.tag.value }}
              </v-chip>
              <v-chip v-if="container.status !== 'running'" label size="x-small" variant="tonal" color="warning" class="flex-shrink-0">
                {{ container.status }}
              </v-chip>
            </div>
            <div v-if="smAndUp" class="text-caption text-medium-emphasis d-flex align-center" style="gap: 4px">
              <v-icon v-if="container.agent" size="x-small" :color="agentStatusColor">fas fa-circle</v-icon>
              <span v-if="container.agent">{{ container.agent }} &middot;</span>
              <span>{{ container.watcher }}</span>
              <span v-if="mdAndUp">&middot; {{ container.image.registry.name }}</span>
            </div>
          </div>
        </div>
        
        <v-spacer />
        
        <div class="d-flex align-center" style="gap: 8px">
          <span v-if="smAndUp && container.updateAvailable" class="d-flex align-center" style="gap: 4px">
            <v-icon>fas fa-arrow-right</v-icon>
            <v-tooltip location="bottom">
              <template v-slot:activator="{ props }">
                <v-chip
                  label
                  variant="tonal"
                  :color="newVersionClass"
                  v-bind="props"
                  @click="
                    copyToClipboard('container new version', newVersion);
                    $event.stopImmediatePropagation();
                  "
                >
                  {{ newVersion }}
                  <v-icon end size="small">far fa-clipboard</v-icon>
                </v-chip>
              </template>
              <span class="text-caption">Copy to clipboard</span>
            </v-tooltip>
          </span>
          <span v-if="smAndUp && updatePolicyChipLabel" class="d-flex align-center">
            <v-tooltip location="bottom">
              <template v-slot:activator="{ props }">
                <v-chip
                  label
                  variant="outlined"
                  color="warning"
                  v-bind="props"
                >
                  <v-icon start size="small">fas fa-bell-slash</v-icon>
                  {{ updatePolicyChipLabel }}
                </v-chip>
              </template>
              <span class="text-caption">{{ updatePolicyDescription }}</span>
            </v-tooltip>
          </span>

          <span
            v-if="smAndUp && oldestFirst"
            class="text-caption"
          >
            {{ this.$filters.date(container.image.created) }}
          </span>

          <v-icon>{{
            showDetail ? "fas fa-chevron-up" : "fas fa-chevron-down"
          }}</v-icon>
        </div>
      </v-card-title>
      <transition name="expand-transition">
        <div v-show="showDetail">
          <div class="d-flex align-center" style="border-bottom: thin solid rgba(var(--v-border-color), var(--v-border-opacity));">
            <v-tabs v-model="tab" ref="tabs" density="compact" color="primary" class="flex-grow-1">
              <v-tab v-if="container.result">
                <v-icon size="small" class="mr-1">fas fa-code-compare</v-icon>
                <span>Update</span>
              </v-tab>
              <v-tab>
                <v-icon size="small" class="mr-1">fas fa-bolt</v-icon>
                <span>Triggers</span>
              </v-tab>
              <v-tab>
                <v-icon size="small" class="mr-1">fas fa-cube</v-icon>
                <span>Image</span>
              </v-tab>
              <v-tab>
                <v-icon size="small" class="mr-1">fas fa-server</v-icon>
                <span>Container</span>
              </v-tab>
              <v-tab>
                <v-icon size="small" class="mr-1">fas fa-scroll</v-icon>
                <span>Logs</span>
              </v-tab>
              <v-tab v-if="container.error">
                <v-icon size="small" class="mr-1">fas fa-triangle-exclamation</v-icon>
                <span>Error</span>
              </v-tab>
            </v-tabs>

            <!-- Desktop action buttons -->
            <div v-if="smAndUp" class="d-flex align-center flex-shrink-0 px-2" style="gap: 2px;">
              <!-- Container Actions -->
              <template v-if="containerActionsEnabled">
                <v-tooltip text="Start container" location="top">
                  <template v-slot:activator="{ props }">
                    <v-btn icon variant="text" size="small" color="success" v-bind="props"
                      :disabled="container.status === 'running'" :loading="isStarting"
                      @click="startContainerAction">
                      <v-icon>fas fa-play</v-icon>
                    </v-btn>
                  </template>
                </v-tooltip>

                <v-tooltip text="Stop container" location="top">
                  <template v-slot:activator="{ props }">
                    <v-btn icon variant="text" size="small" color="error" v-bind="props"
                      :disabled="container.status !== 'running'" :loading="isStopping"
                      @click="stopContainerAction">
                      <v-icon>fas fa-stop</v-icon>
                    </v-btn>
                  </template>
                </v-tooltip>

                <v-tooltip text="Restart container" location="top">
                  <template v-slot:activator="{ props }">
                    <v-btn icon variant="text" size="small" v-bind="props"
                      :loading="isRestarting"
                      @click="restartContainerAction">
                      <v-icon>fas fa-arrows-rotate</v-icon>
                    </v-btn>
                  </template>
                </v-tooltip>

                <v-divider vertical class="mx-1" />
              </template>

              <!-- Preview -->
              <v-tooltip text="Preview update" location="top">
                <template v-slot:activator="{ props }">
                  <v-btn
                    icon
                    variant="text"
                    size="small"
                    v-bind="props"
                    :disabled="!container.updateAvailable"
                    @click="showPreview = true"
                  >
                    <v-icon>fas fa-eye</v-icon>
                  </v-btn>
                </template>
              </v-tooltip>

              <!-- Update now -->
              <v-tooltip text="Update now" location="top">
                <template v-slot:activator="{ props }">
                  <v-btn
                    icon
                    variant="text"
                    size="small"
                    color="secondary"
                    v-bind="props"
                    :loading="isUpdatingContainer"
                    :disabled="!container.updateAvailable"
                    @click="updateContainerNow"
                  >
                    <v-icon>fas fa-rocket</v-icon>
                  </v-btn>
                </template>
              </v-tooltip>

              <!-- Rollback -->
              <v-tooltip text="Rollback" location="top">
                <template v-slot:activator="{ props }">
                  <v-btn
                    icon
                    variant="text"
                    size="small"
                    v-bind="props"
                    @click="showRollback = true"
                  >
                    <v-icon>fas fa-rotate-left</v-icon>
                  </v-btn>
                </template>
              </v-tooltip>

              <!-- Policy menu -->
              <v-menu location="top">
                <template v-slot:activator="{ props: menuProps }">
                  <v-tooltip text="Update policy" location="top">
                    <template v-slot:activator="{ props: tooltipProps }">
                      <v-btn icon variant="text" size="small" color="info" v-bind="{ ...menuProps, ...tooltipProps }">
                        <v-icon>fas fa-sliders</v-icon>
                      </v-btn>
                    </template>
                  </v-tooltip>
                </template>
                <v-list density="compact">
                  <v-list-item
                    :disabled="!container.updateKind || container.updateKind.kind === 'unknown'"
                    @click="skipCurrentUpdate"
                  >
                    <v-list-item-title>Skip current update</v-list-item-title>
                  </v-list-item>
                  <v-list-item @click="snoozeUpdates(1)">
                    <v-list-item-title>Snooze 1 day</v-list-item-title>
                  </v-list-item>
                  <v-list-item @click="snoozeUpdates(7)">
                    <v-list-item-title>Snooze 7 days</v-list-item-title>
                  </v-list-item>
                  <v-list-item @click="snoozeUpdates(30)">
                    <v-list-item-title>Snooze 30 days</v-list-item-title>
                  </v-list-item>
                  <v-divider />
                  <v-list-item
                    :disabled="!container.updatePolicy || !container.updatePolicy.snoozeUntil"
                    @click="clearSnooze"
                  >
                    <v-list-item-title>Clear snooze</v-list-item-title>
                  </v-list-item>
                  <v-list-item
                    :disabled="!hasAnyUpdatePolicy"
                    @click="clearUpdatePolicy"
                  >
                    <v-list-item-title>Clear all policy</v-list-item-title>
                  </v-list-item>
                </v-list>
              </v-menu>

              <!-- Delete -->
              <v-dialog
                v-model="dialogDelete"
                width="500"
                v-if="deleteEnabled"
              >
                <template v-slot:activator="{ props: dialogProps }">
                  <v-tooltip text="Delete" location="top">
                    <template v-slot:activator="{ props: tooltipProps }">
                      <v-btn icon variant="text" size="small" color="error" v-bind="{ ...dialogProps, ...tooltipProps }">
                        <v-icon>fas fa-trash</v-icon>
                      </v-btn>
                    </template>
                  </v-tooltip>
                </template>

                <v-card class="text-center">
                  <v-app-bar color="error" theme="dark" flat dense>
                    <v-toolbar-title class="text-body-1">
                      Delete the container?
                    </v-toolbar-title>
                  </v-app-bar>
                  <v-card-subtitle class="text-body-2">
                    <v-row class="mt-2" no-gutters>
                      <v-col>
                        Delete
                        <span class="font-weight-bold text-error">{{
                          container.name
                        }}</span>
                        from the list?
                        <br />
                        <span class="font-italic"
                          >(The real container won't be deleted)</span
                        >
                      </v-col>
                    </v-row>
                    <v-row>
                      <v-col class="text-center">
                        <v-btn variant="outlined" @click="dialogDelete = false" size="small">
                          Cancel
                        </v-btn>
                        &nbsp;
                        <v-btn
                          color="error"
                          size="small"
                          @click="
                            dialogDelete = false;
                            deleteContainer();
                          "
                        >
                          Delete
                        </v-btn>
                      </v-col>
                    </v-row>
                  </v-card-subtitle>
                </v-card>
              </v-dialog>
            </div>

            <!-- Mobile: overflow menu button -->
            <div v-else class="d-flex align-center flex-shrink-0 px-2">
              <v-menu location="top">
                <template v-slot:activator="{ props }">
                  <v-btn icon variant="text" size="small" v-bind="props">
                    <v-icon>fas fa-ellipsis-vertical</v-icon>
                  </v-btn>
                </template>
                <v-list density="compact">
                  <template v-if="containerActionsEnabled">
                    <v-list-item :disabled="container.status === 'running'" @click="startContainerAction">
                      <template v-slot:prepend><v-icon color="success">fas fa-play</v-icon></template>
                      <v-list-item-title>Start</v-list-item-title>
                    </v-list-item>
                    <v-list-item :disabled="container.status !== 'running'" @click="stopContainerAction">
                      <template v-slot:prepend><v-icon color="error">fas fa-stop</v-icon></template>
                      <v-list-item-title>Stop</v-list-item-title>
                    </v-list-item>
                    <v-list-item @click="restartContainerAction">
                      <template v-slot:prepend><v-icon>fas fa-arrows-rotate</v-icon></template>
                      <v-list-item-title>Restart</v-list-item-title>
                    </v-list-item>
                    <v-divider />
                  </template>
                  <v-list-item
                    :disabled="!container.updateAvailable"
                    @click="showPreview = true"
                  >
                    <template v-slot:prepend><v-icon>fas fa-eye</v-icon></template>
                    <v-list-item-title>Preview</v-list-item-title>
                  </v-list-item>
                  <v-list-item
                    :disabled="!container.updateAvailable"
                    :loading="isUpdatingContainer"
                    @click="updateContainerNow"
                  >
                    <template v-slot:prepend><v-icon>fas fa-rocket</v-icon></template>
                    <v-list-item-title>Update now</v-list-item-title>
                  </v-list-item>
                  <v-list-item @click="showRollback = true">
                    <template v-slot:prepend><v-icon>fas fa-rotate-left</v-icon></template>
                    <v-list-item-title>Rollback</v-list-item-title>
                  </v-list-item>
                  <v-divider />
                  <v-list-item
                    :disabled="!container.updateKind || container.updateKind.kind === 'unknown'"
                    @click="skipCurrentUpdate"
                  >
                    <template v-slot:prepend><v-icon>fas fa-sliders</v-icon></template>
                    <v-list-item-title>Skip current update</v-list-item-title>
                  </v-list-item>
                  <v-list-item @click="snoozeUpdates(1)">
                    <template v-slot:prepend><v-icon>fas fa-clock</v-icon></template>
                    <v-list-item-title>Snooze 1 day</v-list-item-title>
                  </v-list-item>
                  <v-list-item @click="snoozeUpdates(7)">
                    <template v-slot:prepend><v-icon>fas fa-clock</v-icon></template>
                    <v-list-item-title>Snooze 7 days</v-list-item-title>
                  </v-list-item>
                  <v-list-item @click="snoozeUpdates(30)">
                    <template v-slot:prepend><v-icon>fas fa-clock</v-icon></template>
                    <v-list-item-title>Snooze 30 days</v-list-item-title>
                  </v-list-item>
                  <v-list-item
                    :disabled="!container.updatePolicy || !container.updatePolicy.snoozeUntil"
                    @click="clearSnooze"
                  >
                    <template v-slot:prepend><v-icon>fas fa-clock-rotate-left</v-icon></template>
                    <v-list-item-title>Clear snooze</v-list-item-title>
                  </v-list-item>
                  <v-list-item
                    :disabled="!hasAnyUpdatePolicy"
                    @click="clearUpdatePolicy"
                  >
                    <template v-slot:prepend><v-icon>fas fa-eraser</v-icon></template>
                    <v-list-item-title>Clear all policy</v-list-item-title>
                  </v-list-item>
                  <v-divider />
                  <v-list-item
                    v-if="deleteEnabled"
                    class="text-error"
                    @click="dialogDelete = true"
                  >
                    <template v-slot:prepend><v-icon color="error">fas fa-trash</v-icon></template>
                    <v-list-item-title>Delete</v-list-item-title>
                  </v-list-item>
                </v-list>
              </v-menu>

              <!-- Delete dialog for mobile (triggered by list item) -->
              <v-dialog
                v-model="dialogDelete"
                width="500"
                v-if="deleteEnabled"
              >
                <v-card class="text-center">
                  <v-app-bar color="error" theme="dark" flat dense>
                    <v-toolbar-title class="text-body-1">
                      Delete the container?
                    </v-toolbar-title>
                  </v-app-bar>
                  <v-card-subtitle class="text-body-2">
                    <v-row class="mt-2" no-gutters>
                      <v-col>
                        Delete
                        <span class="font-weight-bold text-error">{{
                          container.name
                        }}</span>
                        from the list?
                        <br />
                        <span class="font-italic"
                          >(The real container won't be deleted)</span
                        >
                      </v-col>
                    </v-row>
                    <v-row>
                      <v-col class="text-center">
                        <v-btn variant="outlined" @click="dialogDelete = false" size="small">
                          Cancel
                        </v-btn>
                        &nbsp;
                        <v-btn
                          color="error"
                          size="small"
                          @click="
                            dialogDelete = false;
                            deleteContainer();
                          "
                        >
                          Delete
                        </v-btn>
                      </v-col>
                    </v-row>
                  </v-card-subtitle>
                </v-card>
              </v-dialog>
            </div>
          </div>

          <v-window v-model="tab">
            <v-window-item v-if="container.result">
              <container-update
                :result="container.result"
                :semver="container.image.tag.semver"
                :update-kind="container.updateKind"
                :update-available="container.updateAvailable"
              />
            </v-window-item>
            <v-window-item>
              <container-triggers :container="container" />
            </v-window-item>
            <v-window-item>
              <container-image :image="container.image" />
            </v-window-item>
            <v-window-item>
              <container-detail :container="container" />
            </v-window-item>
            <v-window-item>
              <container-logs :container="container" />
            </v-window-item>
            <v-window-item v-if="container.error">
              <container-error :error="container.error" />
            </v-window-item>
          </v-window>

        </div>
      </transition>
      <container-preview
        v-model="showPreview"
        :container-id="container.id"
        @update-confirmed="updateContainerNow"
      />
      <container-rollback
        v-model="showRollback"
        :container-id="container.id"
        :container-name="container.displayName"
        @rollback-success="onRollbackSuccess"
      />
    </v-card>
  </div>
</template>

<script lang="ts" src="./ContainerItem.ts"></script>

<style scoped>
.v-chip--disabled {
  opacity: 1;
  pointer-events: none;
  -webkit-user-select: none;
  -moz-user-select: none;
  -ms-user-select: none;
  user-select: none;
}
</style>
