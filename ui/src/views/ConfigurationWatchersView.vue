<template>
  <v-container fluid class="pa-4">
    <div v-for="watcher in watchers" :key="watcher.name" class="mb-3">
      <configuration-item :item="watcher" :icon-color="watcher.iconColor" />
    </div>
    <div v-if="watchers.length === 0" class="text-center text-medium-emphasis py-8">
      <v-icon size="36" color="grey">fas fa-eye</v-icon>
      <div class="mt-3 text-body-2">No watchers configured</div>
    </div>
  </v-container>
</template>

<script lang="ts" src="./ConfigurationWatchersView.ts"></script>
