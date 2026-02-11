<template>
  <v-container fluid class="pa-4">
    <div v-for="registry in registries" :key="registry.id" class="mb-2">
      <configuration-item :item="registry" />
    </div>
    <div v-if="registries.length === 0" class="text-center text-medium-emphasis py-8">
      <v-icon size="36" color="grey">fas fa-database</v-icon>
      <div class="mt-3 text-body-2">No registries configured</div>
    </div>
  </v-container>
</template>

<script lang="ts" src="./ConfigurationRegistriesView.ts"></script>
