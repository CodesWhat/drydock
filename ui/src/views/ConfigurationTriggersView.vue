<template>
  <v-container fluid class="pa-4">
    <div v-for="trigger in triggers" :key="trigger.id" class="mb-2">
      <trigger-detail :trigger="trigger" />
    </div>
    <div v-if="triggers.length === 0" class="text-center text-medium-emphasis py-8">
      <v-icon size="36" color="grey">fas fa-bolt</v-icon>
      <div class="mt-3 text-body-2">No triggers configured</div>
    </div>
  </v-container>
</template>

<script lang="ts" src="./ConfigurationTriggersView.ts"></script>
