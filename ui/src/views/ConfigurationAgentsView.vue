<template>
  <v-container fluid>
    <v-row v-for="agent in agents" :key="agent.name">
      <v-col :cols="12" class="pt-2 pb-2">
        <configuration-item :item="agent" :agents="rawAgents" />
      </v-col>
    </v-row>
    <v-row v-if="agents.length === 0">
      <v-card-subtitle class="text-h6">No agents configured</v-card-subtitle>
    </v-row>
  </v-container>
</template>

<script lang="ts" src="./ConfigurationAgentsView.ts"></script>
