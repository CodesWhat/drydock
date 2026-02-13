<template>
  <v-container fluid class="pa-4">
    <div class="mb-3">
      <configuration-item :item="serverConfiguration" :icon-color="serverConfiguration.iconColor" />
    </div>
    <webhook-info :enabled="webhookEnabled" :base-url="webhookBaseUrl" />
    <div class="mb-3">
      <configuration-item :item="logConfiguration" :icon-color="logConfiguration.iconColor" />
    </div>
    <div class="mb-3">
      <configuration-item :item="storeConfiguration" :icon-color="storeConfiguration.iconColor" />
    </div>
  </v-container>
</template>

<script lang="ts" src="./ConfigurationServerView.ts"></script>
