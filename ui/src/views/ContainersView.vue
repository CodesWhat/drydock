<template>
  <v-container fluid class="pa-4">
    <div class="mb-3">
      <container-filter
        :registries="registries"
        :registry-selected-init="registrySelected"
        :agents="agents"
        :agent-selected-init="agentSelected"
        :watchers="watchers"
        :watcher-selected-init="watcherSelected"
        :update-kinds="updateKinds"
        :update-kind-selected-init="updateKindSelected"
        :updateAvailable="updateAvailableSelected"
        :oldestFirst="oldestFirst"
        :groupByLabel="groupByLabel"
        :groupLabels="allContainerLabels"
        @registry-changed="onRegistryChanged"
        @agent-changed="onAgentChanged"
        @watcher-changed="onWatcherChanged"
        @update-available-changed="onUpdateAvailableChanged"
        @oldest-first-changed="onOldestFirstChanged"
        @group-by-label-changed="onGroupByLabelChanged"
        @update-kind-changed="onUpdateKindChanged"
        @refresh-all-containers="onRefreshAllContainers"
      />
    </div>
    <template v-if="isGrouped">
      <container-group
        v-for="group in computedGroups"
        :key="group.name ?? '__ungrouped__'"
        :group-name="group.name"
        :containers="group.containers"
        :agents="agentsList"
        :oldest-first="oldestFirst"
        @delete-container="deleteContainer($event)"
        @container-refreshed="onContainerRefreshed"
        @container-missing="removeContainerFromListById"
      />
    </template>
    <template v-else>
      <div
        v-for="(container, index) in containersFiltered"
        :key="container.id"
        class="mb-3"
      >
        <container-item
          :groupingLabel="''"
          :previousContainer="containersFiltered[index - 1]"
          :container="container"
          :agents="agentsList"
          :oldest-first="oldestFirst"
          @delete-container="deleteContainer(container)"
          @container-refreshed="onContainerRefreshed"
          @container-missing="removeContainerFromListById"
        />
      </div>
    </template>
    <div v-if="containersFiltered.length === 0" class="text-center text-medium-emphasis py-8">
      <v-icon size="36" color="grey">fab fa-docker</v-icon>
      <div class="mt-3 text-body-2">No containers found</div>
    </div>
  </v-container>
</template>

<script lang="ts" src="./ContainersView.ts"></script>
