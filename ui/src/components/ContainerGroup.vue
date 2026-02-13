<template>
  <v-card class="mb-3" rounded="lg" elevation="1">
    <v-card-title
      class="pa-4 d-flex align-center bg-surface"
      style="cursor: pointer"
      @click="toggleExpand"
    >
      <v-icon size="small" class="mr-2">
        {{ expanded ? 'fas fa-chevron-down' : 'fas fa-chevron-right' }}
      </v-icon>
      <span class="text-body-1 font-weight-medium">{{ displayName }}</span>

      <v-chip size="small" variant="tonal" class="ml-2">
        {{ containerCount }}
      </v-chip>

      <v-chip
        v-if="hasUpdates"
        size="small"
        variant="tonal"
        color="warning"
        class="ml-1"
      >
        {{ updateCount }} update{{ updateCount > 1 ? 's' : '' }}
      </v-chip>
      <span v-else class="d-none" aria-hidden="true" />

      <v-spacer />

      <v-tooltip v-if="hasUpdates" location="top">
        <template v-slot:activator="{ props }">
          <v-btn
            icon
            variant="text"
            size="small"
            color="secondary"
            v-bind="props"
            :loading="isUpdatingAll"
            @click.stop="updateAllInGroup"
          >
            <v-icon>fas fa-rocket</v-icon>
          </v-btn>
        </template>
        <span class="text-caption">Update all in group</span>
      </v-tooltip>
      <span v-else class="d-none" aria-hidden="true" />
    </v-card-title>

    <v-expand-transition>
      <div v-show="expanded" class="pa-2">
        <div
          v-for="container in containers"
          :key="container.id"
          class="mb-3"
        >
          <container-item
            :groupingLabel="''"
            :container="container"
            :agents="agents"
            :oldest-first="oldestFirst"
            @delete-container="onDeleteContainer(container)"
            @container-refreshed="onContainerRefreshed"
            @container-missing="onContainerMissing"
          />
        </div>
      </div>
    </v-expand-transition>
  </v-card>
</template>

<script lang="ts" src="./ContainerGroup.ts"></script>
