<template>
  <v-container fluid class="ma-0 mb-3 pa-md-0">
    <v-row dense>
      <v-col cols="12" sm="6" md="3">
        <v-select
          :hide-details="true"
          v-model="agentSelected"
          :items="agents"
          @update:modelValue="emitAgentChanged"
          :clearable="true"
          clear-icon="mdi-close"
          label="Agent"
          variant="outlined"
          density="compact"
        ></v-select>
      </v-col>
      <v-col cols="12" sm="6" md="3">
        <v-select
          :hide-details="true"
          v-model="watcherSelected"
          :items="watchers"
          @update:modelValue="emitWatcherChanged"
          :clearable="true"
          clear-icon="mdi-close"
          label="Watcher"
          variant="outlined"
          density="compact"
        ></v-select>
      </v-col>
      <v-col cols="12" sm="6" md="3">
        <v-select
          :hide-details="true"
          v-model="registrySelected"
          :items="registries"
          @update:modelValue="emitRegistryChanged"
          :clearable="true"
          clear-icon="mdi-close"
          label="Registry"
          variant="outlined"
          density="compact"
        ></v-select>
      </v-col>
      <v-col cols="12" sm="6" md="3">
        <v-select
          :hide-details="true"
          v-model="updateKindSelected"
          :items="updateKinds"
          @update:modelValue="emitUpdateKindChanged"
          :clearable="true"
          clear-icon="mdi-close"
          label="Update kind"
          variant="outlined"
          density="compact"
        ></v-select>
      </v-col>

      <v-col cols="12" sm="6" md="3">
        <v-autocomplete
          label="Group by label"
          :items="groupLabels"
          v-model="groupByLabelLocal"
          @update:modelValue="emitGroupByLabelChanged"
          clearable
          clear-icon="mdi-close"
          variant="outlined"
          density="compact"
        >
        </v-autocomplete>
      </v-col>
      <v-col cols="6" sm="4" md="3">
        <v-switch
          class="switch-top"
          label="Update available"
          v-model="updateAvailableLocal"
          @update:modelValue="emitUpdateAvailableChanged"
          :hide-details="true"
          density="compact"
        />
      </v-col>
      <v-col cols="6" sm="4" md="3">
        <v-switch
          class="switch-top"
          label="Oldest first"
          v-model="oldestFirstLocal"
          @update:modelValue="emitOldestFirstChanged"
          :hide-details="true"
          density="compact"
        />
      </v-col>
      <v-col cols="12" sm="4" md="3" class="text-right">
        <v-btn
          color="secondary"
          @click.stop="refreshAllContainers"
          :loading="isRefreshing"
        >
          Check updates
          <v-icon> mdi-refresh</v-icon>
        </v-btn>
      </v-col>
    </v-row>
  </v-container>
</template>

<script lang="ts" src="./ContainerFilter.ts"></script>

<style scoped>
.switch-top {
  margin-top: 4px;
}
</style>
