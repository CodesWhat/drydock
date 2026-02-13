<template>
  <v-container fluid class="pa-4">
    <div v-for="watcher in authentications" :key="watcher.id" class="mb-3">
      <configuration-item :item="watcher" :icon-color="watcher.iconColor" />
    </div>
    <div v-if="authentications.length === 0" class="text-center text-medium-emphasis py-8">
      <v-icon size="36" color="grey">fas fa-lock</v-icon>
      <div class="mt-3 text-body-2">No authentication configured</div>
    </div>
  </v-container>
</template>

<script lang="ts" src="./ConfigurationAuthenticationsView.ts"></script>
