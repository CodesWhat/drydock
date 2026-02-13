<template>
  <v-container fluid class="pa-4">
    <div v-for="agent in agents" :key="agent.name" class="mb-3">
      <configuration-item :item="agent" :icon-color="agent.iconColor" :agents="rawAgents" />
    </div>
    <div v-if="agents.length === 0" class="text-center text-medium-emphasis py-8">
      <v-icon size="36" color="grey">fas fa-robot</v-icon>
      <div class="mt-3 text-body-2">No agents configured</div>
    </div>
  </v-container>
</template>

<script lang="ts" src="./ConfigurationAgentsView.ts"></script>
